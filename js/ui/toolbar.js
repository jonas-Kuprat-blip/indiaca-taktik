import { h, colorCss } from '../util.js';
import { I } from '../icons.js';
import { COLORS, WIDTHS } from '../model.js';
import { state, on, set, setTool, undo, redo, canUndo, canRedo, board, page, renameBoard } from '../store.js';
import { promptText, colorPicker } from './dialogs.js';
import { openBoardManager } from './boards.js';

const TOOLS = [
  ['select', I.select, 'Auswählen / Verschieben'],
  ['pen', I.pen, 'Stift'],
  ['arrow', I.arrow, 'Pfeil'],
  ['eraser', I.eraser, 'Radierer'],
];
const THEMES = ['auto', 'light', 'dark'];
const THEME_LABEL = { auto: 'Theme: automatisch', light: 'Theme: hell', dark: 'Theme: dunkel' };

export function initToolbar(root) {
  const btn = (icon, label, onclick, extra = {}) =>
    h('button', { class: 'btn', 'aria-label': label, title: label, html: icon, onclick, ...extra });

  const boardsBtn = btn(I.boards, 'Boards verwalten', () => openBoardManager());
  const nameBtn = h('button', {
    class: 'btn text board-name',
    title: 'Board umbenennen',
    onclick: async () => {
      const n = await promptText('Board umbenennen', board().name);
      if (n) renameBoard(board().id, n);
    },
  });

  const toolBtns = TOOLS.map(([t, icon, label]) => {
    const b = btn(icon, label, () => setTool(t));
    b.dataset.tool = t;
    return b;
  });

  const colorBtns = COLORS.map((c) => {
    const b = h('button', { class: 'swatch-btn', 'aria-label': c === 'ink' ? 'Schwarz/Weiß' : c, onclick: () => set({ color: c }) },
      h('span', { class: 'swatch', style: { background: colorCss(c) } }));
    b.dataset.color = c;
    return b;
  });
  const customBtn = h('button', { class: 'swatch-btn', 'aria-label': 'Eigene Farbe', title: 'Eigene Farbe' },
    h('span', { class: 'swatch rainbow' }));
  customBtn.onclick = () => colorPicker(customBtn, state.color, (c) => set({ color: c }));

  const widthBtns = WIDTHS.map((w, i) => {
    const b = h('button', { class: 'btn width-btn', 'aria-label': `Strichstärke ${i + 1}`, onclick: () => set({ width: w }) },
      h('span', { class: 'width-dot', style: { width: 6 + i * 5 + 'px', height: 6 + i * 5 + 'px' } }));
    b.dataset.width = w;
    return b;
  });
  const dashBtn = btn(I.dash, 'Pfeil gestrichelt', () => set({ arrowDashed: !state.arrowDashed }));

  const palmBtn = btn(I.palm, 'Nur Stift zeichnet (Finger verschieben)', () => set({ palmRejection: !state.palmRejection }));
  const undoBtn = btn(I.undo, 'Rückgängig', undo);
  const redoBtn = btn(I.redo, 'Wiederholen', redo);
  const notesBtn = btn(I.notes, 'Notizen', () => set({ notesOpen: !state.notesOpen }));
  const rotBtn = btn(I.rotate, 'Feld drehen (hoch/quer)', () => set({ orientation: state.orientation === 'quer' ? 'hoch' : 'quer' }));
  const themeBtn = btn(I.theme, 'Theme', () => set({ theme: THEMES[(THEMES.indexOf(state.theme) + 1) % 3] }));

  const widthGroup = h('div', { class: 'group' }, widthBtns, dashBtn);
  root.append(
    boardsBtn, nameBtn, h('div', { class: 'sep' }),
    h('div', { class: 'group' }, toolBtns), h('div', { class: 'sep' }),
    h('div', { class: 'group colors' }, colorBtns, customBtn), h('div', { class: 'sep' }),
    widthGroup,
    h('div', { class: 'spacer' }),
    palmBtn, undoBtn, redoBtn, rotBtn, notesBtn, themeBtn
  );

  const update = () => {
    const b = board();
    if (!b) return;
    nameBtn.textContent = b.name;
    toolBtns.forEach((x) => x.classList.toggle('active', x.dataset.tool === state.tool));
    colorBtns.forEach((x) => x.classList.toggle('active', x.dataset.color === state.color));
    customBtn.classList.toggle('active', !COLORS.includes(state.color));
    customBtn.querySelector('.swatch').style.background = COLORS.includes(state.color) ? '' : state.color;
    widthBtns.forEach((x) => x.classList.toggle('active', +x.dataset.width === state.width));
    widthGroup.style.display = ['pen', 'arrow'].includes(state.tool) ? '' : 'none';
    dashBtn.style.display = state.tool === 'arrow' ? '' : 'none';
    dashBtn.classList.toggle('active', state.arrowDashed);
    palmBtn.style.display = state.penSeen ? '' : 'none';
    palmBtn.classList.toggle('active', state.palmRejection);
    undoBtn.disabled = !canUndo();
    redoBtn.disabled = !canRedo();
    notesBtn.classList.toggle('active', state.notesOpen);
    notesBtn.classList.toggle('has-dot', !!page()?.notes?.trim());
    themeBtn.title = THEME_LABEL[state.theme];
    rotBtn.title = state.orientation === 'quer' ? 'Feld ist quer – tippen für Hochformat' : 'Feld ist hochkant – tippen für Querformat';
    if (state.theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = state.theme;
    document.getElementById('app').classList.toggle('notes-open', state.notesOpen);
  };
  on(['ui', 'elements', 'board', 'page', 'notes'], update);
}
