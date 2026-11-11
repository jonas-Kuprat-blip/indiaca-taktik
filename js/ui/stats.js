import { h } from '../util.js';
import { I } from '../icons.js';
import { board, touch, emit, on } from '../store.js';
import { ACTION_CATS, activeActions, POS_NUMS, roleName, squadById } from '../library.js';
import {
  game, gs, candidates, countsOf, gradeOf, addEvent, deleteEvent, setCount, setPart, nextSet, gotoSet, undo, canUndo,
  resetStats, result, actionInfo, COMPS, TEAM_ACTIONS,
} from '../gamestats.js';
import { modal, confirmDlg, toast } from './dialogs.js';

/*
 * Statistik-Panel pro Board: Live-Erfassung, Nachtrag (Tabelle) und Spiel-Infos.
 * Daten und Rechenlogik: ../gamestats.js
 */

export const gradeText = (g) => (g == null ? '–' : g.toFixed(1).replace('.', ','));
export const gradeClass = (g) => (g == null ? 'g-none' : g <= 1.75 ? 'g1' : g <= 2.75 ? 'g2' : g <= 3.75 ? 'g3' : g <= 4.75 ? 'g4' : 'g5');
const catLabel = (c) => (ACTION_CATS.find(([k]) => k === c) || [, c])[1];
export const signClass = (s) => (s > 0 ? 'pos' : s < 0 ? 'neg' : 'neu');
const fmtTime = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const avg = (l) => (l.length ? l.reduce((x, y) => x + y, 0) / l.length : null);
const NO_PLAYERS = 'Noch keine Spieler. Mannschaft in den Board-Einstellungen wählen oder Kartei-Spieler aufs Feld setzen.';

let view = 'live';
let ndCat = 'alle';
let keepPlayer = false;

export function openStats(tab) {
  const b = board();
  if (tab) view = tab;
  const body = h('div', { class: 'stats' });
  let sel = null; // ausgewählter Spieler (pid)
  let armed = null; // vorgewählte Aktion, falls zuerst die Aktion getippt wurde

  const tabsEl = h('div', { class: 'seg st-tabs' });
  const scoreEl = h('div', { class: 'st-score' });
  const content = h('div', { class: 'st-content' });
  body.append(h('div', { class: 'st-top' }, tabsEl, scoreEl), content);

  const renderTop = () => {
    tabsEl.replaceChildren(...[['live', 'Live'], ['nach', 'Nachtrag'], ['spiel', 'Spiel']].map(([k, l]) =>
      h('button', { class: 'seg-btn' + (view === k ? ' active' : ''), onclick: () => { view = k; render(); } }, l)));
    const g = game(b), s = gs(b), r = result(b);
    const cur = g.sets[s.set];
    scoreEl.replaceChildren(
      h('div', { class: 'st-sets' }, g.sets.map((x, i) =>
        h('button', { class: 'set-chip' + (i === s.set ? ' active' : ''), title: `Satz ${i + 1}`, onclick: () => gotoSet(b, i) }, `${x.w}:${x.g}`))),
      h('div', { class: 'st-cur' },
        h('span', { class: 'muted small' }, `Satz ${s.set + 1}`),
        h('span', { class: 'score-num' }, h('span', { class: 'wir' }, String(cur.w)), h('span', { class: 'colon' }, ':'), h('span', { class: 'geg' }, String(cur.g)))),
      h('div', { class: 'st-res muted small' }, `Sätze ${r.won}:${r.lost}`, g.isGame ? h('span', { class: 'game-badge' }, 'Spiel') : null));
  };

  const render = () => {
    const sc = content.querySelector('.nd-scroll');
    const keep = sc ? [sc.scrollLeft, sc.scrollTop] : null;
    const mb = body.closest('.modal-body');
    const top = mb ? mb.scrollTop : 0;
    renderTop();
    content.replaceChildren(view === 'live' ? renderLive() : view === 'nach' ? renderNach() : renderGame());
    const sc2 = content.querySelector('.nd-scroll');
    if (keep && sc2) [sc2.scrollLeft, sc2.scrollTop] = keep;
    if (mb) mb.scrollTop = top;
  };

  // ---------- Live ----------
  const commitAction = (pid, aid) => {
    const c = candidates(b).find((x) => x.pid === pid);
    armed = null;
    if (!keepPlayer) sel = null;
    addEvent(b, pid, aid, { live: true, team: c?.team || 'own', name: c?.name });
    toast(`${actionInfo(aid).label}${c ? ' · ' + c.name : ''}`);
  };
  const renderLive = () => {
    const cands = candidates(b);
    const own = cands.filter((c) => c.team === 'own');
    const opp = cands.filter((c) => c.team === 'opp');
    const tile = (c) =>
      h('button', {
        class: 'lv-pl' + (sel === c.pid ? ' sel' : '') + (c.played ? '' : ' bench') + (c.team === 'opp' ? ' opp' : ''),
        onclick: () => {
          if (armed) return commitAction(c.pid, armed);
          sel = sel === c.pid ? null : c.pid;
          render();
        },
      },
      h('span', { class: 'lv-kz' }, c.short || '?'),
      h('span', { class: 'lv-nm' }, c.name),
      h('span', { class: 'lv-meta' }, [c.nummer !== '' && c.nummer != null ? '#' + c.nummer : null, c.pos ? 'Pos ' + c.pos : null].filter(Boolean).join(' · ') || ' '),
      c.n ? h('span', { class: 'lv-n' }, String(c.n)) : null);
    const acts = activeActions();
    const groups = ACTION_CATS.map(([cat, label]) => [label, acts.filter((a) => a.cat === cat)]).filter(([, l]) => l.length);
    const actBtn = (a) =>
      h('button', {
        class: 'lv-act ' + signClass(a.sign) + (armed === a.id ? ' armed' : ''),
        onclick: () => {
          if (sel) return commitAction(sel, a.id);
          armed = armed === a.id ? null : a.id;
          render();
        },
      }, a.label);
    const teamBtn = (t) =>
      h('button', { class: 'lv-act team ' + (t.pt > 0 ? 'pos' : 'neg'), onclick: () => { addEvent(b, null, t.id, { live: true }); toast(t.label); } }, t.short);
    const hist = [...gs(b).ev].sort((x, y) => y.t - x.t).slice(0, 5);
    const nameOf = (pid) => cands.find((c) => c.pid === pid)?.name || (pid ? '?' : 'Team');
    const hint = sel ? `${nameOf(sel)} ausgewählt – jetzt Aktion tippen` : armed ? `${actionInfo(armed).label} – jetzt Spieler tippen` : 'Spieler tippen, dann Aktion (oder umgekehrt)';
    return h('div', { class: 'lv' },
      h('div', { class: 'lv-left' },
        h('div', { class: 'lv-hint' + (sel || armed ? ' on' : '') }, hint),
        own.length || opp.length
          ? h('div', { class: 'lv-grid' }, own.map(tile), opp.length ? h('div', { class: 'lv-sep muted small' }, 'Gegner') : null, opp.map(tile))
          : h('p', { class: 'muted' }, NO_PLAYERS),
        h('div', { class: 'lv-hist' },
          h('div', { class: 'muted small' }, 'Letzte Eingaben'),
          hist.length
            ? hist.map((e) => h('div', { class: 'lv-h' },
                h('span', { class: 'dot ' + signClass(actionInfo(e.a).pt || actionInfo(e.a).sign) }),
                h('span', { class: 'hn' }, `${nameOf(e.p)} · ${actionInfo(e.a).label}`),
                h('span', { class: 'muted small' }, `S${e.s + 1} · ${fmtTime(e.t)}`),
                h('button', { class: 'btn', 'aria-label': 'Eingabe löschen', html: I.close, onclick: () => deleteEvent(b, e.id) })))
            : h('div', { class: 'muted small' }, '–'))),
      h('div', { class: 'lv-right' },
        h('div', { class: 'lv-acts' },
          groups.map(([label, list]) => h('div', { class: 'lv-cat' }, h('div', { class: 'lv-cl' }, label), h('div', { class: 'lv-cb' }, list.map(actBtn)))),
          h('div', { class: 'lv-cat' }, h('div', { class: 'lv-cl' }, 'Ohne Spieler'), h('div', { class: 'lv-cb' }, teamBtn(TEAM_ACTIONS._wir), teamBtn(TEAM_ACTIONS._geg)))),
        h('div', { class: 'lv-foot' },
          h('label', { class: 'lv-keep' }, h('input', { type: 'checkbox', checked: keepPlayer, onchange: (e) => (keepPlayer = e.target.checked) }), 'Spieler halten'),
          h('button', { class: 'btn text lv-set', onclick: () => { nextSet(b); toast(`Satz ${gs(b).set + 1}`); } }, 'Satz beenden →'),
          h('button', { class: 'btn text lv-undo', disabled: !canUndo(b), html: I.undo + 'Rückgängig', onclick: () => { const l = undo(b); if (l) toast('Rückgängig: ' + l); } }))));
  };

  // ---------- Nachtrag ----------
  const renderNach = () => {
    const cands = candidates(b);
    const cnt = countsOf(b);
    const acts = activeActions().filter((a) => ndCat === 'alle' || a.cat === ndCat);
    const usedCats = ACTION_CATS.filter(([c]) => activeActions().some((a) => a.cat === c));
    const chips = h('div', { class: 'nd-cats' },
      [['alle', 'Alle'], ...usedCats].map(([c, l]) => h('button', { class: 'chip' + (ndCat === c ? ' active' : ''), onclick: () => { ndCat = c; render(); } }, l)));
    const cols = `minmax(150px, 1.4fr) 64px 76px repeat(${acts.length}, 124px) 64px`;
    const head = h('div', { class: 'nd-row nd-head', style: { gridTemplateColumns: cols } },
      h('div', { class: 'nd-name' }, 'Spieler'), h('div', {}, 'Einsatz'), h('div', {}, 'Pos.'),
      acts.map((a) => h('div', { class: 'nd-ah ' + signClass(a.sign), title: catLabel(a.cat) }, a.label)), h('div', {}, 'Note'));
    const totals = {};
    const grades = [];
    const row = (c) => {
      const o = cnt.get(c.pid) || {};
      const g = gradeOf(o, c.role);
      if (g != null && c.team === 'own') grades.push(g);
      const opts = { team: c.team, name: c.name };
      const roleBtn = h('button', { class: 'role-chip ' + c.role, title: 'Rolle umschalten (für die Note)', onclick: () => setPart(b, c.pid, { role: c.role === 'zuspiel' ? 'angriff' : 'zuspiel' }, opts) }, c.role === 'zuspiel' ? 'Z' : 'A');
      const sw = h('button', { class: 'switch' + (c.played ? ' on' : ''), role: 'switch', 'aria-checked': String(c.played), 'aria-label': `${c.name} hat gespielt`, onclick: () => setPart(b, c.pid, { played: !c.played }, opts) }, h('span'));
      const pos = h('select', { class: 'input select nd-pos', 'aria-label': `${c.name} Position` },
        h('option', { value: '' }, '–'), POS_NUMS.map((n) => h('option', { value: n, selected: c.pos === n, title: roleName(n) }, String(n))));
      pos.onchange = () => setPart(b, c.pid, { pos: pos.value ? +pos.value : null }, opts);
      return h('div', { class: 'nd-row' + (c.played ? '' : ' off'), style: { gridTemplateColumns: cols } },
        h('div', { class: 'nd-name' }, roleBtn, h('span', { class: 'nm' }, c.name), c.archived ? h('span', { class: 'muted small' }, ' (archiviert)') : null),
        h('div', {}, sw), h('div', {}, pos),
        acts.map((a) => {
          const v = o[a.id] || 0;
          if (c.team === 'own') totals[a.id] = (totals[a.id] || 0) + v;
          const inp = h('input', { class: 'nd-num', type: 'text', inputmode: 'numeric', value: String(v), 'aria-label': `${c.name} ${a.label}` });
          inp.addEventListener('focus', () => inp.select());
          inp.addEventListener('change', () => setCount(b, c.pid, a.id, parseInt(inp.value, 10) || 0, opts));
          inp.addEventListener('keydown', (e) => e.key === 'Enter' && inp.blur());
          return h('div', { class: 'nd-cell' },
            h('button', { class: 'btn st-btn', 'aria-label': `${c.name} ${a.label} minus`, html: I.minus, onclick: () => setCount(b, c.pid, a.id, v - 1, opts) }),
            inp,
            h('button', { class: 'btn st-btn plus', 'aria-label': `${c.name} ${a.label} plus`, html: I.plus, onclick: () => setCount(b, c.pid, a.id, v + 1, opts) }));
        }),
        h('div', {}, h('span', { class: 'grade ' + gradeClass(g) }, gradeText(g))));
    };
    const own = cands.filter((c) => c.team === 'own');
    const opp = cands.filter((c) => c.team === 'opp');
    const rows = own.map(row);
    const tg = avg(grades);
    const sum = h('div', { class: 'nd-row nd-sum', style: { gridTemplateColumns: cols } },
      h('div', { class: 'nd-name' }, 'Gesamt'), h('div', {}), h('div', {}),
      acts.map((a) => h('div', {}, String(totals[a.id] || 0))),
      h('div', {}, h('span', { class: 'grade ' + gradeClass(tg) }, gradeText(tg))));
    const oppRows = opp.length ? [h('div', { class: 'nd-sub muted small' }, 'Gegner'), ...opp.map(row)] : [];
    const info = h('details', { class: 'st-info' },
      h('summary', {}, 'Wie wird die Note berechnet?'),
      h('p', { class: 'small' }, 'Positive Aktionen +1, negative −1, neutrale 0. Gute Annahme +0,5 · Gute Abwehr +0,5 (Zuspieler +0,75) · Perfektes Zuspiel +0,5 (Zuspieler +1).'),
      h('p', { class: 'small' }, 'Die Summe wird durch die Zahl der Aktionen (+2 als Ausgleich bei wenigen Aktionen) geteilt und auf 1,0 (sehr gut) bis 6,0 umgerechnet. Team-Note = Durchschnitt. Zuspieler (Z) sind automatisch Pos. 2 und 4, per Tipp auf A/Z änderbar.'),
      h('p', { class: 'small' }, 'Nachtrag-Eingaben ändern den Satzstand nicht – Sätze trägst du unter „Spiel“ ein. In der Live-Erfassung zählen Punkte und Fehler automatisch mit.'));
    return h('div', { class: 'nd' }, chips,
      cands.length
        ? h('div', { class: 'nd-scroll' }, h('div', { class: 'nd-table' }, head, ...rows, sum, ...oppRows))
        : h('p', { class: 'muted' }, NO_PLAYERS),
      info);
  };

  // ---------- Spiel-Infos ----------
  const renderGame = () => {
    const g = game(b);
    const save = () => { touch(b); emit('stats'); emit('boards'); };
    const sw = h('button', { class: 'switch' + (g.isGame ? ' on' : ''), role: 'switch', 'aria-checked': String(g.isGame), 'aria-label': 'Dieses Board ist ein Spiel', onclick: () => { g.isGame = !g.isGame; save(); } }, h('span'));
    const date = h('input', { class: 'input', type: 'date', value: g.date });
    date.onchange = () => { g.date = date.value || g.date; save(); };
    const opp = h('input', { class: 'input', value: g.opponent, placeholder: squadById(b.oppSquadId)?.name || 'z. B. TV Musterstadt' });
    opp.onchange = () => { g.opponent = opp.value.trim(); save(); };
    const comp = h('div', { class: 'seg' }, COMPS.map(([k, l]) => h('button', { class: 'seg-btn' + (g.comp === k ? ' active' : ''), onclick: () => { g.comp = k; save(); } }, l)));
    const num = (v, set, label) => {
      const i = h('input', { class: 'input set-in', type: 'text', inputmode: 'numeric', value: String(v), 'aria-label': label });
      i.addEventListener('focus', () => i.select());
      i.onchange = () => { set(Math.max(0, parseInt(i.value, 10) || 0)); save(); };
      return i;
    };
    const sets = h('div', { class: 'sets-ed' },
      g.sets.map((s, i) => h('div', { class: 'set-line' + (i === gs(b).set ? ' cur' : '') },
        h('span', { class: 'muted' }, `Satz ${i + 1}`),
        num(s.w, (v) => (s.w = v), `Satz ${i + 1} wir`), h('b', {}, ':'), num(s.g, (v) => (s.g = v), `Satz ${i + 1} Gegner`),
        g.sets.length > 1 ? h('button', { class: 'btn danger-ic', 'aria-label': `Satz ${i + 1} löschen`, html: I.trash, onclick: () => { g.sets.splice(i, 1); gs(b); save(); } }) : null)),
      h('button', { class: 'btn text', onclick: () => { g.sets.push({ w: 0, g: 0 }); save(); } }, '+ Satz'));
    const r = result(b);
    const autoTxt = r.auto === 'win' ? 'Sieg' : r.auto === 'loss' ? 'Niederlage' : 'offen';
    const res = h('div', { class: 'seg' },
      [[null, `Automatisch (${autoTxt})`], ['win', 'Sieg'], ['loss', 'Niederlage']].map(([k, l]) =>
        h('button', { class: 'seg-btn' + (g.result === k ? ' active' : ''), onclick: () => { g.result = k; save(); } }, l)));
    const warn = g.isGame && !b.squadId
      ? h('p', { class: 'warn small' }, 'Dieses Board hat keine Board-Mannschaft und zählt deshalb nicht in die All-Time-Statistik. Mannschaft in den Board-Einstellungen wählen.')
      : !g.isGame ? h('p', { class: 'muted small' }, 'Nicht als Spiel markiert: Die Statistik dieses Boards zählt nicht in Spielerprofile und Hall of Fame (z. B. Training ohne Wertung).') : null;
    return h('div', { class: 'form st-game' },
      h('div', { class: 'set-row' }, h('div', {}, h('b', {}, 'Dieses Board ist ein Spiel'), h('div', { class: 'muted small' }, 'Zählt in All-Time-Stats und Hall of Fame')), sw),
      warn,
      h('div', { class: 'form-2' },
        h('label', { class: 'form-row' }, h('span', {}, 'Datum'), date),
        h('label', { class: 'form-row' }, h('span', {}, 'Gegner'), opp)),
      h('div', { class: 'form-row' }, h('span', {}, 'Wettbewerb'), comp),
      h('div', { class: 'form-row' }, h('span', {}, 'Ergebnis (Punkte je Satz – Wir : Gegner)'), sets),
      h('div', { class: 'form-row' }, h('span', {}, `Sieg / Niederlage · Sätze ${r.won}:${r.lost}`), res),
      h('div', { class: 'set-row' },
        h('div', {}, h('b', {}, 'Statistik zurücksetzen'), h('div', { class: 'muted small' }, 'Alle Eingaben, Einsätze und Satzergebnisse dieses Boards löschen')),
        h('button', {
          class: 'btn text danger',
          onclick: async () => {
            if (await confirmDlg('Statistik zurücksetzen?', 'Alle Eingaben, Einsätze und Satzergebnisse dieses Boards werden gelöscht. Datum, Gegner und Wettbewerb bleiben.', { okLabel: 'Zurücksetzen', danger: true }))
              resetStats(b);
          },
        }, 'Zurücksetzen')));
  };

  const m = modal({
    title: 'Statistik',
    wide: true,
    body,
  });
  m.box.classList.add('stats-modal');
  render();
  on(['stats', 'library'], () => document.body.contains(m.box) && render());
  return m;
}

/** Lasche „Statistik“ am rechten Feldrand (unter den Notizen) – immer erreichbar */
export function initStatsTab(wrap) {
  const tab = h('button', { id: 'stats-tab', 'aria-label': 'Statistik öffnen', title: 'Statistik', onclick: () => openStats() },
    h('span', { class: 'ic', html: I.stats }), h('span', { class: 'tx' }, 'Statistik'));
  wrap.append(tab);
}
