import { uid, clone } from './util.js';

/**
 * Feldmaße in Metern. Koordinatenursprung = Feldmitte (Netz), x entlang der Länge, y entlang der Breite.
 * s = Größenfaktor für Tokens/Marker, damit sie auf dem größeren Volleyballfeld gleich groß wirken.
 */
export const FIELDS = {
  indiaca: { label: 'Indiaca (16 × 6,10 m)', short: 'Indiaca', length: 16, width: 6.1, attack: 3, margin: 0.9, s: 1 },
  volleyball: { label: 'Volleyball (18 × 9 m)', short: 'Volleyball', length: 18, width: 9, attack: 3, margin: 1.1, s: 1.15 },
};

export const COLORS = ['ink', '#ffffff', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7'];
export const WIDTHS = [0.05, 0.1, 0.18];

export const SERVE_TYPES = [
  { id: 'lang', name: 'Lang', color: '#2563eb' },
  { id: 'kurz', name: 'Kurz', color: '#f59e0b' },
  { id: 'linie', name: 'Linie', color: '#16a34a' },
  { id: 'diagonal', name: 'Diagonal', color: '#db2777' },
];

export const TEAM_DEFAULT = {
  own: { name: 'Wir', color: '#2563eb' },
  opp: { name: 'Gegner', color: '#dc2626' },
};

export function newPage(kind = 'taktik', name = 'Seite') {
  const p = { id: uid(), name, kind, elements: [], notes: '' };
  return p;
}

/** Alte Datenformate auf das aktuelle bringen (z. B. Rechteck-Zonen → Polygon mit 4 Ecken) */
export function migrateElement(e) {
  if (e.type === 'zone' && e.shape === 'rect' && 'w' in e) {
    const { x, y, w, h } = e;
    e.shape = 'poly';
    e.points = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    delete e.x; delete e.y; delete e.w; delete e.h;
  }
  return e;
}

/** Spieler nur auf der eigenen Feldseite: eigenes Team x < 0, Gegner x > 0 (Modellkoordinaten) */
export function clampPlayer(el, fieldType) {
  const F = FIELDS[fieldType];
  const gap = 0.3 * F.s; // Abstand zum Netz
  const maxX = F.length / 2 + F.margin - 0.35 * F.s;
  const maxY = F.width / 2 + F.margin - 0.35 * F.s;
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  el.x = Math.round((el.team === 'opp' ? cl(el.x, gap, maxX) : cl(el.x, -maxX, -gap)) * 1000) / 1000;
  el.y = Math.round(cl(el.y, -maxY, maxY) * 1000) / 1000;
  return el;
}

/**
 * Animationsseite: Spieler sind „Actors“ mit fester ID, jeder Schritt speichert nur deren Positionen.
 * page.anim = { actors: {id: {team, color, size, label, number}}, steps: [{id, note, dur, pos: {id: [x, y]}}], cur }
 * Ein Actor ohne Position in einem Schritt ist dort ausgeblendet.
 */
export function ensureAnim(p) {
  const a = (p.anim ||= {});
  if (!a.actors || typeof a.actors !== 'object') a.actors = {};
  if (!Array.isArray(a.steps) || !a.steps.length) a.steps = [{ id: uid(), note: '', dur: 1, pos: {} }];
  a.steps.forEach((s) => {
    s.id ||= uid();
    s.note ||= '';
    s.dur = +s.dur > 0 ? +s.dur : 1;
    if (!s.pos || typeof s.pos !== 'object') s.pos = {};
  });
  a.cur = Math.min(Math.max(0, a.cur | 0), a.steps.length - 1);
  return p;
}

export function newBoard(name = 'Neues Board', fieldType = 'indiaca') {
  const now = Date.now();
  return {
    id: uid(),
    name,
    fieldType,
    teams: clone(TEAM_DEFAULT),
    pages: [newPage('taktik', 'Seite 1')],
    createdAt: now,
    updatedAt: now,
  };
}

// Grundpositionen (Anteil der Feldhälfte) für Tap-Platzierung aus der Palette
const POS = [[0.8, 0.6], [0.8, -0.6], [0.5, 0], [0.2, 0.6], [0.2, -0.6]];
export function defaultPos(fieldType, team, number) {
  const f = FIELDS[fieldType];
  const [fx, fy] = POS[(Math.max(1, number) - 1) % 5];
  const side = team === 'own' ? -1 : 1;
  return { x: side * fx * (f.length / 2), y: -side * fy * (f.width / 2) };
}
