import { h, colorCss, uid } from '../util.js';
import { I } from '../icons.js';
import { state, on, set, setTool, board, page, setTeam, setServeTypes, activeServeType } from '../store.js';
import { dropPlayer, addPlayerDefault } from '../stage.js';
import { promptText, colorPicker, menu, modal } from './dialogs.js';

export function initPalette(root) {
  // --- Spieler ---
  const teamCols = ['own', 'opp'].map((team) => {
    const head = h('button', { class: 'team-head', title: 'Team bearbeiten' });
    head.onclick = () =>
      menu(head, [
        {
          label: 'Teamname ändern', icon: I.edit,
          onClick: async () => {
            const n = await promptText('Teamname', board().teams[team].name);
            if (n) setTeam(team, { name: n });
          },
        },
        { label: 'Teamfarbe ändern', icon: I.theme, onClick: () => colorPicker(head, board().teams[team].color, (c) => setTeam(team, { color: c }), { allowInk: false }) },
      ]);
    const tokens = [1, 2, 3, 4, 5].map((n) => {
      const t = h('div', { class: 'token', role: 'button', 'aria-label': `Spieler ${n}` }, String(n));
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
  const zoneBtns = [toolBtn('rect', I.rect, 'Rechteck'), toolBtn('circle', I.circle, 'Kreis'), toolBtn('free', I.free, 'Freiform')];
  const markerBtns = [
    toolBtn('marker', I.dot, 'Punkt', () => set({ markerSymbol: 'dot' })),
    toolBtn('marker', I.x, 'Kreuz', () => set({ markerSymbol: 'x' })),
  ];
  markerBtns[0].dataset.symbol = 'dot';
  markerBtns[1].dataset.symbol = 'x';

  // --- Angabearten (nur Angabe-Seiten) ---
  const serveList = h('div', { class: 'serve-list' });
  const serveSec = h('div', { class: 'pal-sec' },
    h('div', { class: 'pal-h' }, 'Angabeart'),
    serveList,
    h('button', { class: 'btn text small', onclick: editServeTypes }, 'Bearbeiten'));

  root.append(
    h('div', { class: 'pal-sec' }, h('div', { class: 'pal-h' }, 'Spieler'), h('div', { class: 'teams' }, teamCols.map((c) => c.col))),
    serveSec,
    h('div', { class: 'pal-sec' }, h('div', { class: 'pal-h' }, 'Ziel / Position'), h('div', { class: 'pal-grid' }, markerBtns)),
    h('div', { class: 'pal-sec' }, h('div', { class: 'pal-h' }, 'Zonen'), h('div', { class: 'pal-grid' }, zoneBtns))
  );

  const update = () => {
    const b = board();
    if (!b) return;
    for (const c of teamCols) {
      const t = b.teams[c.team];
      c.head.innerHTML = `<span class="dot" style="background:${colorCss(t.color)}"></span><span class="tn">${t.name.replace(/</g, '&lt;')}</span>`;
      c.tokens.forEach((tk) => (tk.style.background = colorCss(t.color)));
    }
    zoneBtns.forEach((x) => x.classList.toggle('active', state.tool === x.dataset.tool));
    markerBtns.forEach((x) => x.classList.toggle('active', state.tool === 'marker' && state.markerSymbol === x.dataset.symbol));
    const p = page();
    serveSec.style.display = p.kind === 'angabe' ? '' : 'none';
    if (p.kind === 'angabe') {
      const act = activeServeType();
      serveList.replaceChildren(
        ...(p.serveTypes || []).map((t) =>
          h('button', {
            class: 'chip' + (act?.id === t.id ? ' active' : ''),
            onclick: () => {
              state.serveTypeId = t.id;
              setTool('marker');
            },
          }, h('span', { class: 'dot', style: { background: t.color } }), t.name))
      );
    }
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

function editServeTypes() {
  const types = (page().serveTypes || []).map((t) => ({ ...t }));
  const list = h('div', { class: 'serve-edit' });
  const render = () =>
    list.replaceChildren(
      ...types.map((t, i) => {
        const col = h('input', { type: 'color', class: 'color-input', value: t.color });
        col.oninput = () => (t.color = col.value);
        const name = h('input', { class: 'input', value: t.name });
        name.oninput = () => (t.name = name.value);
        return h('div', { class: 'row' }, col, name,
          h('button', { class: 'btn', 'aria-label': 'Entfernen', html: I.trash, onclick: () => { types.splice(i, 1); render(); } }));
      }),
      h('button', { class: 'btn text', onclick: () => { types.push({ id: uid(), name: 'Neu', color: '#64748b' }); render(); } }, '+ Angabeart')
    );
  render();
  modal({
    title: 'Angabearten & Legende',
    body: list,
    actions: [
      { label: 'Abbrechen' },
      { label: 'Speichern', primary: true, onClick: () => setServeTypes(types.map((t) => ({ ...t, name: t.name.trim() || 'Angabe' }))) },
    ],
  });
}
