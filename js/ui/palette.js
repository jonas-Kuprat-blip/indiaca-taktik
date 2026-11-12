import { h } from '../util.js';
import { kaderGroups, placeRosterPlayer, openInsertLineup } from '../kader.js';
import { isOverStage } from '../stage.js';
import { playerIcon } from '../render.js';
import { I } from '../icons.js';
import { state, on, set, setTool, board, page } from '../store.js';
import { dropPlayer, addPlayerDefault } from '../stage.js';
import { isNet, DEFAULT_LEGEND, legendLabel } from '../net.js';

export function initPalette(root) {
  // --- Spieler ---
  const teamCols = ['own', 'opp'].map((team) => {
    const t = h('div', { class: 'token', role: 'button', title: team === 'own' ? 'Eigener Spieler (blau)' : 'Gegner (rot)', 'aria-label': team === 'own' ? 'Eigener Spieler' : 'Gegnerischer Spieler' });
    bindTokenDrag(t, team);
    return { team, token: t, col: t };
  });

  // --- Werkzeuge ---
  const toolBtn = (tool, icon, label, extra) => {
    const b = h('button', { class: 'btn pal-btn', title: label, 'aria-label': label, html: icon + `<span>${label}</span>`, onclick: () => { setTool(tool); extra && extra(); } });
    b.dataset.tool = tool;
    return b;
  };
  const zoneBtns = [toolBtn('rect', I.rect, 'Rechteck'), toolBtn('tri', I.tri, 'Dreieck'), toolBtn('cone', I.cone, 'Blick'), toolBtn('circle', I.circle, 'Kreis'), toolBtn('free', I.free, 'Freiform')];
  const markerBtns = [
    toolBtn('marker', I.dot, 'Punkt', () => set({ markerSymbol: 'dot' })),
    toolBtn('marker', I.x, 'Kreuz', () => set({ markerSymbol: 'x' })),
    toolBtn('marker', I.indiaca, 'Indiaca', () => set({ markerSymbol: 'indiaca' })),
  ];
  markerBtns[2].dataset.symbol = 'indiaca';
  markerBtns[0].dataset.symbol = 'dot';
  markerBtns[1].dataset.symbol = 'x';

  // --- Netzansicht: Höhen-Marker ---
  const netBtns = [
    toolBtn('marker', I.x, 'Kreuz', () => set({ markerSymbol: 'x' })),
    toolBtn('marker', I.ring, 'Kreis', () => set({ markerSymbol: 'ring' })),
    toolBtn('marker', I.dot, 'Punkt', () => set({ markerSymbol: 'dot' })),
  ];
  ['x', 'ring', 'dot'].forEach((sy, i) => (netBtns[i].dataset.symbol = sy));
  const netColors = h('div', { class: 'net-cols' });
  const renderNetColors = () => {
    const p = page();
    if (!p || !isNet(p)) return;
    netColors.replaceChildren(...Object.keys(DEFAULT_LEGEND).map((c) =>
      h('button', { class: 'net-col' + (state.color === c ? ' active' : ''), onclick: () => { set({ color: c }); if (state.tool !== 'marker') setTool('marker'); } },
        h('i', { style: { background: c } }), h('span', {}, legendLabel(p, c) || c))));
  };

  // --- Kader: Kartei-Spieler (je nach Board-Mannschaft) ---
  const kSearch = h('input', { class: 'input sm kader-search', type: 'search', placeholder: 'Suchen …', 'aria-label': 'Kader durchsuchen' });
  const kList = h('div', { class: 'kader-list' });
  const renderKader = () => {
    const b = board();
    if (!b) return;
    const q = kSearch.value.trim().toLowerCase();
    const onPage = new Set(page().elements.filter((e) => e.type === 'player' && e.rosterId).map((e) => e.rosterId));
    const groups = kaderGroups(b);
    const items = [];
    for (const g of groups) {
      const players = g.players.filter((p) => !q || p.name.toLowerCase().includes(q) || p.kuerzel.toLowerCase().includes(q));
      if (groups.length > 1 || g.team) items.push(h('div', { class: 'kader-grp' }, h('span', { class: 'dot', style: { background: g.color || 'var(--muted)' } }), g.title));
      for (const p of players) {
        const it = h('div', { class: 'kader-item' + (onPage.has(p.id) ? ' used' : ''), role: 'button', title: p.name + (onPage.has(p.id) ? ' (steht schon auf dem Feld)' : '') },
          h('span', { class: 'ros-badge sm', style: { background: g.color || 'var(--accent)' } }, p.kuerzel),
          h('span', { class: 'kader-name' }, p.name));
        bindKaderItem(it, p.id);
        items.push(it);
      }
      if (!players.length) items.push(h('div', { class: 'muted small kader-empty' }, q ? 'Kein Treffer' : 'Keine Spieler'));
    }
    kList.replaceChildren(...items);
  };
  kSearch.addEventListener('input', renderKader);
  const insertBtn = h('button', { class: 'btn text small kader-insert', onclick: openInsertLineup }, 'Aufstellung einsetzen');

  root.append(
    h('div', { class: 'pal-sec', 'data-sec': 'spieler' }, h('div', { class: 'pal-h' }, 'Spieler'), h('div', { class: 'teams' }, teamCols.map((c) => c.col))),
    h('div', { class: 'pal-sec', 'data-sec': 'kader' }, h('div', { class: 'pal-h' }, 'Kader'), kSearch, kList, insertBtn),
    h('div', { class: 'pal-sec', 'data-sec': 'ziel' }, h('div', { class: 'pal-h' }, 'Ziel / Position'), h('div', { class: 'pal-grid' }, markerBtns)),
    h('div', { class: 'pal-sec', 'data-sec': 'netz' }, h('div', { class: 'pal-h' }, 'Höhen-Marker'), h('div', { class: 'pal-grid' }, netBtns), netColors,
      h('div', { class: 'muted small net-tip' }, 'Tippen setzt, Ziehen zeigt Höhe live.')),
    h('div', { class: 'pal-sec', 'data-sec': 'zonen' }, h('div', { class: 'pal-h' }, 'Zonen'), h('div', { class: 'pal-grid' }, zoneBtns))
  );
  // Netzansicht: andere Palette (keine Feld-Spieler, keine Feld-Ziele)
  const secs = (n) => root.querySelector(`.pal-sec[data-sec="${n}"]`) || document.querySelector(`.pal-sec[data-sec="${n}"]`);
  const syncKind = () => {
    const net = isNet(page());
    for (const n of ['spieler', 'kader', 'ziel']) { const el = secs(n); if (el) el.style.display = net ? 'none' : ''; }
    const ne = secs('netz');
    if (ne) ne.style.display = net ? '' : 'none';
    renderNetColors();
  };
  on(['page', 'board', 'ui'], syncKind);
  on(['board', 'page', 'elements', 'library', 'boardSquad'], renderKader);

  const update = () => {
    const b = board();
    if (!b) return;
    for (const c of teamCols) c.token.innerHTML = `<svg viewBox="-0.5 -0.5 1 1" aria-hidden="true">${playerIcon(b.teams[c.team].color, 1.15)}</svg>`;
    zoneBtns.forEach((x) => x.classList.toggle('active', state.tool === x.dataset.tool));
    markerBtns.forEach((x) => x.classList.toggle('active', state.tool === 'marker' && state.markerSymbol === x.dataset.symbol));
    netBtns.forEach((x) => x.classList.toggle('active', state.tool === 'marker' && state.markerSymbol === x.dataset.symbol));
  };
  on(['ui', 'board', 'page'], update);
}

/** Kader-Spieler antippen oder aufs Feld ziehen → Platzierung auf seiner Position */
function bindKaderItem(el, pid) {
  let start = null, ghost = null;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch {}
    start = { x: e.clientX, y: e.clientY };
  });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (!ghost && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) {
      ghost = el.querySelector('.ros-badge').cloneNode(true);
      ghost.classList.add('kader-ghost');
      document.body.append(ghost);
    }
    if (ghost) {
      ghost.style.left = e.clientX + 'px';
      ghost.style.top = e.clientY + 'px';
    }
  });
  const end = (e, ok) => {
    if (!start) return;
    start = null;
    if (ghost) {
      ghost.remove();
      ghost = null;
      if (ok && isOverStage(e.clientX, e.clientY)) placeRosterPlayer(pid);
    } else if (ok) placeRosterPlayer(pid);
  };
  el.addEventListener('pointerup', (e) => end(e, true));
  el.addEventListener('pointercancel', (e) => end(e, false));
}

/** Token aus der Palette ziehen (oder antippen = Grundposition) */
function bindTokenDrag(tokenEl, team) {
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
      if (ok) dropPlayer(team, null, e.clientX, e.clientY);
    } else if (ok) addPlayerDefault(team);
    start = null;
  };
  tokenEl.addEventListener('pointerup', (e) => end(e, true));
  tokenEl.addEventListener('pointercancel', (e) => end(e, false));
}
