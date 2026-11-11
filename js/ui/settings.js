import { h, NS, clamp } from '../util.js';
import { state, set } from '../store.js';
import { lib, POS_NUMS, roleName, setPosition, resetPositions, DEFAULT_POSITIONS } from '../library.js';
import { modal, confirmDlg } from './dialogs.js';
import { openBoardSettings } from '../kader.js';

/** Menüpunkt „Einstellungen“ */
export function openSettings() {
  const posToggle = h('button', { class: 'switch' + (state.showPosNumbers ? ' on' : ''), role: 'switch', 'aria-checked': String(!!state.showPosNumbers) }, h('span'));
  posToggle.onclick = () => {
    set({ showPosNumbers: !state.showPosNumbers });
    posToggle.classList.toggle('on', state.showPosNumbers);
    posToggle.setAttribute('aria-checked', String(state.showPosNumbers));
  };
  const fillToggle = h('button', { class: 'switch' + (state.fillTemplates !== false ? ' on' : ''), role: 'switch', 'aria-checked': String(state.fillTemplates !== false) }, h('span'));
  fillToggle.onclick = () => {
    set({ fillTemplates: state.fillTemplates === false });
    fillToggle.classList.toggle('on', state.fillTemplates !== false);
    fillToggle.setAttribute('aria-checked', String(state.fillTemplates !== false));
  };
  modal({
    title: 'Einstellungen',
    body: h('div', { class: 'form' },
      h('div', { class: 'set-row' },
        h('div', {}, h('b', {}, 'Positionsnummern anzeigen'), h('div', { class: 'muted small' }, 'Kleine Nummer 1–5 an Figuren mit Position')),
        posToggle),
      h('div', { class: 'set-row' },
        h('div', {}, h('b', {}, 'Vorlagen mit Aufstellung füllen'), h('div', { class: 'muted small' }, 'Beim Laden einer Vorlage die Standard-Aufstellung der Board-Mannschaft einsetzen')),
        fillToggle),
      h('div', { class: 'set-row' },
        h('div', {}, h('b', {}, 'Board-Einstellungen'), h('div', { class: 'muted small' }, 'Mannschaft, Gegner, Seite, Feld, Name')),
        h('button', { class: 'btn text', onclick: () => openBoardSettings() }, 'Öffnen')),
      h('div', { class: 'set-row' },
        h('div', {}, h('b', {}, 'Positionen anpassen'), h('div', { class: 'muted small' }, 'Standardpunkte verschieben und Rollen umbenennen')),
        h('button', { class: 'btn text', onclick: openPositions }, 'Öffnen'))),
    actions: [{ label: 'Fertig', primary: true }],
  });
}

/**
 * „Positionen anpassen“: eigene Feldhälfte im Hochformat (Netz oben), 5 Punkte per Drag & Drop.
 * Gespeichert wird relativ (d = Abstand zum Netz, l = seitlich), damit es für jedes Feld passt.
 */
export function openPositions() {
  const HW = 3.05, HL = 8, PAD = 0.6; // Indiaca-Halbfeld als Vorschau (Meter)
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `${-HW - PAD} ${-PAD} ${2 * HW + 2 * PAD} ${HL + 2 * PAD}`);
  svg.classList.add('pos-editor');
  const draw = () => {
    let out = `<rect class="pe-out" x="${-HW - PAD}" y="${-PAD}" width="${2 * HW + 2 * PAD}" height="${HL + 2 * PAD}"/>` +
      `<rect class="pe-court" x="${-HW}" y="0" width="${2 * HW}" height="${HL}"/>` +
      `<line class="pe-line" x1="${-HW}" y1="3" x2="${HW}" y2="3"/>` +
      `<rect class="pe-line" x="${-HW}" y="0" width="${2 * HW}" height="${HL}"/>` +
      `<line class="pe-net" x1="${-HW - 0.3}" y1="0" x2="${HW + 0.3}" y2="0"/>` +
      `<text class="pe-lbl" x="0" y="-0.25" text-anchor="middle" font-size="0.32">Netz</text>`;
    for (const n of POS_NUMS) {
      const p = lib.positions[n];
      const x = p.l * HW, y = p.d * HL;
      out += `<g class="pe-pt" data-n="${n}" transform="translate(${x} ${y})"><circle r="0.62" class="pe-hit"/><circle r="0.42" class="pe-dot"/><text text-anchor="middle" dominant-baseline="central" font-size="0.46">${n}</text></g>`;
    }
    svg.innerHTML = out;
  };
  draw();
  let drag = null;
  const toModel = (e) => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return { l: clamp(p.x / HW, -1, 1), d: clamp(p.y / HL, 0, 1) };
  };
  svg.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('.pe-pt');
    if (!g) return;
    e.preventDefault();
    drag = +g.dataset.n;
    try { svg.setPointerCapture(e.pointerId); } catch {}
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { l, d } = toModel(e);
    lib.positions[drag].l = Math.round(l * 1000) / 1000;
    lib.positions[drag].d = Math.round(d * 1000) / 1000;
    draw();
  });
  const end = () => {
    if (drag) setPosition(drag, {}); // speichert
    drag = null;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  const names = h('div', { class: 'pe-names' });
  const renderNames = () =>
    names.replaceChildren(...POS_NUMS.map((n) => {
      const i = h('input', { class: 'input', value: roleName(n), 'aria-label': `Rolle Position ${n}` });
      i.addEventListener('change', () => setPosition(n, { rolle: i.value.trim() || DEFAULT_POSITIONS[n].rolle }));
      return h('label', { class: 'pe-name' }, h('span', { class: 'pe-num' }, String(n)), i);
    }));
  renderNames();
  modal({
    title: 'Positionen anpassen',
    wide: true,
    body: h('div', { class: 'pe' },
      h('div', { class: 'pe-field' }, svg, h('div', { class: 'muted small' }, 'Eigene Feldhälfte, Netz oben. Punkte ziehen zum Verschieben.')),
      h('div', {}, h('div', { class: 'muted small', style: { marginBottom: '6px' } }, 'Rollennamen (gegen den Uhrzeigersinn ab hinten rechts)'), names)),
    actions: [
      { label: 'Zurücksetzen', danger: true, onClick: async () => { if (await confirmDlg('Positionen zurücksetzen?', 'Alle 5 Positionen und Rollennamen werden auf den Standard gesetzt.', { okLabel: 'Zurücksetzen', danger: true })) { resetPositions(); draw(); renderNames(); } return false; } },
      { label: 'Fertig', primary: true },
    ],
  });
}
