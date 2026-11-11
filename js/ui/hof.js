import { h } from '../util.js';
import { I } from '../icons.js';
import { on } from '../store.js';
import { lib, squadById } from '../library.js';
import { DEFAULT_FILTER, seasonLabel } from '../alltime.js';
import { hof, hofChanged, computeHof, randomSaying, catRule, HOF_TYPES, addCat, deleteCat, resetCat } from '../hof.js';
import { modal, confirmDlg, toast } from './dialogs.js';
import { filterBar, openProfile } from './profile.js';

const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };

/** Menüpunkt „Hall of Fame“ */
export function openHof() {
  const f = { ...DEFAULT_FILTER };
  const sayings = {}; // pro Kategorie ein Spruch, bleibt beim Neuzeichnen stehen
  const say = (c) => (sayings[c.id] ??= randomSaying(c));
  const body = h('div', { class: 'hof' });
  let m;
  let first = true;

  const filterText = () => [f.season === 'alle' ? 'Alle Spiele' : 'Saison ' + seasonLabel(+f.season), f.squad === 'alle' ? null : squadById(f.squad)?.name].filter(Boolean).join(' · ');

  const card = (r) => {
    const c = r.cat;
    const saying = say(c);
    return h('div', { class: 'hof-card' + (c.shame ? ' shame' : '') + (first ? ' anim' : '') },
      h('div', { class: 'hof-ch' },
        h('span', { class: 'hof-emo' }, c.emoji),
        h('div', { class: 'hof-tt' }, h('b', {}, c.title), h('span', { class: 'muted small' }, catRule(c))),
        h('button', { class: 'btn', title: 'Als Bild teilen', 'aria-label': `${c.title} als Bild teilen`, html: I.share, onclick: () => shareImage([r], c.title, filterText(), sayings) })),
      r.rows.length
        ? h('div', { class: 'hof-rows' }, r.rows.map((x, i) =>
            h('button', { class: 'hof-row' + (x.rank === 1 ? ' first' : ''), style: { animationDelay: `${i * 60}ms` }, onclick: () => openProfile(x.pid) },
              h('span', { class: 'hof-rank' }, r.record ? '🏅' : x.rank === 1 ? '👑' : MEDAL[x.rank] || x.rank + '.'),
              h('span', { class: 'hof-nm' }, h('b', {}, x.name), x.sub ? h('span', { class: 'muted small' }, x.sub) : null),
              h('span', { class: 'hof-val' }, x.text))))
        : h('p', { class: 'muted small hof-none' }, 'Noch kein Halter – der Titel ist zu haben!'),
      saying ? h('button', { class: 'hof-say', title: 'Anderer Spruch', onclick: () => { sayings[c.id] = randomSaying(c); render(); } }, `„${saying}“`) : null);
  };

  const render = () => {
    const H = hof();
    const res = computeHof(f);
    const fame = res.filter((r) => !r.cat.shame);
    const shame = res.filter((r) => r.cat.shame);
    const shameSw = h('button', { class: 'switch' + (H.shame ? ' on' : ''), role: 'switch', 'aria-checked': String(H.shame), 'aria-label': 'Wall of Shame anzeigen', onclick: () => { H.shame = !H.shame; hofChanged(); } }, h('span'));
    const empty = !res.some((r) => r.rows.length);
    body.replaceChildren(...[
      h('div', { class: 'hof-top' },
        filterBar(f, render, { comp: false }),
        h('label', { class: 'hof-sw' }, shameSw, h('span', {}, 'Wall of Shame')),
        h('button', { class: 'btn text primary', html: I.share + 'Teilen', onclick: () => shareImage(res, 'Hall of Fame', filterText(), sayings) }),
        h('button', { class: 'btn', title: 'Kategorien & Sprüche bearbeiten', 'aria-label': 'Hall of Fame bearbeiten', html: I.gear, onclick: openHofSettings })),
      empty ? h('div', { class: 'prof-empty' }, h('p', {}, 'Noch keine Spiele in der Wertung.'), h('p', { class: 'muted small' }, 'Es zählen Boards, die unter Statistik → Spiel als „Spiel“ markiert sind und eine Board-Mannschaft haben.')) : null,
      h('div', { class: 'hof-grid' }, fame.map(card)),
      shame.length ? h('h3', { class: 'hof-shame-h' }, '🙈 Wall of Shame') : null,
      shame.length ? h('div', { class: 'hof-grid' }, shame.map(card)) : null].filter(Boolean));
    first = false;
  };
  render();
  m = modal({ title: '🏆 Hall of Fame', wide: true, body });
  m.box.classList.add('hof-modal');
  on(['library', 'stats', 'boards'], () => document.body.contains(m.box) && render());
}

// ---------- Teilen als Bild ----------
function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}
function rr(ctx, x, y, w, hh, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + hh, r);
  ctx.arcTo(x + w, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Zeichnet die Kategorien als PNG (Hochformat, gut für WhatsApp) */
export function drawShare(results, title, subtitle, sayings = {}) {
  const W = 1080, P = 48, CW = W - 2 * P;
  const FONT = '-apple-system, system-ui, "Segoe UI", Roboto, sans-serif';
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  // Höhe vorab berechnen
  ctx.font = `italic 30px ${FONT}`;
  const blocks = results.map((r) => {
    const s = sayings[r.cat.id] || randomSaying(r.cat);
    const lines = s ? wrap(ctx, `„${s}“`, CW - 60) : [];
    const rows = r.rows.length || 1;
    return { r, lines, hh: 120 + rows * 70 + lines.length * 40 + 30 };
  });
  const H = 210 + blocks.reduce((a, b) => a + b.hh + 24, 0) + 70;
  cv.width = W;
  cv.height = H;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0b1d3a');
  g.addColorStop(1, '#13325f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#facc15';
  ctx.font = `900 64px ${FONT}`;
  ctx.fillText(`🏆 ${title}`, P, 110);
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.font = `600 30px ${FONT}`;
  ctx.fillText(['Indiaca', subtitle].filter(Boolean).join(' · '), P, 160);
  let y = 210;
  for (const { r, lines, hh } of blocks) {
    const c = r.cat;
    rr(ctx, P, y, CW, hh, 28);
    ctx.fillStyle = c.shame ? 'rgba(239,68,68,.16)' : 'rgba(255,255,255,.08)';
    ctx.fill();
    ctx.font = `56px ${FONT}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(c.emoji, P + 28, y + 76);
    ctx.font = `800 42px ${FONT}`;
    ctx.fillText(c.title, P + 110, y + 66);
    ctx.font = `500 24px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.fillText(catRule(c), P + 110, y + 98);
    let ry = y + 120;
    if (!r.rows.length) {
      ctx.font = `500 30px ${FONT}`;
      ctx.fillText('Noch kein Halter – der Titel ist zu haben!', P + 30, ry + 46);
      ry += 70;
    }
    for (const x of r.rows) {
      const top = x.rank === 1;
      if (top) {
        rr(ctx, P + 16, ry + 4, CW - 32, 62, 16);
        ctx.fillStyle = 'rgba(250,204,21,.18)';
        ctx.fill();
      }
      ctx.fillStyle = '#fff';
      ctx.font = `40px ${FONT}`;
      ctx.fillText(r.record ? '🏅' : top ? '👑' : MEDAL[x.rank] || `${x.rank}.`, P + 30, ry + 50);
      ctx.font = `${top ? 800 : 600} 34px ${FONT}`;
      const name = x.name.length > 26 ? x.name.slice(0, 25) + '…' : x.name;
      ctx.fillText(name, P + 96, ry + 46);
      if (x.sub) {
        ctx.font = `500 20px ${FONT}`;
        ctx.fillStyle = 'rgba(255,255,255,.6)';
        ctx.fillText(x.sub.length > 48 ? x.sub.slice(0, 47) + '…' : x.sub, P + 96, ry + 66);
      }
      ctx.font = `900 40px ${FONT}`;
      ctx.fillStyle = top ? '#facc15' : '#fff';
      ctx.textAlign = 'right';
      ctx.fillText(x.text, W - P - 30, ry + 50);
      ctx.textAlign = 'left';
      ry += 70;
    }
    ctx.font = `italic 30px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (const l of lines) {
      ry += 40;
      ctx.fillText(l, P + 30, ry);
    }
    y += hh + 24;
  }
  ctx.font = `500 22px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,.45)';
  ctx.fillText('Indiaca Taktikboard', P, H - 30);
  return cv;
}

export async function shareImage(results, title, subtitle, sayings) {
  const cv = drawShare(results, title, subtitle, sayings);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  if (!blob) return toast('Bild konnte nicht erstellt werden');
  const name = `hall-of-fame-${title.toLowerCase().replace(/[^a-zäöüß0-9]+/g, '-').replace(/^-|-$/g, '')}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = h('a', { href: URL.createObjectURL(file), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
  toast('Bild gespeichert');
}

// ---------- Einstellungen: Kategorien & Sprüche ----------
export function openHofSettings() {
  const box = h('div', { class: 'hofs' });
  const open = new Set();
  const render = () => {
    const H = hof();
    const num = (key, label) => {
      const i = h('input', { class: 'input', type: 'text', inputmode: 'numeric', value: String(H[key]), 'aria-label': label, style: { width: '80px' } });
      i.onchange = () => { H[key] = Math.max(1, parseInt(i.value, 10) || 1); hofChanged(); };
      return h('div', { class: 'set-row' }, h('b', {}, label), i);
    };
    const shameSw = h('button', { class: 'switch' + (H.shame ? ' on' : ''), role: 'switch', 'aria-checked': String(H.shame), 'aria-label': 'Wall of Shame anzeigen', onclick: () => { H.shame = !H.shame; hofChanged(); } }, h('span'));
    const actOpts = (cur) => lib.actions.map((a) => h('option', { value: a.id, selected: a.id === cur }, a.label));
    box.replaceChildren(
      h('div', { class: 'set-row' }, h('div', {}, h('b', {}, 'Wall of Shame'), h('div', { class: 'muted small' }, 'Lustige Negativ-Kategorien (z. B. Netz-Magnet, Raketenstart) anzeigen')), shameSw),
      num('minGames', 'Mindestanzahl Spiele (Siegquote, Schnitt)'),
      num('minAttempts', 'Mindestanzahl Angriffe (Effizienz)'),
      h('h3', {}, 'Kategorien'),
      ...H.cats.map((c) => {
        const emo = h('input', { class: 'input hofs-emo', value: c.emoji, maxlength: 4, 'aria-label': 'Emoji' });
        emo.onchange = () => { c.emoji = emo.value.trim() || c.emoji; hofChanged(); };
        const title = h('input', { class: 'input', value: c.title, 'aria-label': 'Titel' });
        title.onchange = () => { c.title = title.value.trim() || c.title; hofChanged(); };
        const sw = h('button', { class: 'switch' + (c.active ? ' on' : ''), role: 'switch', 'aria-checked': String(c.active), 'aria-label': `${c.title} anzeigen`, onclick: () => { c.active = !c.active; hofChanged(); } }, h('span'));
        const say = h('textarea', { class: 'input hofs-say', rows: 4, 'aria-label': 'Sprüche, einer pro Zeile' }, c.sayings.join('\n'));
        say.onchange = () => { c.sayings = say.value.split('\n').map((x) => x.trim()).filter(Boolean); hofChanged(); };
        const custom = c.builtin ? null : (() => {
          const type = h('select', { class: 'input select', 'aria-label': 'Art' }, HOF_TYPES.map(([t, l]) => h('option', { value: t, selected: c.type === t }, l)));
          type.onchange = () => { c.type = type.value; hofChanged(); };
          const act = h('select', { class: 'input select', 'aria-label': 'Aktion' }, actOpts(c.action));
          act.onchange = () => { c.action = act.value; hofChanged(); };
          const shame = h('button', { class: 'switch' + (c.shame ? ' on' : ''), role: 'switch', 'aria-checked': String(c.shame), 'aria-label': 'Wall of Shame', onclick: () => { c.shame = !c.shame; hofChanged(); } }, h('span'));
          return h('div', { class: 'form-2' },
            h('label', { class: 'form-row' }, h('span', {}, 'Art'), type),
            ['sum', 'avg'].includes(c.type) ? h('label', { class: 'form-row' }, h('span', {}, 'Aktion'), act) : h('span'),
            h('div', { class: 'set-row' }, h('b', {}, 'Gehört zur Wall of Shame'), shame));
        })();
        const det = h('details', { class: 'hofs-cat', open: open.has(c.id) },
          h('summary', {}, h('span', { class: 'hof-emo sm' }, c.emoji), h('b', {}, c.title), h('span', { class: 'muted small' }, ` · ${catRule(c)}${c.shame ? ' · Shame' : ''}${c.active ? '' : ' · aus'}`)),
          h('div', { class: 'form' },
            h('div', { class: 'hofs-line' }, emo, title, sw),
            custom,
            h('label', { class: 'form-row' }, h('span', {}, `Sprüche (einer pro Zeile, zufällige Auswahl)`), say),
            c.builtin
              ? h('button', { class: 'btn text', onclick: async () => { if (await confirmDlg('Kategorie zurücksetzen?', `Titel, Emoji und Sprüche von „${c.title}“ auf Standard setzen?`, { okLabel: 'Zurücksetzen' })) resetCat(c.id); } }, 'Auf Standard zurücksetzen')
              : h('button', { class: 'btn text danger', onclick: async () => { if (await confirmDlg('Kategorie löschen?', `„${c.title}“ wird entfernt.`, { okLabel: 'Löschen', danger: true })) deleteCat(c.id); } }, 'Kategorie löschen')));
        det.addEventListener('toggle', () => (det.open ? open.add(c.id) : open.delete(c.id)));
        return det;
      }),
      h('button', {
        class: 'btn text primary', onclick: () => {
          const c = addCat({ emoji: '⭐', title: 'Neue Kategorie', type: 'sum', action: lib.actions.find((a) => a.sign > 0)?.id, sayings: [] });
          open.add(c.id);
        },
      }, '+ Eigene Kategorie'));
  };
  render();
  const m = modal({ title: 'Hall of Fame bearbeiten', wide: true, body: box, actions: [{ label: 'Fertig', primary: true }] });
  on('library', () => document.body.contains(m.box) && render());
}
