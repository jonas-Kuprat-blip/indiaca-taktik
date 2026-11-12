import { h } from '../util.js';
import { on, board, page } from '../store.js';
import { roleName, POS_NUMS, posOfRole } from '../library.js';
import { teamRot, teamLaeufer, rotateTeam, setLaeufer, teamPlayers } from '../rotation.js';
import { boardSquads } from '../kader.js';
import { place, toast } from './dialogs.js';

/*
 * Kompakte Rotations-Steuerung je Team direkt am Feld: ↺ (zurück drehen) · Läufer · ↻ (vor drehen).
 * Die Leiste sitzt an der Feldseite des Teams (unten/oben bzw. links/rechts unten) und erscheint nur,
 * wenn das Team Figuren mit Rolle auf der Seite hat.
 */
const ARROW_BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M4 4v4.5h4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARROW_FWD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M20 4v4.5h-4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const teamName = (team) => {
  const sq = boardSquads()[team];
  return sq?.name || (team === 'own' ? 'Eigenes Team' : 'Gegner');
};

export function initRotBar(wrap) {
  const bars = {};
  // Direkt über dem Schloss, hochkant wie die Feld-Leiste: je Team eine Spalte (links eigenes Team, rechts Gegner)
  const dock = h('div', { id: 'rotdock' });
  wrap.append(dock);
  for (const team of ['own', 'opp']) {
    const back = h('button', { class: 'btn rb-btn', html: ARROW_BACK, 'aria-label': `${teamName(team)} zurück drehen`, title: 'Zurück drehen (Pos. 1 → 2 → 3 …)', onclick: () => turn(team, 1) });
    const lbtn = h('button', { class: 'btn rb-l', 'aria-label': `${teamName(team)} Läufer und Rotation`, title: 'Läufer / um mehrere Positionen drehen', onclick: () => openPop(team, lbtn) });
    const fwd = h('button', { class: 'btn rb-btn', html: ARROW_FWD, 'aria-label': `${teamName(team)} vor drehen`, title: 'Vor drehen (Pos. 2 → 1 …)', onclick: () => turn(team, -1) });
    const el = h('div', { class: 'rotbar', 'data-team': team }, back, lbtn, fwd);
    dock.append(el);
    bars[team] = { el, back, lbtn, fwd };
  }

  const turn = (team, d) => {
    if (document.querySelector('#animbar.playing')) return toast('Erst die Wiedergabe stoppen');
    rotateTeam(team, d); // die Leiste zeigt den neuen Läufer an
  };

  const openPop = (team, anchor) => {
    const back = h('div', { class: 'pop-back' });
    const close = () => back.remove();
    const cur = teamLaeufer(team);
    const r0 = teamRot(team) ?? 0;
    const pop = h('div', { class: 'pop rb-pop' },
      h('div', { class: 'rb-ph' }, h('b', {}, teamName(team)), h('span', { class: 'muted small' }, cur ? `aktuell Läufer ${cur}` : 'noch ohne Rollen')),
      h('div', { class: 'rb-sec' }, 'Läufer (1. Zuspieler auf Position …)'),
      h('div', { class: 'rb-grid' }, POS_NUMS.map((L) =>
        h('button', { class: 'rb-opt' + (L === cur ? ' active' : ''), onclick: () => { close(); if (L !== cur) setLaeufer(team, L); } }, 'L' + L))),
      h('div', { class: 'rb-sec' }, 'Zurück drehen um'),
      h('div', { class: 'rb-grid' }, [1, 2, 3, 4].map((n) => h('button', { class: 'rb-opt', onclick: () => { close(); turn(team, n); } }, `↺ ${n}`))),
      h('div', { class: 'rb-sec' }, 'Vor drehen um'),
      h('div', { class: 'rb-grid' }, [1, 2, 3, 4].map((n) => h('button', { class: 'rb-opt', onclick: () => { close(); turn(team, -n); } }, `↻ ${n}`))),
      h('div', { class: 'rb-roles muted small' }, (cur ? POS_NUMS.map((rl) => h('div', {}, `${roleName(rl)} → Pos. ${posOfRole(rl, r0)}`)) : [h('div', {}, 'Die Figuren bekommen beim ersten Drehen die Rolle ihrer nächstgelegenen Position (wie Läufer 2).')])));
    back.addEventListener('pointerdown', (e) => e.target === back && close());
    back.append(pop);
    document.body.append(back);
    place(pop, anchor);
  };

  const layout = () => {
    const b = board(), pg = page();
    if (!b || !pg) return;
    const net = pg.kind === 'netz' || (pg.kind === 'anim' && pg.net);
    let any = false;
    for (const team of ['own', 'opp']) {
      const bar = bars[team];
      const vis = !net && teamPlayers(team, pg).length > 0;
      const L = vis ? teamLaeufer(team) : null;
      bar.el.classList.toggle('show', vis);
      any ||= vis;
      const nm = teamName(team);
      const short = boardSquads()[team]?.name || (team === 'own' ? 'Wir' : 'Gegner');
      if (vis) bar.lbtn.replaceChildren(h('b', {}, L ? 'L' + L : 'L?'), h('span', {}, short.length > 7 ? short.slice(0, 6) + '…' : short));
      bar.lbtn.title = `${nm}: Läufer / um mehrere Positionen drehen`;
      bar.back.setAttribute('aria-label', `${nm} zurück drehen`);
      bar.fwd.setAttribute('aria-label', `${nm} vor drehen`);
      bar.lbtn.setAttribute('aria-label', `${nm} Läufer ${L ?? ''}`.trim());
      const sq = boardSquads()[team];
      bar.el.style.setProperty('--team', sq?.farbe || b.teams[team].color);
    }
    dock.classList.toggle('show', any);
    // direkt über der Zoom-/Schloss-Leiste platzieren (auch wenn diese sich verschiebt, z. B. im Animationsmodus)
    const zb = wrap.querySelector('#zoombar');
    if (any && zb) {
      const wr = wrap.getBoundingClientRect(), zr = zb.getBoundingClientRect();
      dock.style.left = zr.left - wr.left + 'px';
      dock.style.bottom = wr.bottom - zr.top + 8 + 'px';
    }
  };
  on(['elements', 'page', 'board', 'ui', 'boardSquad', 'library'], () => requestAnimationFrame(layout));
  addEventListener('resize', () => requestAnimationFrame(layout));
  requestAnimationFrame(layout);
  return layout;
}
