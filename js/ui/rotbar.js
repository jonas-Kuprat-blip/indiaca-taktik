import { h } from '../util.js';
import { on, board, page } from '../store.js';
import { FIELDS } from '../model.js';
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
  for (const team of ['own', 'opp']) {
    const back = h('button', { class: 'btn rb-btn', html: ARROW_BACK, 'aria-label': `${teamName(team)} zurück drehen`, title: 'Zurück drehen (Pos. 1 → 2 → 3 …)', onclick: () => turn(team, 1) });
    const lbtn = h('button', { class: 'btn rb-l', 'aria-label': `${teamName(team)} Läufer und Rotation`, title: 'Läufer / um mehrere Positionen drehen', onclick: () => openPop(team, lbtn) });
    const fwd = h('button', { class: 'btn rb-btn', html: ARROW_FWD, 'aria-label': `${teamName(team)} vor drehen`, title: 'Vor drehen (Pos. 2 → 1 …)', onclick: () => turn(team, -1) });
    const el = h('div', { class: 'rotbar', 'data-team': team }, back, lbtn, fwd);
    wrap.append(el);
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

  // Bildschirmposition: Mitte der Feldhälfte des Teams (ohne Kamera-Zoom), Leiste an der nächsten Kante
  const layout = () => {
    const b = board(), pg = page();
    if (!b || !pg) return;
    const svg = wrap.querySelector('#stage');
    const world = wrap.querySelector('#g-world');
    const wr = wrap.getBoundingClientRect();
    let any = false;
    for (const team of ['own', 'opp']) {
      const bar = bars[team];
      const has = teamPlayers(team, pg).length > 0;
      const L = has ? teamLaeufer(team) : null;
      const F = FIELDS[b.fieldType];
      const left = (b.ownSide === 'right') === (team === 'opp');
      const mx = (left ? -1 : 1) * F.length / 4;
      let vis = has && !!svg && !!world;
      if (vis) {
        // Modell → Ansicht über Basis-Ansicht (svg) und Welt-Drehung, ohne Kamera
        const wm = world.transform.baseVal.consolidate()?.matrix;
        const m = DOMMatrix.fromMatrix(svg.getScreenCTM()).multiply(wm ? DOMMatrix.fromMatrix(wm) : new DOMMatrix());
        const p = new DOMPoint(mx, 0).matrixTransform(m);
        const x = p.x - wr.left, y = p.y - wr.top;
        if (x < 0 || x > wr.width || y < 0 || y > wr.height) vis = false; // z. B. Halbfeld-Ansicht
        else {
          const bottom = y >= wr.height / 2 - 4;
          bar.el.classList.toggle('top', !bottom);
          bar.el.style.left = Math.max(70, Math.min(wr.width - 70, x)) + 'px';
        }
      }
      bar.el.classList.toggle('show', vis);
      any ||= vis;
      if (vis) bar.lbtn.replaceChildren(h('b', {}, L ? 'L' + L : 'L?'), h('span', {}, 'Läufer'));
      const nm = teamName(team);
      bar.back.setAttribute('aria-label', `${nm} zurück drehen`);
      bar.fwd.setAttribute('aria-label', `${nm} vor drehen`);
      bar.lbtn.setAttribute('aria-label', `${nm} Läufer ${L ?? ''}`.trim());
      const sq = boardSquads()[team];
      bar.el.style.setProperty('--team', sq?.farbe || b.teams[team].color);
    }
    wrap.classList.toggle('has-rot', any);
  };
  on(['elements', 'page', 'board', 'ui', 'boardSquad', 'library'], () => requestAnimationFrame(layout));
  addEventListener('resize', () => requestAnimationFrame(layout));
  requestAnimationFrame(layout);
  return layout;
}
