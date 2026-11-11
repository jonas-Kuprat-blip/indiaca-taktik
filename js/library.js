import * as db from './db.js';
import { uid, clone, debounce } from './util.js';
import { FIELDS } from './model.js';
import { state, emit, touch } from './store.js';

/*
 * App-weite Bibliothek (gilt für alle Boards): Spielerkartei, Mannschaften, Positionen.
 *
 *  lib.roster    = [{ id, name, kuerzel, nummer, stdPos }]                     stdPos: 1–5 oder null
 *  lib.squads    = [{ id, name, farbe, spielerIds, aufstellungen: [{ id, name, standard, slots: {1..5: spielerId|null} }] }]
 *  lib.positions = { 1..5: { rolle, d, l } }
 *
 * Positionen sind relativ zur eigenen Feldhälfte gespeichert (gedacht im Hochformat, Netz oben):
 *   d = Abstand zum Netz als Anteil der halben Feldlänge (0 = Netz, 1 = Grundlinie)
 *   l = seitlich als Anteil der halben Feldbreite, aus Sicht des Teams Richtung Netz (−1 = links, +1 = rechts)
 * Gezählt wird gegen den Uhrzeigersinn, beginnend hinten rechts (Aufschlagposition).
 */
export const DEFAULT_POSITIONS = {
  1: { rolle: 'Außenangreifer', d: 0.75, l: 0.55 },
  2: { rolle: '1. Zuspieler', d: 0.12, l: 0.7 },
  3: { rolle: 'Hauptangreifer', d: 0.375, l: 0 },
  4: { rolle: '2. Zuspieler', d: 0.375, l: -0.65 },
  5: { rolle: '2. Mitte', d: 0.75, l: -0.55 },
};
export const POS_NUMS = [1, 2, 3, 4, 5];

export const lib = { roster: [], squads: [], positions: clone(DEFAULT_POSITIONS) };

export async function loadLibrary() {
  const d = await db.getMeta('library');
  if (d && typeof d === 'object') applyLibrary(d);
}
function applyLibrary(d) {
  lib.roster = Array.isArray(d.roster) ? d.roster.filter((p) => p?.id && p.name).map(normPlayer) : [];
  lib.squads = Array.isArray(d.squads) ? d.squads.filter((s) => s?.id).map(normSquad) : [];
  lib.positions = clone(DEFAULT_POSITIONS);
  for (const n of POS_NUMS) {
    const p = d.positions?.[n];
    if (p && Number.isFinite(p.d) && Number.isFinite(p.l)) lib.positions[n] = { rolle: p.rolle || DEFAULT_POSITIONS[n].rolle, d: p.d, l: p.l };
  }
}
const normPlayer = (p) => ({ id: p.id, name: String(p.name).trim(), kuerzel: (p.kuerzel || initials(p.name)).slice(0, 4), nummer: p.nummer ?? '', stdPos: POS_NUMS.includes(+p.stdPos) ? +p.stdPos : null });
function normSquad(s) {
  return {
    id: s.id, name: s.name || 'Mannschaft', farbe: s.farbe || '#2563eb',
    spielerIds: Array.isArray(s.spielerIds) ? [...new Set(s.spielerIds)] : [],
    aufstellungen: (Array.isArray(s.aufstellungen) ? s.aufstellungen : []).map((a) => ({
      id: a.id || uid(), name: a.name || 'Aufstellung', standard: !!a.standard,
      slots: Object.fromEntries(POS_NUMS.map((n) => [n, a.slots?.[n] || null])),
    })),
  };
}

const save = debounce(() => db.setMeta('library', clone(lib)), 300);
export function libChanged() {
  save();
  emit('library');
}

// ---------- Positionen ----------
export const roleName = (n) => lib.positions[n]?.rolle || `Position ${n}`;
/** Für die Noten-Statistik: 1. und 2. Zuspieler werden als Zuspieler bewertet */
export const roleOfPos = (n) => (n === 2 || n === 4 ? 'zuspiel' : 'angriff');
/** Feldseite eines Teams auf dem Board ('left' = Modell x < 0) */
export const sideOf = (b, team) => {
  const own = b?.ownSide === 'right' ? 'right' : 'left';
  return team === 'opp' ? (own === 'left' ? 'right' : 'left') : own;
};
/** Position (1–5) → Modellkoordinaten in Metern, immer zum Netz hin ausgerichtet */
export function posToModel(n, side, fieldType, positions = lib.positions) {
  const F = FIELDS[fieldType] || FIELDS.indiaca;
  const p = positions[n] || DEFAULT_POSITIONS[n];
  const depth = p.d * (F.length / 2), lat = p.l * (F.width / 2);
  // Team links schaut nach +x (seine rechte Seite = +y), Team rechts schaut nach −x (rechte Seite = −y)
  return side === 'right' ? { x: depth, y: -lat } : { x: -depth, y: lat };
}
export function setPosition(n, patch) {
  Object.assign(lib.positions[n], patch);
  libChanged();
}
export function resetPositions() {
  lib.positions = clone(DEFAULT_POSITIONS);
  libChanged();
}

// ---------- Spielerkartei ----------
export function initials(name = '') {
  const w = String(name).trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}
export const playerById = (id) => lib.roster.find((p) => p.id === id);
export const sortedRoster = (list = lib.roster) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'de'));

export function addPlayer(data) {
  const p = normPlayer({ ...data, id: uid() });
  lib.roster.push(p);
  libChanged();
  return p;
}
export function updatePlayer(id, patch) {
  const p = playerById(id);
  if (!p) return;
  Object.assign(p, normPlayer({ ...p, ...patch, id }));
  // Figuren dieses Spielers auf allen Boards/Seiten (inkl. Animationsschritte) aktualisieren
  forEachFigure((e) => e.rosterId === id, (e) => {
    e.label = p.name;
    e.short = p.kuerzel;
  });
  libChanged();
}
export function deletePlayer(id) {
  lib.roster = lib.roster.filter((p) => p.id !== id);
  for (const s of lib.squads) {
    s.spielerIds = s.spielerIds.filter((x) => x !== id);
    for (const a of s.aufstellungen) for (const n of POS_NUMS) if (a.slots[n] === id) a.slots[n] = null;
  }
  // Bestehende Figuren bleiben als normale Figur erhalten (Name bleibt stehen)
  forEachFigure((e) => e.rosterId === id, (e) => {
    delete e.rosterId;
    delete e.short;
  });
  libChanged();
}

/** Alle Spielerfiguren aller Boards durchlaufen (Seiten + Animationsschritte) */
export function forEachFigure(match, fn) {
  for (const b of state.boards) {
    let hit = false;
    for (const p of b.pages) {
      const lists = [p.elements, ...(p.anim?.steps || []).map((s) => Object.values(s.els || {}))];
      for (const list of lists) for (const e of list) if (e.type === 'player' && match(e)) { fn(e, b, p); hit = true; }
    }
    if (hit) touch(b);
  }
  emit('elements');
  emit('page');
}

// ---------- Export / Import ----------
export const exportLibrary = () => clone(lib);
export function importLibrary(d) {
  if (!d || typeof d !== 'object') return { np: 0, ns: 0 };
  const cur = clone(lib);
  applyLibrary(d);
  const incoming = { roster: lib.roster, squads: lib.squads, positions: lib.positions };
  // zusammenführen: vorhandene IDs behalten, neue ergänzen
  const roster = [...cur.roster];
  let np = 0, ns = 0;
  for (const p of incoming.roster) if (!roster.some((x) => x.id === p.id)) { roster.push(p); np++; }
  const squads = [...cur.squads];
  for (const s of incoming.squads) if (!squads.some((x) => x.id === s.id)) { squads.push(s); ns++; }
  lib.roster = roster;
  lib.squads = squads;
  lib.positions = cur.positions; // eigene Positionen nicht überschreiben
  libChanged();
  return { np, ns };
}
