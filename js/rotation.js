import { state, board, page, commit } from './store.js';
import { clampPlayer } from './model.js';
import { mod5, posOfRole, laeuferOf, rotOfLaeufer, posToModel, sideOf, roleAtPos, roleOfPos, POS_NUMS } from './library.js';
import { setFrameOverride } from './stage.js';

/*
 * Rotation und Läufer pro Team auf der aktuellen Seite.
 * Figuren ohne Rolle (frei gezogen) bekommen beim ersten Drehen die Rolle ihrer nächstgelegenen Position.
 * Die aktuelle Rotation wird immer aus den Figuren abgeleitet (Position − Rolle), bevorzugt aus dem 1. Zuspieler.
 */

export const roleFigures = (team, pg = page()) =>
  pg.elements.filter((e) => e.type === 'player' && e.team === team && e.rolle >= 1 && e.rolle <= 5);

export const teamPlayers = (team, pg = page()) => pg.elements.filter((e) => e.type === 'player' && e.team === team);

/**
 * Figuren ohne Rolle (z. B. frei aufs Feld gezogen) bekommen die Rolle der nächstgelegenen freien Position
 * (Annahme: Läufer 2, bzw. der aktuelle Läufer, falls schon Figuren mit Rolle da sind). Mehr als 5 Figuren: nur die nächsten.
 * Ändert die Seite direkt (innerhalb von commit aufrufen). Gibt true zurück, wenn etwas zugewiesen wurde.
 */
export function assignMissingRoles(team, pg = page(), b = board()) {
  const r = teamRot(team, pg) ?? 0;
  const used = new Set(roleFigures(team, pg).filter((e) => e.pos).map((e) => e.pos));
  const open = teamPlayers(team, pg).filter((e) => !(e.rolle && e.pos));
  if (!open.length) return false;
  const pts = POS_NUMS.filter((n) => !used.has(n)).map((n) => ({ n, ...posToModel(n, sideOf(b, team), b.fieldType) }));
  const pairs = [];
  for (const e of open) for (const p of pts) pairs.push({ e, p, d: Math.hypot(e.x - p.x, e.y - p.y) });
  pairs.sort((a, c) => a.d - c.d);
  const doneE = new Set(), doneP = new Set();
  let any = false;
  for (const { e, p } of pairs) {
    if (doneE.has(e) || doneP.has(p.n)) continue;
    doneE.add(e);
    doneP.add(p.n);
    e.pos = p.n;
    e.rolle = roleAtPos(p.n, r);
    e.role = roleOfPos(e.rolle);
    any = true;
  }
  return any;
}

/** Rotation r (0–4) eines Teams oder null, wenn keine Figur mit Rolle und Position da ist */
export function teamRot(team, pg = page()) {
  const figs = roleFigures(team, pg).filter((e) => e.pos);
  if (!figs.length) return null;
  const ref = figs.find((e) => e.rolle === 2) || figs[0];
  return mod5(ref.pos - ref.rolle);
}
export const teamLaeufer = (team, pg = page()) => {
  const r = teamRot(team, pg);
  return r == null ? null : laeuferOf(r);
};

/** Figur auf die Position ihrer Rolle bei Rotation r setzen */
export function placeAtRot(e, r, b = board()) {
  const pos = posOfRole(e.rolle, r);
  const pt = posToModel(pos, sideOf(b, e.team), b.fieldType);
  Object.assign(e, { pos, x: pt.x, y: pt.y });
  clampPlayer(e, b.fieldType, b.ownSide);
  return e;
}

let animT = null;
/** Positionen gleiten lassen (nur Anzeige, die Daten sind schon final gespeichert) */
function animateMove(from, ms = 500) {
  if (animT) cancelAnimationFrame(animT);
  const t0 = performance.now();
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  const frame = () => {
    const k = ease(Math.min(1, (performance.now() - t0) / ms));
    const pg = page();
    return {
      ...pg,
      elements: pg.elements.map((e) => {
        const a = from.get(e.id);
        return a ? { ...e, x: a.x + (e.x - a.x) * k, y: a.y + (e.y - a.y) * k } : e;
      }),
    };
  };
  const tick = () => {
    if (performance.now() - t0 >= ms) {
      animT = null;
      setFrameOverride(null);
      return;
    }
    setFrameOverride(frame);
    animT = requestAnimationFrame(tick);
  };
  tick();
}

/**
 * Team drehen. delta > 0 = „Zurück drehen“ (Pos. 1 → 2 …), delta < 0 = „Vor drehen“ (Pos. 2 → 1 …)
 * Gibt den neuen Läufer zurück (oder null, wenn nichts zu drehen war).
 */
export function rotateTeam(team, delta) {
  const needRoles = teamPlayers(team).some((e) => !(e.rolle && e.pos));
  if (!teamPlayers(team).length || (!needRoles && !mod5(delta))) return teamLaeufer(team);
  const from = new Map(teamPlayers(team).map((e) => [e.id, { x: e.x, y: e.y }]));
  let nr = 0;
  commit((p) => {
    assignMissingRoles(team, p); // frei gesetzte Figuren erst auf ihre nächste Position/Rolle
    nr = mod5((teamRot(team, p) ?? 0) + delta);
    for (const e of roleFigures(team, p)) if (e.pos) placeAtRot(e, nr);
  });
  if (state.animRotation !== false) animateMove(from);
  return laeuferOf(nr);
}
/** Läufer direkt wählen (dreht entsprechend) */
export function setLaeufer(team, L) {
  if (!teamPlayers(team).length) return null;
  const r = teamRot(team) ?? 0;
  return rotateTeam(team, mod5(rotOfLaeufer(L) - r));
}
