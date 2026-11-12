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
  // Rolle (R1–R5) getrennt von der Position: bisher galt Grundaufstellung Läufer 2 → Rolle = Position
  if (e.type === 'player' && e.pos && !e.rolle) e.rolle = e.pos;
  if (e.type === 'zone' && e.shape === 'rect' && 'w' in e) {
    const { x, y, w, h } = e;
    e.shape = 'poly';
    e.points = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    delete e.x; delete e.y; delete e.w; delete e.h;
  }
  return e;
}

/**
 * Spieler nur auf der Feldseite seines Teams. ownSide = Seite des eigenen Teams ('left' = x < 0),
 * der Gegner steht auf der anderen Seite.
 */
export function clampPlayer(el, fieldType, ownSide = 'left') {
  const F = FIELDS[fieldType];
  const gap = 0.3 * F.s; // Abstand zum Netz
  const maxX = F.length / 2 + F.margin - 0.35 * F.s;
  const maxY = F.width / 2 + F.margin - 0.35 * F.s;
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));
  const right = (el.team === 'opp') === (ownSide !== 'right');
  el.x = Math.round((right ? cl(el.x, gap, maxX) : cl(el.x, -maxX, -gap)) * 1000) / 1000;
  el.y = Math.round(cl(el.y, -maxY, maxY) * 1000) / 1000;
  return el;
}

/**
 * Animationsseite: Jeder Schritt speichert eine vollständige Kopie aller animierbaren Elemente
 * (Spieler, Marker/Indiaca, Zonen/Formen, Pfeile) – Position, Größe, Form, Farbe, Deckkraft.
 * Elemente behalten über alle Schritte dieselbe ID; fehlt eine ID in einem Schritt, ist das Element dort ausgeblendet.
 * Freihand-Striche sind nicht animiert und bleiben über alle Schritte stehen.
 * page.anim = { steps: [{ id, note, dur, els: { [id]: element } }], cur }
 */
export const ANIM_TYPES = ['player', 'marker', 'zone', 'arrow'];
export function ensureAnim(p) {
  const a = (p.anim ||= {});
  if (!Array.isArray(a.steps) || !a.steps.length) a.steps = [{ id: uid(), note: '', dur: 1, els: {} }];
  const actors = a.actors && typeof a.actors === 'object' ? a.actors : {};
  a.steps.forEach((s) => {
    s.id ||= uid();
    s.note ||= '';
    s.dur = +s.dur > 0 ? +s.dur : 1;
    if (s.els && typeof s.els === 'object') Object.values(s.els).forEach(migrateElement);
    if (!s.els || typeof s.els !== 'object') {
      // Migration aus dem alten Format (nur Spieler-Positionen)
      s.els = {};
      if (s.pos) for (const [id, xy] of Object.entries(s.pos)) if (actors[id]) s.els[id] = { id, type: 'player', ...actors[id], x: xy[0], y: xy[1] };
    }
    delete s.pos;
  });
  delete a.actors;
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
    ownSide: 'left',
    pages: [newPage('taktik', 'Seite 1')],
    createdAt: now,
    updatedAt: now,
  };
}
