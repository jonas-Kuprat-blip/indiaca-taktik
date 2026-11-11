import { state } from './store.js';
import { lib, actionById, squadById } from './library.js';
import { game, gs, countsOf, participation, result, countsAllTime, opponentName, gradeOf } from './gamestats.js';

/*
 * All-Time-Auswertung über alle Boards, die als „Spiel“ markiert sind und eine Board-Mannschaft haben.
 * Filter: { season: 'alle' | Startjahr, squad: 'alle' | squadId, comp: 'alle' | liga|pokal|turnier|training }
 */

export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Startjahr der Saison zu einem Datum ('YYYY-MM-DD') */
export function seasonOf(date) {
  const [y, m] = String(date).split('-').map(Number);
  if (!y) return null;
  return m >= lib.seasonStart ? y : y - 1;
}
export const seasonLabel = (y) => (lib.seasonStart === 1 ? String(y) : `${y}/${String((y + 1) % 100).padStart(2, '0')}`);
export const currentSeason = () => {
  const d = new Date();
  return d.getMonth() + 1 >= lib.seasonStart ? d.getFullYear() : d.getFullYear() - 1;
};
/** Alle Saisons, in denen es Spiele gibt (neueste zuerst), plus die aktuelle */
export function seasons() {
  const set = new Set([currentSeason()]);
  for (const b of state.boards) if (countsAllTime(b)) set.add(seasonOf(game(b).date));
  return [...set].filter((x) => x != null).sort((a, b) => b - a);
}

export const DEFAULT_FILTER = { season: 'alle', squad: 'alle', comp: 'alle' };

/** Spiel-Boards nach Filter, chronologisch */
export function gameBoards(f = DEFAULT_FILTER) {
  return state.boards
    .filter((b) => countsAllTime(b))
    .filter((b) => f.season === 'alle' || seasonOf(game(b).date) === +f.season)
    .filter((b) => f.squad === 'alle' || b.squadId === f.squad)
    .filter((b) => f.comp === 'alle' || game(b).comp === f.comp)
    .sort((a, b) => game(a).date.localeCompare(game(b).date) || a.createdAt - b.createdAt);
}

/** Alle Spiele eines Spielers: [{ b, date, opp, comp, res, sets, won, lost, pos, team, counts, grade }] */
export function playerGames(pid, f = DEFAULT_FILTER, boards = gameBoards(f)) {
  const out = [];
  for (const b of boards) {
    const c = participation(b).find((x) => x.pid === pid);
    if (!c) continue;
    const r = result(b);
    let res = r.res, won = r.won, lost = r.lost;
    if (c.team === 'opp') { // Spieler stand beim Gegner (z. B. vereinsinternes Spiel)
      res = res === 'win' ? 'loss' : res === 'loss' ? 'win' : res;
      [won, lost] = [lost, won];
    }
    const counts = countsOf(b).get(pid) || {};
    const g = game(b);
    out.push({
      b, date: g.date, opp: c.team === 'opp' ? squadById(b.squadId)?.name || '' : opponentName(b), comp: g.comp,
      res, sets: r.sets, won, lost, pos: c.pos, team: c.team, counts, grade: gradeOf(counts, c.role),
    });
  }
  return out;
}

/** Quoten aus Summen: Versuche = alle Aktionen der Kategorie */
export function quotes(totals) {
  const cat = (c) => {
    let att = 0, pos = 0, neg = 0;
    for (const a of lib.actions) {
      if (a.cat !== c) continue;
      const n = totals[a.id] || 0;
      att += n;
      if (a.sign > 0) pos += n;
      if (a.sign < 0) neg += n;
    }
    return { att, pos, neg };
  };
  const q = [];
  const ang = cat('angabe'), att = cat('angriff'), ann = cat('annahme');
  if (ang.att) {
    q.push({ id: 'angabe', label: 'Angabequote', sub: 'Asse / Angaben', value: (totals.ass || 0) / ang.att, att: ang.att, fmt: 'pct' });
    q.push({ id: 'angabefehler', label: 'Angabe-Fehlerquote', sub: 'Fehler / Angaben', value: ang.neg / ang.att, att: ang.att, fmt: 'pct', bad: true });
  }
  if (att.att) q.push({ id: 'angriff', label: 'Angriffseffizienz', sub: '(Punkte − Fehler) / Versuche', value: (att.pos - att.neg) / att.att, att: att.att, fmt: 'pct' });
  if (ann.att) q.push({ id: 'annahme', label: 'Annahmequote', sub: 'gute / alle Annahmen', value: ann.pos / ann.att, att: ann.att, fmt: 'pct' });
  return q;
}
export const attackStats = (totals) => {
  let att = 0, pos = 0, neg = 0;
  for (const a of lib.actions) if (a.cat === 'angriff') {
    const n = totals[a.id] || 0;
    att += n;
    if (a.sign > 0) pos += n;
    if (a.sign < 0) neg += n;
  }
  return { att, eff: att ? (pos - neg) / att : null };
};

/** Zusammenfassung für das Spielerprofil */
export function playerSummary(pid, f = DEFAULT_FILTER) {
  const sum = playerSummaryFrom(playerGames(pid, f));
  const posCount = {};
  let sets = 0;
  for (const g of sum.games) {
    sets += g.sets;
    if (g.pos) posCount[g.pos] = (posCount[g.pos] || 0) + 1;
  }
  return { ...sum, sets, posCount, quotes: quotes(sum.totals) };
}

/** Kennzahlen aller Spieler (für die Hall of Fame) */
export function allPlayers(f = DEFAULT_FILTER) {
  const boards = gameBoards(f);
  const pids = new Set();
  for (const b of boards) for (const c of participation(b)) if (!c.pid.startsWith('n:')) pids.add(c.pid);
  for (const b of boards) for (const e of gs(b).ev) if (e.p && !e.p.startsWith('n:')) pids.add(e.p);
  return [...pids].map((pid) => ({ pid, ...playerSummaryFrom(playerGames(pid, f, boards)) })).filter((p) => p.n > 0);
}
function playerSummaryFrom(games) {
  const totals = {}, records = {};
  let wins = 0, losses = 0;
  for (const g of games) {
    if (g.res === 'win') wins++;
    if (g.res === 'loss') losses++;
    for (const [aid, n] of Object.entries(g.counts)) {
      totals[aid] = (totals[aid] || 0) + n;
      if (!records[aid] || n > records[aid].n) records[aid] = { n, g };
    }
  }
  return { games, n: games.length, wins, losses, winRate: wins + losses ? wins / (wins + losses) : null, totals, records };
}

export const pct = (v) => (v == null ? '–' : `${Math.round(v * 100)} %`);
export const num1 = (v) => (v == null ? '–' : (Math.round(v * 10) / 10).toString().replace('.', ','));
export const fmtDate = (d) => {
  const [y, m, dd] = String(d).split('-');
  return y ? `${dd}.${m}.${y.slice(2)}` : '';
};
export const actionLabel = (id) => actionById(id)?.label || id;
