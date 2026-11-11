import * as db from './db.js';
import { newBoard, newPage, FIELDS, TEAM_DEFAULT, migrateElement, ensureAnim } from './model.js';
import { uid, clone, debounce } from './util.js';

export const state = {
  boards: [],
  templates: [],
  boardId: null,
  pageId: null,
  // Werkzeuge
  tool: 'select', // select | pen | arrow | eraser | rect | circle | free | marker
  color: 'ink',
  width: 0.1,
  arrowDashed: false,
  markerSymbol: 'x',
  serveTypeId: 'lang',
  selectionId: null,
  // Eingabe
  penSeen: false,
  palmRejection: true,
  // Ansicht
  notesOpen: false,
  theme: 'auto',
  viewLocked: false, // Ansicht eingefroren (kein Zoom/Verschieben/Drehen)
  showPosNumbers: false, // Positionsnummern 1–5 auf den Figuren
  orientation: 'hoch', // hoch = Netz waagerecht, eigene Hälfte unten | quer
};

// ---------- Events ----------
const L = {};
export function on(evts, fn) {
  for (const e of [].concat(evts)) (L[e] ||= []).push(fn);
}
export function emit(e, d) {
  (L[e] || []).forEach((f) => f(d));
}
function emitBoard() {
  emit('board');
  emitPage();
}
function emitPage() {
  emit('page');
  emit('elements');
  emit('ui');
}

// ---------- Zugriff ----------
export const board = () => state.boards.find((b) => b.id === state.boardId);
export const page = () => {
  const b = board();
  return b && (b.pages.find((p) => p.id === state.pageId) || b.pages[0]);
};
export const pageIndex = () => board().pages.findIndex((p) => p.id === page().id);
export const findEl = (id) => page()?.elements.find((e) => e.id === id);
export const scale = () => FIELDS[board().fieldType].s;

// ---------- Undo / Redo (pro Seite, im Speicher) ----------
const hist = new Map();
const H = (id) => {
  if (!hist.has(id)) hist.set(id, { u: [], r: [] });
  return hist.get(id);
};
export function snapshot() {
  const p = page();
  const h = H(p.id);
  h.u.push(snap(p));
  if (h.u.length > 150) h.u.shift();
  h.r.length = 0;
}
export const canUndo = () => H(page().id).u.length > 0;
export const canRedo = () => H(page().id).r.length > 0;
// Undo-Stand: Elemente + (bei Animationen) die Schritte
const snap = (p) => JSON.stringify({ e: p.elements, a: p.anim });
function restore(from, to) {
  const p = page();
  const h = H(p.id);
  if (!h[from].length) return;
  h[to].push(snap(p));
  const d = JSON.parse(h[from].pop());
  if (Array.isArray(d)) p.elements = d;
  else {
    p.elements = d.e;
    if (d.a) p.anim = d.a;
  }
  emit('anim');
  if (state.selectionId && !findEl(state.selectionId)) state.selectionId = null;
  touch();
  emit('elements');
  emit('ui');
}
export const undo = () => restore('u', 'r');
export const redo = () => restore('r', 'u');

/** Änderung mit Undo-Eintrag */
export function commit(fn) {
  snapshot();
  fn(page());
  touch();
  emit('elements');
}
/** Änderung ohne neuen Undo-Eintrag (z. B. während eines Drags nach snapshot()) */
export function changed() {
  touch();
  emit('elements');
}

// ---------- Speichern ----------
const dirty = new Set();
async function flush() {
  const ids = [...dirty];
  dirty.clear();
  for (const id of ids) {
    const b = state.boards.find((x) => x.id === id);
    if (b) await db.put('boards', b);
  }
}
const saveSoon = debounce(flush, 400);
export function touch(b = board()) {
  if (!b) return;
  b.updatedAt = Date.now();
  dirty.add(b.id);
  saveSoon();
}
export const flushNow = () => flush();

const PREF_KEYS = ['color', 'width', 'arrowDashed', 'markerSymbol', 'notesOpen', 'palmRejection', 'theme', 'orientation', 'viewLocked', 'showPosNumbers'];
const savePrefs = debounce(() => {
  const p = {};
  PREF_KEYS.forEach((k) => (p[k] = state[k]));
  db.setMeta('prefs', p);
}, 500);
on('ui', savePrefs);

function rememberLast() {
  db.setMeta('last', { boardId: state.boardId, pageId: state.pageId });
}

// ---------- UI-State ----------
export function set(patch) {
  Object.assign(state, patch);
  emit('ui');
}
export function setTool(tool) {
  state.tool = tool;
  if (tool !== 'select') state.selectionId = null;
  emit('ui');
}
export function select(id) {
  state.selectionId = id;
  emit('ui');
}

// ---------- Init ----------
export async function init() {
  const [boards, templates, last, prefs] = await Promise.all([
    db.getAll('boards'),
    db.getAll('templates'),
    db.getMeta('last'),
    db.getMeta('prefs'),
  ]);
  state.boards = boards.map(normalizeBoard);
  state.templates = templates.filter((t) => t?.page);
  state.templates.forEach((t) => normalizePage(t.page));
  if (prefs) PREF_KEYS.forEach((k) => k in prefs && (state[k] = prefs[k]));
  if (!state.boards.length) {
    const b = newBoard('Mein Board');
    state.boards.push(b);
    await db.put('boards', b);
  }
  const b =
    state.boards.find((x) => x.id === last?.boardId) ||
    [...state.boards].sort((a, c) => c.updatedAt - a.updatedAt)[0];
  state.boardId = b.id;
  state.pageId = (b.pages.find((p) => p.id === last?.pageId) || b.pages[0]).id;
}

function normalizeBoard(b) {
  b.fieldType = FIELDS[b.fieldType] ? b.fieldType : 'indiaca';
  b.teams ||= clone(TEAM_DEFAULT);
  b.ownSide = b.ownSide === 'right' ? 'right' : 'left';
  if (!b.stats || typeof b.stats !== 'object') b.stats = {};
  if (!b.statsTeam || typeof b.statsTeam !== 'object') b.statsTeam = { geschenke: 0 };
  b.name ||= 'Board';
  b.createdAt ||= Date.now();
  b.updatedAt ||= Date.now();
  if (!Array.isArray(b.pages) || !b.pages.length) b.pages = [newPage('taktik', 'Seite 1')];
  b.pages.forEach(normalizePage);
  return b;
}
function normalizePage(p) {
  p.id ||= uid();
  p.kind = ['angabe', 'anim'].includes(p.kind) ? p.kind : 'taktik';
  p.name ||= 'Seite';
  p.notes ||= '';
  if (!Array.isArray(p.elements)) p.elements = [];
  p.elements.forEach((e) => {
    e.id ||= uid();
    migrateElement(e);
  });
  if (p.kind === 'anim') ensureAnim(p);
  return p;
}

// ---------- Boards ----------
export function openBoard(id) {
  state.boardId = id;
  state.pageId = board().pages[0].id;
  state.selectionId = null;
  rememberLast();
  emitBoard();
  emit('boards');
}
export function createBoard(name, fieldType) {
  const b = newBoard(name, fieldType);
  state.boards.push(b);
  touch(b);
  openBoard(b.id);
}
export function renameBoard(id, name) {
  const b = state.boards.find((x) => x.id === id);
  b.name = name;
  touch(b);
  emit('board');
  emit('boards');
}
export function duplicateBoard(id) {
  const b = state.boards.find((x) => x.id === id);
  const c = clone(b);
  c.id = uid();
  c.name = b.name + ' (Kopie)';
  c.pages.forEach((p) => (p.id = uid()));
  c.createdAt = Date.now();
  state.boards.push(c);
  touch(c);
  emit('boards');
}
export async function deleteBoard(id) {
  state.boards = state.boards.filter((b) => b.id !== id);
  dirty.delete(id);
  await db.del('boards', id);
  if (!state.boards.length) createBoard('Mein Board', 'indiaca');
  else if (state.boardId === id) openBoard(state.boards[0].id);
  emit('boards');
}
export function setFieldType(id, ft) {
  const b = state.boards.find((x) => x.id === id);
  b.fieldType = ft;
  touch(b);
  if (id === state.boardId) emitBoard();
  emit('boards');
}
export function setTeam(team, patch) {
  const b = board();
  const old = b.teams[team].color;
  Object.assign(b.teams[team], patch);
  if (patch.color)
    for (const p of b.pages)
      for (const e of p.elements) if (e.type === 'player' && e.team === team && e.color === old) e.color = patch.color;
  touch();
  emit('board');
  emit('elements');
  emit('page');
}

// ---------- Seiten ----------
export function switchPage(id) {
  if (id === state.pageId) return;
  state.pageId = id;
  state.selectionId = null;
  rememberLast();
  emitPage();
}
export function makePage(kind, half = false, orientation = null) {
  const b = board();
  const n = b.pages.filter((p) => p.kind === kind).length + 1;
  const base = kind === 'angabe' ? `Angabe ${n}` : half ? 'Hälfte' : orientation === 'quer' ? 'Querfeld' : 'Seite';
  const p = newPage(kind, kind === 'angabe' ? base : `${base} ${b.pages.length + 1}`);
  if (half) p.half = true;
  p.orientation = orientation || state.orientation;
  return p;
}
export function addPage(p) {
  normalizePage(p);
  const b = board();
  b.pages.splice(pageIndex() + 1, 0, p);
  touch();
  state.pageId = null; // erzwingt Wechsel
  switchPage(p.id);
}
export function copyCurrentPage() {
  const c = clone(page());
  c.id = uid();
  c.name = page().name + ' (Kopie)';
  addPage(c);
}
export function renamePage(id, name) {
  board().pages.find((p) => p.id === id).name = name;
  touch();
  emit('page');
}
export function deletePage(id) {
  const b = board();
  if (b.pages.length === 1) return false;
  const i = b.pages.findIndex((p) => p.id === id);
  b.pages.splice(i, 1);
  hist.delete(id);
  touch();
  if (state.pageId === id) {
    state.pageId = null;
    switchPage(b.pages[Math.min(i, b.pages.length - 1)].id);
  } else emit('page');
  return true;
}
export function movePage(from, to) {
  const b = board();
  if (from === to || to < 0 || to >= b.pages.length) return;
  const [p] = b.pages.splice(from, 1);
  b.pages.splice(to, 0, p);
  touch();
  emit('page');
}
export function setNotes(text) {
  page().notes = text;
  touch();
  emit('notes');
}
export function setServeTypes(types) {
  page().serveTypes = types;
  if (!types.some((t) => t.id === state.serveTypeId)) state.serveTypeId = types[0]?.id ?? null;
  touch();
  emit('elements');
  emit('ui');
}
// Angabearten/Legende wurden entfernt – Ziele nutzen die normale Farbe.
export function activeServeType() {
  return null;
}
/** Ausrichtung der aktuellen Seite: 'hoch' oder 'quer' (ohne Angabe gilt der Standard) */
export const pageOrientation = (p = page()) => p?.orientation || state.orientation;
export function setOrientation(o) {
  page().orientation = o;
  touch();
  emit('page');
  emit('elements');
  emit('ui');
}
export function setHalf(half) {
  const p = page();
  if (half) p.half = true;
  else delete p.half;
  touch();
  emit('page');
  emit('elements');
  emit('ui');
}

// ---------- Vorlagen ----------
export async function saveTemplate(name) {
  const t = { id: uid(), name, fieldType: board().fieldType, createdAt: Date.now(), page: clone(page()) };
  state.templates.push(t);
  await db.put('templates', t);
  emit('templates');
}
export function pageFromTemplate(t) {
  const c = clone(t.page);
  c.id = uid();
  c.name = t.name;
  return c;
}
export async function renameTemplate(id, name) {
  const t = state.templates.find((x) => x.id === id);
  t.name = name;
  await db.put('templates', t);
  emit('templates');
}
export async function deleteTemplate(id) {
  state.templates = state.templates.filter((t) => t.id !== id);
  await db.del('templates', id);
  emit('templates');
}

// ---------- Export / Import ----------
export function exportData(boardIds) {
  return {
    app: 'indiaca-taktik',
    version: 1,
    exportedAt: new Date().toISOString(),
    boards: boardIds ? state.boards.filter((b) => boardIds.includes(b.id)) : state.boards,
    templates: boardIds ? [] : state.templates,
  };
}
export async function importData(data) {
  if (!data || !Array.isArray(data.boards)) throw new Error('Keine gültige Taktikboard-Datei.');
  let nb = 0, nt = 0;
  for (const raw of data.boards) {
    if (!raw || typeof raw !== 'object') continue;
    const b = normalizeBoard(clone(raw));
    if (!b.id || state.boards.some((x) => x.id === b.id)) {
      b.id = uid();
      b.name += ' (Import)';
    }
    state.boards.push(b);
    await db.put('boards', b);
    nb++;
  }
  for (const raw of data.templates || []) {
    if (!raw?.page || state.templates.some((x) => x.id === raw.id)) continue;
    const t = clone(raw);
    t.id ||= uid();
    normalizePage(t.page);
    state.templates.push(t);
    await db.put('templates', t);
    nt++;
  }
  emit('boards');
  emit('templates');
  return { nb, nt };
}
