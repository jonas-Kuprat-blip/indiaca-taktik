import * as db from './db.js';
import { uid, clone, debounce } from './util.js';
import { FIELDS } from './model.js';
import { state, emit, touch } from './store.js';

/*
 * App-weite Bibliothek (gilt für alle Boards): Spielerkartei, Mannschaften, Positionen.
 *
 *  lib.roster    = [{ id, name, kuerzel, nummer, stdPos, extern? }]            stdPos = Standardrolle 1–5 oder null; extern = Gegner-Spieler
 *  lib.squads    = [{ id, name, farbe, typ: eigen|gegner, spielerIds, aufstellungen: [{ id, name, standard, slots: {1..5: spielerId|null} }] }]
 *  lib.positions = { 1..5: { d, l } }        Feldpunkte der Positionen
 *  lib.roles     = { 1..5: Name }           Rollen R1–R5 (Grundaufstellung Läufer 2)
 *  Aufstellung: slots nach Rolle, laeufer = Standard-Läufer
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

/*
 * Rolle ≠ Position: Die Rolle (R1–R5) gehört zum Spieler, die Position (1–5) ist der Platz auf dem Feld.
 * Rollen sind nach ihrer Position in der Grundaufstellung „Läufer 2“ nummeriert (R2 = 1. Zuspieler auf Pos. 2).
 * Rotation r (0–4): Position = Rolle + r (zyklisch). Läufer = Position des 1. Zuspielers = 2 + r.
 *   „Zurück drehen“ = r + 1 (Pos. 1 → 2 → 3 → 4 → 5 → 1) · „Vor drehen“ = r − 1
 */
export const DEFAULT_ROLES = { 1: 'Außenangreifer', 2: '1. Zuspieler', 3: 'Hauptangreifer', 4: '2. Zuspieler', 5: '2. Mitte' };
export const mod5 = (n) => ((n % 5) + 5) % 5;
export const posOfRole = (rolle, r = 0) => mod5(rolle - 1 + r) + 1;
export const roleAtPos = (pos, r = 0) => mod5(pos - 1 - r) + 1;
export const laeuferOf = (r = 0) => posOfRole(2, r);
export const rotOfLaeufer = (L) => mod5(L - 2);

/*
 * Statistik-Aktionen (app-weit). sign: +1 positiv · −1 negativ · 0 neutral (für Quoten/Hall of Fame)
 * pt: Wirkung auf den Spielstand bei Live-Erfassung (+1 Punkt für uns, −1 Punkt für den Gegner, 0 keiner)
 */
export const ACTION_CATS = [
  ['angabe', 'Angabe'], ['angriff', 'Angriff'], ['block', 'Block'], ['annahme', 'Annahme'],
  ['abwehr', 'Abwehr'], ['zuspiel', 'Zuspiel'], ['fehler', 'Fehler'],
];
export const DEFAULT_ACTIONS = [
  { id: 'ass', cat: 'angabe', label: 'Ass', sign: 1, pt: 1 },
  { id: 'angabe', cat: 'angabe', label: 'Angabe ins Feld', sign: 0, pt: 0 },
  { id: 'angabefehler', cat: 'angabe', label: 'Angabefehler', sign: -1, pt: -1 },
  { id: 'angriffspunkt', cat: 'angriff', label: 'Angriffspunkt', sign: 1, pt: 1 },
  { id: 'angriff', cat: 'angriff', label: 'Angriff im Spiel', sign: 0, pt: 0 },
  { id: 'angriffsfehler', cat: 'angriff', label: 'Angriffsfehler', sign: -1, pt: -1 },
  { id: 'blockout', cat: 'angriff', label: 'Blockout', sign: 1, pt: 1 },
  { id: 'blockpunkt', cat: 'block', label: 'Blockpunkt', sign: 1, pt: 1 },
  { id: 'annahme_gut', cat: 'annahme', label: 'Gute Annahme', sign: 1, pt: 0 },
  { id: 'annahmefehler', cat: 'annahme', label: 'Annahmefehler', sign: -1, pt: -1 },
  { id: 'abwehr_gut', cat: 'abwehr', label: 'Gute Abwehr', sign: 1, pt: 0 },
  { id: 'zuspiel_perf', cat: 'zuspiel', label: 'Perfektes Zuspiel', sign: 1, pt: 0 },
  { id: 'netzfehler', cat: 'fehler', label: 'Netzfehler', sign: -1, pt: -1 },
  { id: 'uebertreten', cat: 'fehler', label: 'Übertreten', sign: -1, pt: -1 },
  { id: 'fehler_sonst', cat: 'fehler', label: 'Sonstiger Fehler', sign: -1, pt: -1 },
];
const CAT_IDS = ACTION_CATS.map(([c]) => c);
const normAction = (a, builtin) => ({
  id: a.id, cat: CAT_IDS.includes(a.cat) ? a.cat : 'fehler', label: String(a.label || 'Aktion').trim() || 'Aktion',
  sign: [1, 0, -1].includes(+a.sign) ? +a.sign : 0, pt: [1, 0, -1].includes(+a.pt) ? +a.pt : 0,
  active: a.active !== false, builtin: !!builtin,
});
function normActions(list) {
  const src = Array.isArray(list) ? list.filter((a) => a?.id) : [];
  const out = DEFAULT_ACTIONS.map((d) => normAction({ ...d, ...(src.find((a) => a.id === d.id) || {}), id: d.id }, true));
  for (const a of src) if (!DEFAULT_ACTIONS.some((d) => d.id === a.id)) out.push(normAction(a, false));
  return out;
}

export const lib = { roster: [], squads: [], positions: clone(DEFAULT_POSITIONS), roles: { ...DEFAULT_ROLES }, archived: [], actions: normActions(), seasonStart: 8, hof: null };

export async function loadLibrary() {
  const d = await db.getMeta('library');
  if (d && typeof d === 'object') applyLibrary(d);
}
function applyLibrary(d) {
  lib.roster = Array.isArray(d.roster) ? d.roster.filter((p) => p?.id && p.name).map(normPlayer) : [];
  lib.squads = Array.isArray(d.squads) ? d.squads.filter((s) => s?.id).map(normSquad) : [];
  lib.archived = Array.isArray(d.archived) ? d.archived.filter((p) => p?.id && p.name).map(normPlayer) : [];
  lib.actions = normActions(d.actions);
  lib.seasonStart = d.seasonStart >= 1 && d.seasonStart <= 12 ? +d.seasonStart : 8;
  lib.hof = d.hof && typeof d.hof === 'object' ? d.hof : null;
  lib.netHeights = d.netHeights && typeof d.netHeights === 'object' ? d.netHeights : null;
  lib.positions = clone(DEFAULT_POSITIONS);
  lib.roles = { ...DEFAULT_ROLES };
  for (const n of POS_NUMS) {
    const p = d.positions?.[n];
    if (p && Number.isFinite(p.d) && Number.isFinite(p.l)) lib.positions[n] = { rolle: DEFAULT_POSITIONS[n].rolle, d: p.d, l: p.l };
    // Rollennamen: früher an der Position gespeichert (Grundaufstellung = Läufer 2 → gleiche Nummer)
    const rn = d.roles?.[n] ?? p?.rolle;
    if (typeof rn === 'string' && rn.trim()) lib.roles[n] = rn.trim();
  }
}
const normPlayer = (p) => ({ id: p.id, name: String(p.name).trim(), kuerzel: (p.kuerzel || initials(p.name)).slice(0, 4), nummer: p.nummer ?? '', stdPos: POS_NUMS.includes(+p.stdPos) ? +p.stdPos : null, ...(p.extern ? { extern: true } : {}), ...(+p.groesse >= 100 && +p.groesse <= 250 ? { groesse: Math.round(+p.groesse) } : {}) });
function normSquad(s) {
  return {
    id: s.id, name: s.name || 'Mannschaft', farbe: s.farbe || '#2563eb', typ: s.typ === 'gegner' ? 'gegner' : 'eigen',
    spielerIds: Array.isArray(s.spielerIds) ? [...new Set(s.spielerIds)] : [],
    aufstellungen: (Array.isArray(s.aufstellungen) ? s.aufstellungen : []).map((a) => ({
      id: a.id || uid(), name: a.name || 'Aufstellung', standard: !!a.standard, laeufer: POS_NUMS.includes(+a.laeufer) ? +a.laeufer : 2,
      slots: Object.fromEntries(POS_NUMS.map((n) => [n, a.slots?.[n] || null])),
    })),
  };
}

const save = debounce(() => db.setMeta('library', clone(lib)), 300);
export function libChanged() {
  save();
  emit('library');
}

// ---------- Aktionen ----------
export const actionById = (id) => lib.actions.find((a) => a.id === id);
export const activeActions = () => lib.actions.filter((a) => a.active);
export function updateAction(id, patch) {
  const a = actionById(id);
  if (!a) return;
  Object.assign(a, normAction({ ...a, ...patch, id }, a.builtin));
  libChanged();
}
export function addAction(data) {
  const a = normAction({ ...data, id: 'x_' + uid() }, false);
  lib.actions.push(a);
  libChanged();
  return a;
}
export function deleteAction(id) {
  lib.actions = lib.actions.filter((a) => a.id !== id || a.builtin);
  libChanged();
}
export function resetActions() {
  lib.actions = normActions(lib.actions.filter((a) => !a.builtin));
  libChanged();
}

// ---------- Positionen ----------
/** Name der Rolle R1–R5 (z. B. „1. Zuspieler“) */
export const roleName = (n) => lib.roles[n] || DEFAULT_ROLES[n] || `Rolle ${n}`;
export function setRoleName(n, name) {
  lib.roles[n] = String(name || '').trim() || DEFAULT_ROLES[n];
  libChanged();
}
/** Für die Noten-Statistik: Rollen 1. und 2. Zuspieler werden als Zuspieler bewertet */
export const roleOfPos = (rolle) => (rolle === 2 || rolle === 4 ? 'zuspiel' : 'angriff');
export const gradeRole = roleOfPos;
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
  lib.roles = { ...DEFAULT_ROLES };
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
/** Auch archivierte (gelöschte, Stats behalten) Spieler */
export const anyPlayer = (id) => playerById(id) || lib.archived.find((p) => p.id === id);
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
  // Silhouetten in Netzansichten (inkl. Animationsschritte)
  for (const b of state.boards) for (const pg of b.pages) {
    const lists = [pg.elements, ...(pg.anim?.steps || []).map((s) => Object.values(s.els || {}))];
    for (const list of lists) for (const e of list) if (e.type === 'sil' && e.rosterId === id) {
      e.label = p.name;
      e.short = p.kuerzel;
      if (p.groesse) e.groesse = p.groesse / 100;
      touch(b);
    }
  }
  libChanged();
}
export function deletePlayer(id, { archive = false } = {}) {
  const pl = playerById(id);
  if (archive && pl && !lib.archived.some((x) => x.id === id)) lib.archived.push({ ...clone(pl), archivedAt: Date.now() });
  lib.roster = lib.roster.filter((p) => p.id !== id);
  for (const s of lib.squads) {
    s.spielerIds = s.spielerIds.filter((x) => x !== id);
    for (const a of s.aufstellungen) for (const n of POS_NUMS) if (a.slots[n] === id) a.slots[n] = null;
  }
  // Bestehende Figuren bleiben als normale Figur erhalten (Name bleibt stehen).
  // Beim Archivieren bleibt die Verknüpfung, damit die Statistik dem Spieler zugeordnet bleibt.
  if (!archive) forEachFigure((e) => e.rosterId === id, (e) => {
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

// ---------- Mannschaften & Aufstellungen ----------
export const squadById = (id) => lib.squads.find((s) => s.id === id);
export const sortedSquads = () => [...lib.squads].sort((a, b) => a.name.localeCompare(b.name, 'de'));
export const squadPlayers = (sq) => sortedRoster(lib.roster.filter((p) => sq?.spielerIds.includes(p.id)));
export const defaultLineup = (sq) => sq?.aufstellungen.find((a) => a.standard) || sq?.aufstellungen[0] || null;
const emptySlots = () => Object.fromEntries(POS_NUMS.map((n) => [n, null]));

export function addSquad(data = {}) {
  const sq = normSquad({ id: uid(), name: data.name || 'Neue Mannschaft', farbe: data.farbe || '#2563eb', spielerIds: [], aufstellungen: [] });
  lib.squads.push(sq);
  libChanged();
  return sq;
}
export function updateSquad(id, patch) {
  const sq = squadById(id);
  if (!sq) return;
  Object.assign(sq, patch);
  libChanged();
}
export function deleteSquad(id) {
  lib.squads = lib.squads.filter((s) => s.id !== id);
  // Boards, die diese Mannschaft nutzen, behalten ihre Figuren; nur die Zuordnung fällt weg
  for (const b of state.boards) {
    let hit = false;
    if (b.squadId === id) { delete b.squadId; hit = true; }
    if (b.oppSquadId === id) { delete b.oppSquadId; hit = true; }
    if (hit) touch(b);
  }
  libChanged();
  emit('board');
}
export function setSquadMember(squadId, playerId, member) {
  const sq = squadById(squadId);
  if (!sq) return;
  if (member && !sq.spielerIds.includes(playerId)) sq.spielerIds.push(playerId);
  if (!member) {
    sq.spielerIds = sq.spielerIds.filter((x) => x !== playerId);
    for (const a of sq.aufstellungen) for (const n of POS_NUMS) if (a.slots[n] === playerId) a.slots[n] = null;
  }
  libChanged();
}
export function addLineup(squadId, name) {
  const sq = squadById(squadId);
  const a = { id: uid(), name: name || `Aufstellung ${sq.aufstellungen.length + 1}`, standard: !sq.aufstellungen.length, laeufer: 2, slots: emptySlots() };
  sq.aufstellungen.push(a);
  libChanged();
  return a;
}
export const lineupById = (sq, id) => sq?.aufstellungen.find((a) => a.id === id);
export function updateLineup(squadId, lineupId, patch) {
  const a = lineupById(squadById(squadId), lineupId);
  if (!a) return;
  Object.assign(a, patch);
  libChanged();
}
/** Spieler auf Position setzen; steht er schon woanders, wird getauscht */
export function assignSlot(squadId, lineupId, n, playerId) {
  const a = lineupById(squadById(squadId), lineupId);
  if (!a) return;
  const prev = a.slots[n];
  if (playerId) for (const m of POS_NUMS) if (m !== n && a.slots[m] === playerId) a.slots[m] = prev || null;
  a.slots[n] = playerId || null;
  libChanged();
}
export function setDefaultLineup(squadId, lineupId) {
  const sq = squadById(squadId);
  sq.aufstellungen.forEach((a) => (a.standard = a.id === lineupId));
  libChanged();
}
export function deleteLineup(squadId, lineupId) {
  const sq = squadById(squadId);
  const wasDefault = lineupById(sq, lineupId)?.standard;
  sq.aufstellungen = sq.aufstellungen.filter((a) => a.id !== lineupId);
  if (wasDefault && sq.aufstellungen[0]) sq.aufstellungen[0].standard = true;
  libChanged();
}
export function duplicateLineup(squadId, lineupId) {
  const sq = squadById(squadId);
  const src = lineupById(sq, lineupId);
  const a = { ...clone(src), id: uid(), name: src.name + ' (Kopie)', standard: false };
  sq.aufstellungen.push(a);
  libChanged();
  return a;
}

// ---------- Export / Import ----------
export const exportLibrary = () => clone(lib);
export function importLibrary(d) {
  if (!d || typeof d !== 'object') return { np: 0, ns: 0 };
  const cur = clone(lib);
  applyLibrary(d);
  const incoming = { roster: lib.roster, squads: lib.squads, positions: lib.positions, archived: lib.archived };
  // zusammenführen: vorhandene IDs behalten, neue ergänzen
  const roster = [...cur.roster];
  let np = 0, ns = 0;
  for (const p of incoming.roster) if (!roster.some((x) => x.id === p.id)) { roster.push(p); np++; }
  const squads = [...cur.squads];
  for (const s of incoming.squads) if (!squads.some((x) => x.id === s.id)) { squads.push(s); ns++; }
  const archived = [...(cur.archived || [])];
  for (const p of incoming.archived || []) if (!archived.some((x) => x.id === p.id) && !roster.some((x) => x.id === p.id)) archived.push(p);
  // eigene Aktionen ergänzen (vorhandene Namen/Einstellungen bleiben)
  const actions = [...cur.actions];
  for (const a of lib.actions) if (!actions.some((x) => x.id === a.id)) actions.push(a);
  const hof = cur.hof || lib.hof;
  if (cur.hof && lib.hof?.cats) for (const c of lib.hof.cats) if (!cur.hof.cats?.some((x) => x.id === c.id)) (cur.hof.cats ||= []).push(c);
  lib.archived = archived;
  lib.actions = actions;
  lib.hof = hof;
  lib.seasonStart = cur.seasonStart;
  lib.netHeights = cur.netHeights || lib.netHeights;
  lib.roster = roster;
  lib.squads = squads;
  lib.positions = cur.positions; // eigene Positionen und Rollennamen nicht überschreiben
  lib.roles = cur.roles;
  libChanged();
  return { np, ns };
}
