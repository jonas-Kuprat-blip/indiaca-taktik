import { uid } from './util.js';
import { state, board, touch, emit } from './store.js';
import { lib, actionById, anyPlayer, playerById, roleOfPos, squadById } from './library.js';

/*
 * Spiel-Infos und Spielstatistik pro Board.
 *  board.game = { isGame, date: 'YYYY-MM-DD', opponent, comp: liga|pokal|turnier|training,
 *                 sets: [{ w, g }], result: null (automatisch) | 'win' | 'loss' }
 *  board.gs   = { ev: [{ id, p, a, s, t, d }], part: { [pid]: { played?, pos?, role?, team?, name? } }, set }
 *     ev.p  Spieler-ID (Kartei-ID, oder 'n:<team>:<name>' für Figuren ohne Kartei; null = Team-Ereignis)
 *     ev.a  Aktions-ID (oder '_wir' / '_geg' = Punkt ohne Spieler)
 *     ev.s  Satz (0-basiert) · ev.t Zeit · ev.d Wirkung auf den Satzspielstand (+1 wir, −1 Gegner, 0)
 * Ein Protokoll statt Zählern: so gibt es Undo, Verlauf und Rekorde ohne Zusatzdaten.
 * In die All-Time-Statistik zählen nur Boards mit Board-Mannschaft und Haken „Spiel“.
 */

export const COMPS = [['liga', 'Liga'], ['pokal', 'Pokal'], ['turnier', 'Turnier'], ['training', 'Training']];
export const compLabel = (c) => (COMPS.find(([k]) => k === c) || COMPS[0])[1];
export const TEAM_ACTIONS = {
  _wir: { id: '_wir', label: 'Punkt für uns (Gegnerfehler)', short: 'Punkt Wir', sign: 0, pt: 1 },
  _geg: { id: '_geg', label: 'Punkt für Gegner', short: 'Punkt Gegner', sign: 0, pt: -1 },
};
export const actionInfo = (id) => TEAM_ACTIONS[id] || actionById(id) || { id, label: 'Gelöschte Aktion', sign: 0, pt: 0, cat: 'fehler' };

const isoDay = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function game(b = board()) {
  const g = (b.game ||= {});
  g.isGame = !!g.isGame;
  g.date ||= isoDay(b.createdAt || Date.now());
  if (typeof g.opponent !== 'string') g.opponent = '';
  if (!COMPS.some(([k]) => k === g.comp)) g.comp = 'liga';
  if (!Array.isArray(g.sets) || !g.sets.length) g.sets = [{ w: 0, g: 0 }];
  for (let i = 0; i < g.sets.length; i++) {
    const s = g.sets[i];
    if (!s || typeof s !== 'object') g.sets[i] = { w: 0, g: 0 };
    else {
      s.w = Math.max(0, +s.w || 0);
      s.g = Math.max(0, +s.g || 0);
    }
  }
  if (g.result !== 'win' && g.result !== 'loss') g.result = null;
  return g;
}

export function gs(b = board()) {
  if (!b.gs || typeof b.gs !== 'object') {
    b.gs = { ev: [], part: {}, set: 0 };
    migrateOld(b);
  }
  const s = b.gs;
  if (!Array.isArray(s.ev)) s.ev = [];
  if (!s.part || typeof s.part !== 'object') s.part = {};
  const g = game(b);
  s.set = Math.min(Math.max(0, s.set | 0), g.sets.length - 1);
  return s;
}

/** Gegner automatisch aus dem Spiel-Setup: die Gegner-/Liga-Mannschaft, sonst die andere Seite */
export function autoOpponent(b) {
  const own = squadById(b.squadId), opp = squadById(b.oppSquadId);
  if (own?.typ === 'gegner' && opp?.typ !== 'gegner') return own.name;
  return opp?.name || '';
}
/** Gegnername: eingetragen, sonst aus dem Spiel-Setup */
export const opponentName = (b) => game(b).opponent.trim() || autoOpponent(b);
/** Mannschaft eines Teams auf dem Board */
export const squadOfTeam = (b, team) => squadById(team === 'opp' ? b.oppSquadId : b.squadId);
/** Zählt dieses Board in die All-Time-Statistik? (Spiel + mindestens eine eigene Mannschaft) */
export const countsAllTime = (b) => !!(b.game?.isGame && [b.squadId, b.oppSquadId].some((id) => { const s = squadById(id); return s && s.typ !== 'gegner'; }));
/** Zählen Einträge dieses Teams für Hall of Fame / Profile? (nicht für Gegner-/Liga-Mannschaften) */
export const teamCounts = (b, team) => squadOfTeam(b, team)?.typ !== 'gegner';

/** Sätze und Ergebnis aus Sicht der Board-Mannschaft */
export function result(b) {
  const g = game(b);
  let won = 0, lost = 0;
  for (const s of g.sets) {
    if (s.w === s.g) continue;
    s.w > s.g ? won++ : lost++;
  }
  const auto = won > lost ? 'win' : lost > won ? 'loss' : null;
  const sets = g.sets.filter((s) => s.w + s.g > 0).length;
  return { won, lost, sets, res: g.result || auto, auto };
}

// ---------- Teilnehmer ----------
const nameKey = (team, name) => `n:${team}:${String(name).trim().toLowerCase()}`;
export const isRosterPid = (pid) => !!pid && !pid.startsWith('n:');

/** Alle in Frage kommenden Spieler dieses Boards (Kader, Figuren, schon erfasste) */
export function candidates(b = board()) {
  const s = gs(b);
  const map = new Map();
  const add = (pid, team, info = {}) => {
    if (!pid) return;
    const c = map.get(pid);
    if (c) {
      if (c.pos == null && info.pos != null) c.pos = info.pos;
      if (!c.role && info.role) c.role = info.role;
      if (info.onField) c.onField = true;
      return;
    }
    map.set(pid, { pid, team, ...info });
  };
  for (const p of b.pages) for (const e of p.elements) {
    if (e.type !== 'player') continue;
    if (e.rosterId) add(e.rosterId, e.team, { pos: e.rolle || e.pos || null, role: e.role, onField: true });
    else if (e.label?.trim()) add(nameKey(e.team, e.label), e.team, { name: e.label.trim(), pos: e.rolle || e.pos || null, role: e.role, onField: true });
  }
  // Kader beider Mannschaften (z. B. Herren 1 gegen Herren 2)
  for (const id of squadById(b.squadId)?.spielerIds || []) add(id, 'own');
  for (const id of squadById(b.oppSquadId)?.spielerIds || []) add(id, 'opp');
  for (const [pid, v] of Object.entries(s.part)) add(pid, v.team || 'own', { name: v.name });
  for (const e of s.ev) if (e.p && !map.has(e.p)) add(e.p, s.part[e.p]?.team || 'own', { name: s.part[e.p]?.name });
  const cnt = countsOf(b);
  const list = [...map.values()].map((c) => {
    const pl = isRosterPid(c.pid) ? anyPlayer(c.pid) : null;
    if (isRosterPid(c.pid) && !pl) return null; // Spieler gelöscht (ohne Archiv)
    const part = s.part[c.pid] || {};
    const n = Object.values(cnt.get(c.pid) || {}).reduce((a, x) => a + x, 0);
    // „pos“ ist hier die Rolle R1–R5 (früher als Position gespeichert; in Läufer 2 identisch)
    const pos = part.rolle ?? part.pos ?? c.pos ?? pl?.stdPos ?? null;
    return {
      pid: c.pid, team: part.team || c.team || 'own',
      name: pl?.name || c.name || part.name || '?', short: pl?.kuerzel || (c.name || part.name || '?').slice(0, 2).toUpperCase(),
      nummer: pl?.nummer ?? '', roster: !!pl, archived: !!pl && !playerById(c.pid),
      pos, rolle: pos, extern: !!pl?.extern, role: part.role || c.role || (pos ? roleOfPos(pos) : 'angriff'),
      played: part.played ?? (n > 0 || !!c.onField), n,
    };
  }).filter(Boolean);
  return list.sort((a, b2) =>
    a.team !== b2.team ? (a.team === 'own' ? -1 : 1)
      : a.played !== b2.played ? (a.played ? -1 : 1)
      : (a.pos || 9) - (b2.pos || 9) || a.name.localeCompare(b2.name, 'de'));
}

/** Map pid → { aktionId: Anzahl } */
export function countsOf(b) {
  const m = new Map();
  for (const e of gs(b).ev) {
    if (!e.p) continue;
    const o = m.get(e.p) || {};
    o[e.a] = (o[e.a] || 0) + 1;
    m.set(e.p, o);
  }
  return m;
}

/** Wer hat gespielt, auf welcher Position (für All-Time) */
export function participation(b) {
  return candidates(b).filter((c) => c.played);
}

// ---------- Noten (wie bisher, jetzt aus den Aktionen) ----------
const PRIOR = 2;
export function actionWeight(a, role) {
  if (a.id === 'zuspiel_perf') return role === 'zuspiel' ? 1 : 0.5;
  if (a.id === 'abwehr_gut') return role === 'zuspiel' ? 0.75 : 0.5;
  if (a.id === 'annahme_gut') return 0.5;
  return a.sign;
}
export function gradeOf(counts, role = 'angriff') {
  let n = 0, val = 0;
  for (const [id, c] of Object.entries(counts || {})) {
    const a = actionById(id);
    if (!a || !c) continue;
    n += c;
    val += actionWeight(a, role) * c;
  }
  if (!n) return null;
  return Math.min(6, Math.max(1, 3.5 - 2.5 * (val / (n + PRIOR))));
}

// ---------- Ändern (mit Undo-Stapel pro Board, im Speicher) ----------
const UNDO = new Map();
const stack = (b) => (UNDO.has(b.id) ? UNDO.get(b.id) : (UNDO.set(b.id, []), UNDO.get(b.id)));
export const canUndo = (b = board()) => stack(b).length > 0;

function changed(b) {
  touch(b);
  emit('stats');
}
function applyD(b, s, d, sign = 1) {
  const set = game(b).sets[s];
  if (!set || !d) return;
  if (d > 0) set.w = Math.max(0, set.w + sign);
  else set.g = Math.max(0, set.g + sign);
}
function ensurePart(b, pid, team, name) {
  if (!pid) return;
  const s = gs(b);
  const p = (s.part[pid] ||= {});
  if (team && !p.team) p.team = team;
  if (!isRosterPid(pid) && name) p.name = name;
  if (p.played === false) p.played = true;
}

/** Eine Aktion zählen. live = Spielstand automatisch mitzählen */
export function addEvent(b, pid, aid, { live = false, team = 'own', name } = {}) {
  const s = gs(b);
  const a = actionInfo(aid);
  let d = live ? a.pt || 0 : 0;
  if (team === 'opp') d = -d;
  const ev = { id: uid(), p: pid || null, a: aid, s: s.set, t: Date.now(), d };
  s.ev.push(ev);
  applyD(b, ev.s, d, 1);
  ensurePart(b, pid, team, name);
  stack(b).push([{ k: 'add', id: ev.id }]);
  changed(b);
  return ev;
}
function removeEv(b, id) {
  const s = gs(b);
  const i = s.ev.findIndex((e) => e.id === id);
  if (i < 0) return null;
  const [ev] = s.ev.splice(i, 1);
  applyD(b, ev.s, ev.d, -1);
  return { k: 'del', ev, i };
}
export function deleteEvent(b, id) {
  const op = removeEv(b, id);
  if (!op) return;
  stack(b).push([op]);
  changed(b);
}
/** Anzahl direkt setzen (Nachtrag): fügt Ereignisse hinzu oder entfernt die letzten */
export function setCount(b, pid, aid, n, { team = 'own', name } = {}) {
  const s = gs(b);
  n = Math.max(0, Math.min(999, n | 0));
  const mine = s.ev.filter((e) => e.p === pid && e.a === aid);
  const ops = [];
  if (n > mine.length) {
    for (let k = mine.length; k < n; k++) {
      const ev = { id: uid(), p: pid, a: aid, s: s.set, t: Date.now(), d: 0, m: 1 };
      s.ev.push(ev);
      ops.push({ k: 'add', id: ev.id });
    }
    ensurePart(b, pid, team, name);
  } else {
    for (const ev of mine.slice(n).reverse()) ops.push(removeEv(b, ev.id));
  }
  if (!ops.length) return;
  stack(b).push(ops);
  changed(b);
}
export function setPart(b, pid, patch, { team = 'own', name } = {}) {
  const s = gs(b);
  const p = (s.part[pid] ||= {});
  const prev = { ...p };
  Object.assign(p, patch);
  if (!p.team) p.team = team;
  if (!isRosterPid(pid) && name) p.name = name;
  stack(b).push([{ k: 'part', pid, prev }]);
  changed(b);
}
/** Satzwechsel: nächster Satz (neu anlegen, falls es der letzte war) */
export function nextSet(b) {
  const s = gs(b), g = game(b);
  const prev = s.set;
  let added = false;
  if (s.set >= g.sets.length - 1) {
    g.sets.push({ w: 0, g: 0 });
    added = true;
  }
  s.set++;
  stack(b).push([{ k: 'set', prev, added }]);
  changed(b);
}
export function gotoSet(b, i) {
  const s = gs(b);
  if (i === s.set) return;
  stack(b).push([{ k: 'set', prev: s.set, added: false }]);
  s.set = Math.max(0, Math.min(game(b).sets.length - 1, i));
  changed(b);
}
export function undo(b = board()) {
  const ops = stack(b).pop();
  if (!ops) return null;
  const s = gs(b), g = game(b);
  let label = '';
  for (const op of [...ops].reverse()) {
    if (op.k === 'add') {
      const ev = s.ev.find((e) => e.id === op.id);
      removeEv(b, op.id);
      if (ev) label = actionInfo(ev.a).label;
    } else if (op.k === 'del') {
      s.ev.splice(Math.min(op.i, s.ev.length), 0, op.ev);
      applyD(b, op.ev.s, op.ev.d, 1);
      label = actionInfo(op.ev.a).label + ' wiederhergestellt';
    } else if (op.k === 'set') {
      if (op.added && g.sets.length > 1) g.sets.pop();
      s.set = op.prev;
      label = 'Satzwechsel';
    } else if (op.k === 'part') {
      s.part[op.pid] = op.prev;
      label = 'Einsatz';
    }
  }
  changed(b);
  return label;
}
export function resetStats(b) {
  b.gs = { ev: [], part: {}, set: 0, migrated: true };
  game(b).sets = [{ w: 0, g: 0 }];
  UNDO.delete(b.id);
  changed(b);
}

// ---------- Spieler in allen Boards ----------
export function playerHasStats(pid) {
  return state.boards.some((b) => b.gs && (b.gs.ev?.some((e) => e.p === pid) || b.gs.part?.[pid]));
}
export function purgePlayerStats(pid) {
  for (const b of state.boards) {
    if (!b.gs) continue;
    const n = b.gs.ev.length;
    b.gs.ev = b.gs.ev.filter((e) => e.p !== pid);
    const had = b.gs.part?.[pid];
    if (had) delete b.gs.part[pid];
    if (had || n !== b.gs.ev.length) touch(b);
  }
  UNDO.clear();
  emit('stats');
}

// ---------- Übernahme der alten Zähler-Statistik ----------
const OLD_MAP = { fehl: 'angabefehler', block: 'blockpunkt', abwehr: 'abwehr_gut', angriff: 'angriffspunkt', zuspiel: 'zuspiel_perf', blockout: 'blockout' };
function migrateOld(b) {
  const s = b.gs;
  s.migrated = true;
  const old = b.stats && typeof b.stats === 'object' ? b.stats : {};
  const t = b.updatedAt || Date.now();
  let own = 0, fehl = 0;
  for (const [k, v] of Object.entries(old)) {
    if (!v || typeof v !== 'object') continue;
    const any = Object.keys(OLD_MAP).some((c) => v[c] > 0);
    if (!any) continue;
    const team = v.team === 'opp' ? 'opp' : 'own';
    const name = String(v.name || k.split(':').slice(1).join(':') || '?').trim();
    const pl = lib.roster.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
    const pid = pl ? pl.id : nameKey(team, name);
    s.part[pid] = { team, ...(pl ? {} : { name }), ...(v.role ? { role: v.role } : {}) };
    for (const [c, aid] of Object.entries(OLD_MAP)) {
      const n = Math.max(0, v[c] | 0);
      for (let i = 0; i < n; i++) s.ev.push({ id: uid(), p: pid, a: aid, s: 0, t, d: 0, m: 1 });
      if (team === 'own') {
        if (['angriff', 'block', 'blockout'].includes(c)) own += n;
        if (c === 'fehl') fehl += n;
      }
    }
  }
  const st = b.statsTeam || {};
  const gesch = Math.max(0, st.geschenke | 0), verl = Math.max(0, st.verloren | 0);
  for (let i = 0; i < gesch; i++) s.ev.push({ id: uid(), p: null, a: '_wir', s: 0, t, d: 0, m: 1 });
  for (let i = 0; i < verl; i++) s.ev.push({ id: uid(), p: null, a: '_geg', s: 0, t, d: 0, m: 1 });
  if (s.ev.length) {
    const g = game(b);
    if (g.sets.length === 1 && !g.sets[0].w && !g.sets[0].g) g.sets[0] = { w: own + gesch, g: verl + fehl };
  }
}
