import { h, colorCss, clone, uid } from '../util.js';
import { I } from '../icons.js';
import { COLORS, clampPlayer } from '../model.js';
import { state, on, findEl, page, board, commit, snapshot, changed, select, scale } from '../store.js';
import { colorPicker } from './dialogs.js';

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
        if (c.type === 'player') { c.y += d; clampPlayer(c, board().fieldType); }
        else if ('x' in c) { c.x += d; c.y += d; }
        if (c.points) c.points = c.points.map((q) => [q[0] + d, q[1] + d]);
        if ('x1' in c) { c.x1 += d; c.x2 += d; c.y1 += d; c.y2 += d; }
        if (c.from) c.from = { x: c.from.x + d, y: c.from.y + d };
        commit((p) => p.elements.push(c));
        select(c.id);
      },
    });
  const lbl = (t) => h('span', { class: 'sel-lbl' }, t);

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
      const sz = h('input', { type: 'range', min: '0.5', max: '2', step: '0.1', value: el.size || 1, class: 'range', 'aria-label': 'Größe' });
      sz.addEventListener('pointerdown', snapshot);
      sz.addEventListener('input', () => { findEl(el.id).size = +sz.value; changed(); });
      parts.push(lbl('Größe'), sz, textInput(el, 'label', 'Name (optional)', 10), swatches(el), dup(el));
    } else if (el.type === 'marker') {
      const p = page();
      parts.push(
        h('button', { class: 'btn' + (el.symbol === 'dot' ? ' active' : ''), html: I.dot, 'aria-label': 'Punkt', onclick: () => commit(() => (findEl(el.id).symbol = 'dot')) }),
        h('button', { class: 'btn' + (el.symbol === 'x' ? ' active' : ''), html: I.x, 'aria-label': 'Kreuz', onclick: () => commit(() => (findEl(el.id).symbol = 'x')) }),
        textInput(el, 'label', 'Beschriftung', 12)
      );
      if (el.serveType && p.serveTypes?.length) {
        const s = h('select', { class: 'input sm select' }, p.serveTypes.map((t) => h('option', { value: t.id, selected: t.id === el.serveType }, t.name)));
        s.onchange = () => commit(() => (findEl(el.id).serveType = s.value));
        parts.push(s);
      } else parts.push(swatches(el));
      if (el.from) parts.push(h('button', { class: 'btn text small', onclick: () => commit(() => delete findEl(el.id).from) }, 'Pfeil weg'));
      else parts.push(h('button', { class: 'btn text small', onclick: () => commit(() => (findEl(el.id).from = { x: el.x - 2 * scale(), y: el.y })) }, '+ Pfeil'));
    } else if (el.type === 'zone') {
      const r = h('input', { type: 'range', min: '0.1', max: '0.8', step: '0.05', value: el.opacity, class: 'range', 'aria-label': 'Deckkraft' });
      r.addEventListener('pointerdown', snapshot);
      r.addEventListener('input', () => { findEl(el.id).opacity = +r.value; changed(); });
      parts.push(swatches(el), lbl('Deckkraft'), r, dup(el));
    } else if (el.type === 'arrow') {
      parts.push(swatches(el),
        h('button', { class: 'btn' + (el.dashed ? ' active' : ''), html: I.dash, 'aria-label': 'Gestrichelt', onclick: () => commit(() => (findEl(el.id).dashed = !el.dashed)) }),
        dup(el));
    }
    parts.push(del(el));
    bar.replaceChildren(...parts);
    bar.classList.add('show');
  };

  const updateHint = () => {
    const p = page();
    let t = '';
    if (!state.selectionId) {
      if (state.tool === 'marker') t = 'Tippen: Ziel setzen · Ziehen: Ziel mit Pfeil vom Startpunkt';
      else if (state.tool === 'cone') t = 'Vom Spieler aus in Blickrichtung ziehen';
      else if (['rect', 'tri', 'circle', 'free'].includes(state.tool)) t = 'Ziehen, um die Form aufzuziehen';
      else if (state.tool === 'select') t = 'Antippen: auswählen · Ziehen: verschieben · 2 Finger: zoomen & drehen';
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
    if (bar.contains(document.activeElement)) return;
    if (shownId !== state.selectionId || state.selectionId) build();
  });
  on('page', updateHint);
}
