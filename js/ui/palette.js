import { h, colorCss } from '../util.js';
import { I } from '../icons.js';
import { state, on, set, setTool, board, setTeam } from '../store.js';
import { dropPlayer, addPlayerDefault } from '../stage.js';
import { colorPicker } from './dialogs.js';

export function initPalette(root) {
  // --- Spieler ---
  const teamCols = ['own', 'opp'].map((team) => {
    const head = h('button', { class: 'team-head', title: 'Teamfarbe ändern', 'aria-label': 'Teamfarbe ändern' });
    head.onclick = () => colorPicker(head, board().teams[team].color, (c) => setTeam(team, { color: c }), { allowInk: false });
    const tokens = [1, 2, 3, 4, 5].map((n) => {
      const t = h('div', { class: 'token', role: 'button', 'aria-label': `Spieler ${n} (${team === 'own' ? 'eigenes Team' : 'Gegner'})` });
      bindTokenDrag(t, team, n);
      return t;
    });
    return { team, head, tokens, col: h('div', { class: 'team-col' }, head, tokens) };
  });

  // --- Werkzeuge ---
  const toolBtn = (tool, icon, label, extra) => {
    const b = h('button', { class: 'btn pal-btn', title: label, 'aria-label': label, html: icon + `<span>${label}</span>`, onclick: () => { setTool(tool); extra && extra(); } });
    b.dataset.tool = tool;
    return b;
  };
  const zoneBtns = [toolBtn('rect', I.rect, 'Rechteck'), toolBtn('tri', I.tri, 'Dreieck'), toolBtn('circle', I.circle, 'Kreis'), toolBtn('free', I.free, 'Freiform')];
  const markerBtns = [
    toolBtn('marker', I.dot, 'Punkt', () => set({ markerSymbol: 'dot' })),
    toolBtn('marker', I.x, 'Kreuz', () => set({ markerSymbol: 'x' })),
  ];
  markerBtns[0].dataset.symbol = 'dot';
  markerBtns[1].dataset.symbol = 'x';

  root.append(
    h('div', { class: 'pal-sec' }, h('div', { class: 'pal-h' }, 'Spieler'), h('div', { class: 'teams' }, teamCols.map((c) => c.col))),
    h('div', { class: 'pal-sec' }, h('div', { class: 'pal-h' }, 'Ziel / Position'), h('div', { class: 'pal-grid' }, markerBtns)),
    h('div', { class: 'pal-sec' }, h('div', { class: 'pal-h' }, 'Zonen'), h('div', { class: 'pal-grid' }, zoneBtns))
  );

  const update = () => {
    const b = board();
    if (!b) return;
    for (const c of teamCols) {
      const t = b.teams[c.team];
      c.head.innerHTML = `<span class="dot" style="background:${colorCss(t.color)}"></span>`;
      c.tokens.forEach((tk) => (tk.style.background = colorCss(t.color)));
    }
    zoneBtns.forEach((x) => x.classList.toggle('active', state.tool === x.dataset.tool));
    markerBtns.forEach((x) => x.classList.toggle('active', state.tool === 'marker' && state.markerSymbol === x.dataset.symbol));
  };
  on(['ui', 'board', 'page'], update);
}

/** Token aus der Palette ziehen (oder antippen = Grundposition) */
function bindTokenDrag(tokenEl, team, number) {
  let start = null, ghost = null;
  tokenEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    tokenEl.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY };
  });
  tokenEl.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (!ghost && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) {
      ghost = tokenEl.cloneNode(true);
      ghost.classList.add('ghost');
      document.body.append(ghost);
    }
    if (ghost) {
      ghost.style.left = e.clientX + 'px';
      ghost.style.top = e.clientY + 'px';
    }
  });
  const end = (e, ok) => {
    if (!start) return;
    if (ghost) {
      ghost.remove();
      ghost = null;
      if (ok) dropPlayer(team, number, e.clientX, e.clientY);
    } else if (ok) addPlayerDefault(team, number);
    start = null;
  };
  tokenEl.addEventListener('pointerup', (e) => end(e, true));
  tokenEl.addEventListener('pointercancel', (e) => end(e, false));
}
