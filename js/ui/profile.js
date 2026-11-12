import { h, NS } from '../util.js';
import { I } from '../icons.js';
import { on, openBoard } from '../store.js';
import { lib, anyPlayer, playerById, roleName, POS_NUMS, sortedSquads, ACTION_CATS } from '../library.js';
import { COMPS, compLabel } from '../gamestats.js';
import { playerSummary, seasons, seasonLabel, DEFAULT_FILTER, pct, num1, fmtDate, actionLabel } from '../alltime.js';
import { modal } from './dialogs.js';
import { gradeText, gradeClass, signClass } from './stats.js';

/** Filterleiste (Saison / Mannschaft / Wettbewerb) – auch für die Hall of Fame */
export function filterBar(f, onChange, { comp = true } = {}) {
  const sel = (key, label, opts) => {
    const s = h('select', { class: 'input select', 'aria-label': label },
      opts.map(([v, l]) => h('option', { value: v, selected: String(f[key]) === String(v) }, l)));
    s.onchange = () => { f[key] = s.value; onChange(); };
    return h('label', { class: 'flt' }, h('span', {}, label), s);
  };
  return h('div', { class: 'flt-bar' },
    sel('season', 'Zeitraum', [['alle', 'Alle Spiele'], ...seasons().map((y) => [y, 'Saison ' + seasonLabel(y)])]),
    sel('squad', 'Mannschaft', [['alle', 'Alle'], ...sortedSquads().map((s) => [s.id, s.name])]),
    comp ? sel('comp', 'Wettbewerb', [['alle', 'Alle'], ...COMPS]) : null);
}

const resText = (g) => (g.res === 'win' ? 'S' : g.res === 'loss' ? 'N' : '–');
let chartMetric = '_pos';

/** Spielerprofil mit All-Time-Stats */
export function openProfile(pid, { onEdit } = {}) {
  const f = { ...DEFAULT_FILTER };
  const body = h('div', { class: 'prof' });
  let m;
  const render = () => {
    const p = anyPlayer(pid);
    if (!p) return m?.close();
    const s = playerSummary(pid, f);
    const tile = (big, label, cls = '') => h('div', { class: 'kpi ' + cls }, h('b', {}, big), h('span', {}, label));
    const head = h('div', { class: 'prof-head' },
      h('span', { class: 'ros-badge big' }, p.kuerzel || '?'),
      h('div', { class: 'prof-name' }, h('b', {}, p.name),
        h('span', { class: 'muted small' }, [p.nummer !== '' && p.nummer != null ? `#${p.nummer}` : null, p.stdPos ? roleName(p.stdPos) : null, playerById(pid) ? null : 'archiviert'].filter(Boolean).join(' · '))),
      onEdit && playerById(pid) ? h('button', { class: 'btn text', html: I.edit + 'Bearbeiten', onclick: () => onEdit(pid) }) : null);

    if (!s.n) {
      body.replaceChildren(head, filterBar(f, render),
        h('div', { class: 'prof-empty' },
          h('p', {}, 'Noch keine Spiele mit diesem Filter.'),
          h('p', { class: 'muted small' }, 'Es zählen Boards, die unter Statistik → Spiel als „Spiel“ markiert sind und eine Board-Mannschaft haben. Der Spieler braucht dort einen Einsatz oder Einträge.')));
      return;
    }

    const kpis = h('div', { class: 'kpis' },
      tile(String(s.n), 'Spiele'), tile(String(s.sets), 'Sätze'), tile(String(s.wins), 'Siege', 'pos'), tile(String(s.losses), 'Niederlagen', 'neg'), tile(pct(s.winRate), 'Siegquote'));
    const qs = s.quotes.length
      ? h('div', { class: 'kpis' }, s.quotes.map((q) => h('div', { class: 'kpi' + (q.bad ? ' neg' : '') }, h('b', {}, pct(q.value)), h('span', {}, q.label), h('span', { class: 'muted small' }, `${q.sub} · ${q.att} Versuche`))))
      : null;

    // Aktionen: Summe, Schnitt, Rekord
    const used = lib.actions.filter((a) => a.active || s.totals[a.id]);
    const rows = ACTION_CATS.flatMap(([cat, cl]) => used.filter((a) => a.cat === cat).map((a) => {
      const r = s.records[a.id];
      return h('tr', {},
        h('td', {}, h('span', { class: 'dot ' + signClass(a.sign) }), ' ', a.label, h('span', { class: 'muted small' }, ' · ' + cl)),
        h('td', { class: 'n' }, String(s.totals[a.id] || 0)),
        h('td', { class: 'n' }, num1((s.totals[a.id] || 0) / s.n)),
        h('td', { class: 'rec' }, r && r.n ? h('button', { class: 'linkish', onclick: () => go(r.g.b.id) }, `${r.n} · ${fmtDate(r.g.date)}${r.g.opp ? ' vs ' + r.g.opp : ''}`) : h('span', { class: 'muted' }, '–')));
    }));
    const table = h('table', { class: 'prof-tbl' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Aktion'), h('th', { class: 'n' }, 'Summe'), h('th', { class: 'n' }, 'Ø / Spiel'), h('th', {}, 'Rekord in einem Spiel'))),
      h('tbody', {}, rows));

    // Einsätze pro Position
    const maxPos = Math.max(1, ...POS_NUMS.map((n) => s.posCount[n] || 0));
    const noPos = s.n - POS_NUMS.reduce((a, n) => a + (s.posCount[n] || 0), 0);
    const posBars = h('div', { class: 'pos-bars' },
      POS_NUMS.map((n) => h('div', { class: 'pb' },
        h('span', { class: 'pb-l' }, `${n} · ${roleName(n)}`),
        h('span', { class: 'pb-t' }, h('span', { class: 'pb-f', style: { width: `${((s.posCount[n] || 0) / maxPos) * 100}%` } })),
        h('span', { class: 'pb-n' }, String(s.posCount[n] || 0)))),
      noPos > 0 ? h('div', { class: 'muted small' }, `${noPos} Spiel(e) ohne Position`) : null);

    // Spielliste (neueste zuerst)
    const list = h('div', { class: 'prof-games' },
      [...s.games].reverse().map((g) =>
        h('button', { class: 'pg-row', onclick: () => go(g.b.id) },
          h('span', { class: 'pg-res ' + (g.res || '') }, resText(g)),
          h('span', { class: 'pg-main' }, h('b', {}, g.opp ? 'vs ' + g.opp : g.b.name), h('span', { class: 'muted small' }, `${fmtDate(g.date)} · ${compLabel(g.comp)} · Sätze ${g.won}:${g.lost}${g.pos ? ' · Pos. ' + g.pos : ''}`)),
          h('span', { class: 'grade ' + gradeClass(g.grade) }, gradeText(g.grade)))));

    body.replaceChildren(...[head, filterBar(f, render), kpis, qs,
      h('h3', {}, 'Verlauf'), chart(s.games),
      h('h3', {}, 'Aktionen'), h('div', { class: 'tbl-wrap' }, table),
      h('h3', {}, 'Einsätze pro Position'), posBars,
      h('h3', {}, `Spiele (${s.n})`), list].filter(Boolean));
  };
  const go = (boardId) => {
    openBoard(boardId);
    document.querySelectorAll('.modal-back').forEach((e) => e.remove());
  };

  // Verlauf: Balken über die letzten 10 Spiele, Kennzahl wählbar
  const chart = (games) => {
    const metrics = [['_pos', 'Positive Aktionen'], ['_neg', 'Fehler'], ['_grade', 'Note'], ...lib.actions.filter((a) => a.active).map((a) => [a.id, a.label])];
    const pick = h('select', { class: 'input select', 'aria-label': 'Kennzahl im Verlauf' }, metrics.map(([v, l]) => h('option', { value: v, selected: v === chartMetric }, l)));
    pick.onchange = () => { chartMetric = pick.value; render(); };
    const last = games.slice(-10);
    const val = (g) => {
      if (chartMetric === '_grade') return g.grade;
      if (chartMetric === '_pos' || chartMetric === '_neg') {
        const sign = chartMetric === '_pos' ? 1 : -1;
        return lib.actions.filter((a) => a.sign === sign).reduce((x, a) => x + (g.counts[a.id] || 0), 0);
      }
      return g.counts[chartMetric] || 0;
    };
    const vals = last.map(val);
    const isGrade = chartMetric === '_grade';
    const W = 600, H = 170, PL = 30, PB = 34, PT = 18;
    const max = isGrade ? 6 : Math.max(1, ...vals.map((v) => v || 0));
    const step = (W - PL) / Math.max(1, last.length);
    const bw = Math.min(42, step * 0.6);
    // Note: 1,0 oben (gut), 6,0 unten
    const y = (v) => (isGrade ? PT + (H - PT - PB) * ((v - 1) / 5) : PT + (H - PT - PB) * (1 - v / max));
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'chart');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Verlauf über die letzten Spiele');
    let out = '';
    const ticks = isGrade ? [1, 2, 3, 4, 5, 6] : [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
    for (const t of ticks) out += `<line class="ch-grid" x1="${PL}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text class="ch-ax" x="${PL - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
    last.forEach((g, i) => {
      const v = vals[i];
      const cx = PL + step * i + step / 2;
      const tip = `${fmtDate(g.date)}${g.opp ? ' vs ' + g.opp : ''}: ${v == null ? '–' : isGrade ? gradeText(v) : v}`;
      if (v != null && v > 0) {
        if (isGrade) out += `<circle class="ch-dot" cx="${cx}" cy="${y(v)}" r="6"><title>${tip}</title></circle>`;
        else {
          const top = y(v), bot = y(0), r = Math.min(4, bw / 2, bot - top);
          out += `<path class="ch-bar" d="M${cx - bw / 2} ${bot}V${top + r}q0 ${-r} ${r} ${-r}H${cx + bw / 2 - r}q${r} 0 ${r} ${r}V${bot}Z"><title>${tip}</title></path>`;
          if (last.length <= 10) out += `<text class="ch-val" x="${cx}" y="${top - 5}" text-anchor="middle">${v}</text>`;
        }
      }
      out += `<rect class="ch-hit" x="${cx - step / 2}" y="${PT}" width="${step}" height="${H - PT - PB}"><title>${tip}</title></rect>`;
      out += `<text class="ch-ax" x="${cx}" y="${H - PB + 16}" text-anchor="middle">${fmtDate(g.date).slice(0, 5)}</text>`;
      out += `<text class="ch-ax sm" x="${cx}" y="${H - PB + 29}" text-anchor="middle">${(g.opp || '').slice(0, 9)}</text>`;
    });
    if (isGrade) {
      const pts = last.map((g, i) => (vals[i] != null ? `${PL + step * i + step / 2},${y(vals[i])}` : null)).filter(Boolean);
      if (pts.length > 1) out = `<polyline class="ch-line" points="${pts.join(' ')}"/>` + out;
    }
    out += `<line class="ch-base" x1="${PL}" x2="${W}" y1="${y(isGrade ? 6 : 0)}" y2="${y(isGrade ? 6 : 0)}"/>`;
    svg.innerHTML = out;
    return h('div', { class: 'chart-box' }, h('div', { class: 'chart-top' }, pick, h('span', { class: 'muted small' }, `letzte ${last.length} Spiele`)), svg);
  };

  render();
  m = modal({ title: 'Spielerprofil', wide: true, body });
  m.box.classList.add('prof-modal');
  on(['library', 'stats', 'boards'], () => document.body.contains(m.box) && render());
  return m;
}
