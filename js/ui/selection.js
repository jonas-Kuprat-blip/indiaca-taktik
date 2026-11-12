import { h, colorCss, clone, uid } from '../util.js';
import { I } from '../icons.js';
import { COLORS, clampPlayer } from '../model.js';
import { state, on, findEl, page, board, commit, snapshot, changed, select, scale } from '../store.js';
import { colorPicker } from './dialogs.js';
import { isNet, readoutText, fmtM, reachOf } from '../net.js';
import { startLink, linkPending } from '../stage.js';

/** Schwebende Leiste über dem Feld für das ausgewählte Element */
export function initSelectionBar(wrap) {
  const bar = h('div', { id: 'selbar' });
  const hint = h('div', { id: 'hint' });
  wrap.append(bar, hint);
  let shownId = null;

  const swatches = (el, key = 'color') => {
    const row = h('div', { class: 'swatch-row' },
      COLORS.map((c) =>
        h('button', { class: 'swatch-btn sm' + (el[key] === c ? ' active' : ''), 'aria-label': c, onclick: () => commit(() => (findEl(el.id)[key] = c)) },
          h('span', { class: 'swatch', style: { background: colorCss(c) } }))));
    const more = h('button', { class: 'swatch-btn sm', 'aria-label': 'Eigene Farbe' }, h('span', { class: 'swatch rainbow' }));
    more.onclick = () => colorPicker(more, el[key], (c) => commit(() => (findEl(el.id)[key] = c)));
    row.append(more);
    return row;
  };
  // Texteingabe: ein Undo-Schritt pro Bearbeitung
  const textInput = (el, key, placeholder, size = 10) => {
    const i = h('input', { class: 'input sm', value: el[key] ?? '', placeholder, size, enterkeyhint: 'done' });
    i.addEventListener('focus', snapshot);
    i.addEventListener('input', () => {
      findEl(el.id)[key] = i.value;
      changed();
    });
    i.addEventListener('keydown', (e) => e.key === 'Enter' && i.blur());
    return i;
  };
  const del = (el) => h('button', { class: 'btn danger-ic', 'aria-label': 'Löschen', title: 'Löschen', html: I.trash, onclick: () => { commit((p) => (p.elements = p.elements.filter((e) => e.id !== el.id))); select(null); } });
  const dup = (el) =>
    h('button', {
      class: 'btn', 'aria-label': 'Duplizieren', title: 'Duplizieren', html: I.copy,
      onclick: () => {
        const c = clone(el);
        c.id = uid();
        const d = 0.6 * scale();
        if (c.type === 'player') { c.y += d; clampPlayer(c, board().fieldType, board().ownSide); }
        else if ('x' in c) { c.x += d; c.y += d; }
        if (c.points) c.points = c.points.map((q) => [q[0] + d, q[1] + d]);
        if ('x1' in c) { c.x1 += d; c.x2 += d; c.y1 += d; c.y2 += d; }
        if (c.from) c.from = { x: c.from.x + d, y: c.from.y + d };
        commit((p) => p.elements.push(c));
        select(c.id);
      },
    });
  const lbl = (t) => h('span', { class: 'sel-lbl' }, t);
  // Während ein Regler gezogen wird, die Leiste nicht neu aufbauen
  let sliding = false;
  const slider = (el, key, min, max, step, label, def) => {
    const r = h('input', { type: 'range', min, max, step, value: el[key] ?? def, class: 'range', 'aria-label': label });
    r.addEventListener('pointerdown', () => { sliding = true; snapshot(); });
    const stop = () => (sliding = false);
    r.addEventListener('pointerup', stop);
    r.addEventListener('pointercancel', stop);
    r.addEventListener('change', stop);
    r.addEventListener('input', () => { findEl(el.id)[key] = +r.value; changed(); });
    return r;
  };
  /** Form um ihren Mittelpunkt skalieren */
  const scaleEl = (id, k) =>
    commit(() => {
      const el = findEl(id);
      if (el.type === 'zone' && el.shape === 'circle') el.r = Math.max(0.15, el.r * k);
      else if (el.points) {
        // Blick skaliert um die Spitze, andere Formen um ihren Mittelpunkt
        const cx = el.vee ? el.points[1][0] : el.points.reduce((a, p) => a + p[0], 0) / el.points.length;
        const cy = el.vee ? el.points[1][1] : el.points.reduce((a, p) => a + p[1], 0) / el.points.length;
        el.points = el.points.map(([x, y]) => [Math.round((cx + (x - cx) * k) * 1000) / 1000, Math.round((cy + (y - cy) * k) * 1000) / 1000]);
      } else if (el.type === 'arrow') {
        const mx = (el.x1 + el.x2) / 2, my = (el.y1 + el.y2) / 2;
        el.x1 = mx + (el.x1 - mx) * k; el.y1 = my + (el.y1 - my) * k;
        el.x2 = mx + (el.x2 - mx) * k; el.y2 = my + (el.y2 - my) * k;
      }
    });
  const sizeBtns = (el) => [
    lbl('Größe'),
    h('button', { class: 'btn', html: I.minus, 'aria-label': 'Kleiner', title: 'Kleiner', onclick: () => scaleEl(el.id, 1 / 1.15) }),
    h('button', { class: 'btn', html: I.plus, 'aria-label': 'Größer', title: 'Größer', onclick: () => scaleEl(el.id, 1.15) }),
  ];

  const build = () => {
    const el = state.selectionId && findEl(state.selectionId);
    shownId = el ? el.id : null;
    if (!el) {
      bar.replaceChildren();
      bar.classList.remove('show');
      return;
    }
    const parts = [];
    if (el.type === 'player') {
      // Drehung in 15°-Schritten, gespeichert im Bereich −180…180°
      const turnP = (d) => commit(() => { const z = findEl(el.id); z.rot = ((((z.rot || 0) + d + 180) % 360) + 360) % 360 - 180; });
      const setRole = (r) => commit(() => (findEl(el.id).role = r));
      const isSetter = el.role === 'zuspiel';
      parts.push(
        h('div', { class: 'seg' },
          h('button', { class: 'seg-btn' + (!isSetter ? ' active' : ''), onclick: () => setRole('angriff') }, 'Angreifer'),
          h('button', { class: 'seg-btn' + (isSetter ? ' active' : ''), onclick: () => setRole('zuspiel') }, 'Zuspieler')),
        lbl('Größe'), slider(el, 'size', '0.5', '2', '0.1', 'Größe', 1),
        lbl('Drehen'),
        h('button', { class: 'btn', html: I.turnL, 'aria-label': 'Spieler links drehen', title: 'Links drehen', onclick: () => turnP(-15) }),
        h('button', { class: 'btn', html: I.turnR, 'aria-label': 'Spieler rechts drehen', title: 'Rechts drehen', onclick: () => turnP(15) }),
        textInput(el, 'label', 'Name (optional)', 10), swatches(el), dup(el));
    } else if (el.type === 'marker') {
      const p = page();
      parts.push(
        h('button', { class: 'btn' + (el.symbol === 'dot' ? ' active' : ''), html: I.dot, 'aria-label': 'Punkt', onclick: () => commit(() => (findEl(el.id).symbol = 'dot')) }),
        h('button', { class: 'btn' + (el.symbol === 'x' ? ' active' : ''), html: I.x, 'aria-label': 'Kreuz', onclick: () => commit(() => (findEl(el.id).symbol = 'x')) }),
        isNet(p) ? h('button', { class: 'btn' + (el.symbol === 'ring' ? ' active' : ''), html: I.ring, 'aria-label': 'Kreis', onclick: () => commit(() => (findEl(el.id).symbol = 'ring')) }) : null,
        h('button', { class: 'btn' + (el.symbol === 'indiaca' ? ' active' : ''), html: I.indiaca, 'aria-label': 'Indiaca', onclick: () => commit(() => (findEl(el.id).symbol = 'indiaca')) }),
        lbl('Größe'), slider(el, 'size', '0.5', '2.5', '0.1', 'Größe', 1),
        textInput(el, 'label', 'Beschriftung', 10)
      );
      if (el.serveType && p.serveTypes?.length) {
        const s = h('select', { class: 'input sm select' }, p.serveTypes.map((t) => h('option', { value: t.id, selected: t.id === el.serveType }, t.name)));
        s.onchange = () => commit(() => (findEl(el.id).serveType = s.value));
        parts.push(s);
      } else parts.push(swatches(el));
      if (isNet(p)) {
        parts.push(
          h('span', { class: 'sel-lbl net-h' }, readoutText(p, board(), el.x, el.y)),
          h('button', { class: 'btn text small', onclick: () => startLink(el.id) }, 'Linie zu …'));
      } else if (el.from) parts.push(h('button', { class: 'btn text small', onclick: () => commit(() => delete findEl(el.id).from) }, 'Pfeil weg'));
      else parts.push(h('button', { class: 'btn text small', onclick: () => commit(() => (findEl(el.id).from = { x: el.x - 2 * scale(), y: el.y })) }, '+ Pfeil'));
    } else if (el.type === 'zone') {
      const r = slider(el, 'opacity', '0.1', '0.8', '0.05', 'Deckkraft', 0.3);
      const turn = (deg) => commit(() => {
        const z = findEl(el.id), [ax, ay] = z.points[1], c = Math.cos((deg * Math.PI) / 180), s2 = Math.sin((deg * Math.PI) / 180);
        z.points = z.points.map(([x, y]) => [Math.round((ax + (x - ax) * c - (y - ay) * s2) * 1000) / 1000, Math.round((ay + (x - ax) * s2 + (y - ay) * c) * 1000) / 1000]);
      });
      const rotBtns = el.vee ? [lbl('Drehen'),
        h('button', { class: 'btn', html: I.turnL, 'aria-label': 'Links drehen', title: 'Links drehen', onclick: () => turn(-15) }),
        h('button', { class: 'btn', html: I.turnR, 'aria-label': 'Rechts drehen', title: 'Rechts drehen', onclick: () => turn(15) })] : [];
      parts.push(...sizeBtns(el), ...rotBtns, swatches(el), lbl('Deckkraft'), r, dup(el));
    } else if (el.type === 'sil') {
      parts.push(
        lbl('Größe ' + fmtM(el.groesse || 1.8)), slider(el, 'groesse', '1.3', '2.2', '0.01', 'Körpergröße', 1.8),
        lbl('Sprung ' + fmtM(el.sprung || 0)), slider(el, 'sprung', '0', '1.1', '0.01', 'Sprunghöhe', 0),
        h('span', { class: 'sel-lbl net-h' }, 'Reichhöhe ' + fmtM(reachOf(el))),
        textInput(el, 'label', 'Name', 10), swatches(el));
    } else if (el.type === 'link') {
      parts.push(lbl('Linie'), swatches(el),
        h('button', { class: 'btn' + (el.dashed !== false ? ' active' : ''), html: I.dash, 'aria-label': 'Gestrichelt', onclick: () => commit(() => (findEl(el.id).dashed = el.dashed === false)) }));
    } else if (el.type === 'arrow') {
      parts.push(...sizeBtns(el), swatches(el),
        h('button', { class: 'btn' + (el.dashed ? ' active' : ''), html: I.dash, 'aria-label': 'Gestrichelt', onclick: () => commit(() => (findEl(el.id).dashed = !el.dashed)) }),
        dup(el));
    }
    parts.push(del(el));
    bar.replaceChildren(...parts.filter(Boolean));
    bar.classList.add('show');
  };

  const updateHint = () => {
    const p = page();
    let t = '';
    if (linkPending()) t = 'Zweiten Marker antippen (woanders tippen = abbrechen)';
    else if (!state.selectionId) {
      if (state.tool === 'marker' && isNet(p)) t = 'Tippen: Marker setzen · Ziehen: Höhe live einstellen';
      else if (state.tool === 'marker') t = 'Tippen: Ziel setzen · Ziehen: Ziel mit Pfeil vom Startpunkt';
      else if (state.tool === 'cone') t = 'Vom Spieler aus in Blickrichtung ziehen';
      else if (['rect', 'tri', 'circle', 'free'].includes(state.tool)) t = 'Ziehen, um die Form aufzuziehen';
      else if (state.tool === 'select') t = 'Antippen: auswählen · Ziehen: verschieben · 2 Finger: zoomen';
      else if (p.kind === 'angabe' && state.tool !== 'eraser') t = '';
    }
    hint.textContent = t;
    hint.classList.toggle('show', !!t);
  };

  on('ui', () => {
    build();
    updateHint();
  });
  on('elements', () => {
    // Nicht neu aufbauen, während getippt wird
    if (sliding || bar.contains(document.activeElement)) return;
    if (shownId !== state.selectionId || state.selectionId) build();
  });
  on('page', updateHint);
}
