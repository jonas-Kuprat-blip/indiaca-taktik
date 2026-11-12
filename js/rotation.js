import { state, board, page, commit } from './store.js';
import { clampPlayer } from './model.js';
import { mod5, posOfRole, laeuferOf, rotOfLaeufer, posToModel, sideOf } from './library.js';
import { setFrameOverride } from './stage.js';

/*
 * Rotation und Läufer pro Team auf der aktuellen Seite.
 * Gedreht werden nur Figuren mit Rolle (rolle 1–5); frei gesetzte Figuren ohne Rolle bleiben stehen.
 * Die aktuelle Rotation wird immer aus den Figuren abgeleitet (Position − Rolle), bevorzugt aus dem 1. Zuspieler.
 */

export const roleFigures = (team, pg = page()) =>
  pg.elements.filter((e) => e.type === 'player' && e.team === team && e.rolle >= 1 && e.rolle <= 5);

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
  const r = teamRot(team);
  if (r == null || !mod5(delta)) return r == null ? null : laeuferOf(r);
  const nr = mod5(r + delta);
  const from = new Map(roleFigures(team).map((e) => [e.id, { x: e.x, y: e.y }]));
  commit((p) => {
    for (const e of roleFigures(team, p)) placeAtRot(e, nr);
  });
  if (state.animRotation !== false) animateMove(from);
  return laeuferOf(nr);
}
/** Läufer direkt wählen (dreht entsprechend) */
export function setLaeufer(team, L) {
  const r = teamRot(team);
  if (r == null) return null;
  return rotateTeam(team, mod5(rotOfLaeufer(L) - r));
}
