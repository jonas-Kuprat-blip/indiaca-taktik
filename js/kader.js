import { h, clone } from './util.js';
import { FIELDS, clampPlayer } from './model.js';
import { state, emit, board, page, commit, touch, select, createBoard, openBoard, renameBoard, setFieldType, pageFromTemplate } from './store.js';
import {
  lib, POS_NUMS, roleName, roleOfPos, posToModel, sideOf, posOfRole, rotOfLaeufer, playerById, sortedRoster, squadById, squadPlayers,
  sortedSquads, defaultLineup, lineupById,
} from './library.js';
import { modal, choose, toast } from './ui/dialogs.js';
import { openStats } from './ui/stats.js';
import { teamRot } from './rotation.js';
import { isNet, makeSil, playerSize } from './net.js';
import { setupEditor, writeSetup, placeSetup, boardSetupSection } from './ui/setup.js';

/*
 * Board-Mannschaft, Kader und Platzierung von Kartei-Spielern.
 *  board.squadId / board.oppSquadId – optionale Mannschaften des Boards (gelten für alle Seiten)
 *  board.ownSide                   – Feldseite der Board-Mannschaft ('left' | 'right')
 *  board.rosterTeam                – ohne Board-Mannschaft: als welches Team Kartei-Spieler gesetzt werden
 * Kartei-Figuren: { id: 'r_<rosterId>', rosterId, label, short, pos, role, team, color … }
 */

export const boardSquads = (b = board()) => ({ own: squadById(b?.squadId) || null, opp: squadById(b?.oppSquadId) || null });
export const teamColor = (b, team) => (team === 'own' ? boardSquads(b).own?.farbe : boardSquads(b).opp?.farbe) || b.teams[team].color;
export const figureId = (rosterId) => 'r_' + rosterId;

/** Für die Palette: verfügbare Spieler, gruppiert */
export function kaderGroups(b = board()) {
  const { own, opp } = boardSquads(b);
  if (!own && !opp) return [{ team: null, title: 'Kartei', color: null, players: sortedRoster().filter((p) => !p.extern) }];
  const g = [];
  if (own) g.push({ team: 'own', title: own.name, color: own.farbe, players: squadPlayers(own) });
  if (opp) g.push({ team: 'opp', title: opp.name, color: opp.farbe, players: squadPlayers(opp) });
  return g;
}

function teamForPlayer(b, pid) {
  const { own, opp } = boardSquads(b);
  if (own?.spielerIds.includes(pid)) return 'own';
  if (opp?.spielerIds.includes(pid)) return 'opp';
  if (own || opp) return own ? 'own' : 'opp';
  return b.rosterTeam || null;
}

/** Kartei-Figur mit Rolle rl; Position = Rolle bei Rotation r (r = 0 → Läufer 2) */
export function figure(p, team, rl, b = board(), r = 0) {
  const pos = posOfRole(rl, r);
  const pt = posToModel(pos, sideOf(b, team), b.fieldType);
  return clampPlayer({
    id: figureId(p.id), type: 'player', rosterId: p.id, team, label: p.name, short: p.kuerzel, number: p.nummer || '',
    color: teamColor(b, team), size: 1, rolle: rl, pos, role: roleOfPos(rl), x: pt.x, y: pt.y,
  }, b.fieldType, b.ownSide);
}

export function askPosition(p) {
  return choose(`Rolle für ${p.name}`, 'Welche Rolle übernimmt der Spieler? (Die Position ergibt sich aus dem aktuellen Läufer.)',
    POS_NUMS.map((n) => ({ id: n, big: 'R' + n, label: roleName(n) })));
}
async function askTeam() {
  const t = await choose('Welches Team?', 'Als welches Team sollen Kartei-Spieler auf diesem Board stehen? (Später in den Board-Einstellungen änderbar.)', [
    { id: 'own', label: 'Eigenes Team', sub: 'linke Seite', primary: true },
    { id: 'opp', label: 'Gegner', sub: 'rechte Seite' },
  ]);
  if (t) {
    board().rosterTeam = t;
    touch();
  }
  return t;
}

/** Kartei-Spieler aufs Feld: Standardposition oder Abfrage, bei belegter Position tauschen/dazustellen */
export async function placeRosterPlayer(pid) {
  const b = board();
  const p = playerById(pid);
  if (!p) return;
  if (isNet(page())) {
    // Netzansicht: Silhouette in Körpergröße
    if (page().elements.some((e) => e.type === 'sil' && e.rosterId === pid)) return toast(`${p.name} ist schon da`);
    const team = teamForPlayer(b, pid) || 'own';
    const W = (FIELDS[b.fieldType] || FIELDS.indiaca).width;
    const n = page().elements.filter((e) => e.type === 'sil').length;
    const sil = makeSil({ x: ((n % 5) + 1) * (W / 6), team, color: teamColor(b, team), label: p.name, short: p.kuerzel, rosterId: p.id, groesse: playerSize(p) });
    commit((pg) => pg.elements.push(sil));
    select(sil.id);
    return;
  }
  const onPage = page().elements.find((e) => e.type === 'player' && e.rosterId === pid);
  if (onPage) {
    select(onPage.id);
    toast(`${p.name} steht schon auf dieser Seite`);
    return;
  }
  const team = teamForPlayer(b, pid) || (await askTeam());
  if (!team) return;
  const n = p.stdPos || (await askPosition(p));
  if (!n) return;
  const r = teamRot(team) ?? 0; // aktueller Läufer des Teams
  const occ = page().elements.find((e) => e.type === 'player' && e.team === team && (e.rolle || e.pos) === n);
  let mode = 'add';
  if (occ) {
    mode = await choose(`${roleName(n)} ist belegt`, `${occ.label || 'Eine Figur'} spielt schon ${roleName(n)} (Pos. ${posOfRole(n, r)}).`, [
      { id: 'swap', label: 'Tauschen', sub: `${p.name} kommt rein, ${occ.label || 'Figur'} geht raus`, primary: true },
      { id: 'add', label: 'Trotzdem dazustellen' },
    ]);
    if (!mode) return;
  }
  const fig = figure(p, team, n, b, r);
  commit((pg) => {
    if (mode === 'swap') pg.elements = pg.elements.filter((e) => e.id !== occ.id);
    pg.elements.push(fig);
  });
  select(fig.id);
}

/** Aufstellung auf die aktuelle Seite setzen (replace = vorhandene Spieler dieses Teams entfernen) */
export function applyLineup(sq, lu, team, mode = 'replace', pg = page(), b = board(), laeufer = 2) {
  const r = rotOfLaeufer(laeufer || 2);
  const apply = (p) => {
    if (mode === 'replace') p.elements = p.elements.filter((e) => !(e.type === 'player' && e.team === team));
    for (const n of POS_NUMS) {
      const pl = playerById(lu.slots[n]);
      if (!pl) continue; // leere Rollen überspringen
      const fig = figure(pl, team, n, b, r);
      fig.color = sq.farbe;
      const ex = p.elements.find((e) => e.type === 'player' && e.rosterId === pl.id);
      if (ex) Object.assign(ex, { x: fig.x, y: fig.y, pos: fig.pos, rolle: n, role: fig.role, team, color: fig.color });
      else p.elements.push(fig);
    }
  };
  if (pg === page()) commit(apply);
  else {
    apply(pg);
    touch(b);
  }
}

/** „Aufstellung einsetzen“ */
/** Auswahl Läufer 1–5 (1. Zuspieler auf Position …) */
export function laeuferSeg(cur, onPick) {
  return h('div', { class: 'seg laeufer-seg', role: 'group', 'aria-label': 'Läufer' },
    POS_NUMS.map((L) => h('button', { class: 'seg-btn' + (L === cur ? ' active' : ''), 'aria-label': `Läufer ${L}`, onclick: () => onPick(L) }, 'L' + L)));
}

export function openInsertLineup() {
  if (!lib.squads.length) {
    toast('Lege zuerst unter „Mannschaften“ eine Mannschaft mit Aufstellung an');
    return;
  }
  const b = board();
  const { own, opp } = boardSquads(b);
  const squads = own || opp ? [own, opp].filter(Boolean) : sortedSquads();
  let sqId = squads[0].id;
  let team = sqId === b.oppSquadId && !own ? 'opp' : 'own';
  let luId = null, laeufer = null;
  const body = h('div', { class: 'form' });
  const render = () => {
    const sq = squadById(sqId);
    const lus = sq.aufstellungen;
    if (!lineupById(sq, luId)) { luId = defaultLineup(sq)?.id || null; laeufer = null; }
    if (laeufer == null) laeufer = lineupById(sq, luId)?.laeufer || 2;
    const sqSel = h('select', { class: 'input select' }, squads.map((s) => h('option', { value: s.id, selected: s.id === sqId }, s.name + (s.id === b.squadId ? ' (Board)' : s.id === b.oppSquadId ? ' (Gegner)' : ''))));
    sqSel.onchange = () => {
      sqId = sqSel.value;
      luId = null;
      team = sqId === b.oppSquadId ? 'opp' : sqId === b.squadId ? 'own' : team;
      render();
    };
    const luSel = h('select', { class: 'input select', disabled: !lus.length }, lus.length
      ? lus.map((a) => h('option', { value: a.id, selected: a.id === luId }, a.name + (a.standard ? ' (Standard)' : '')))
      : h('option', {}, 'Keine Aufstellung vorhanden'));
    const seg = h('div', { class: 'seg' },
      h('button', { class: 'seg-btn' + (team === 'own' ? ' active' : ''), onclick: () => { team = 'own'; render(); } }, 'Eigenes Team'),
      h('button', { class: 'seg-btn' + (team === 'opp' ? ' active' : ''), onclick: () => { team = 'opp'; render(); } }, 'Gegner'));
    body.replaceChildren(
      h('label', { class: 'form-row' }, h('span', {}, 'Mannschaft'), sqSel),
      h('label', { class: 'form-row' }, h('span', {}, 'Aufstellung'), luSel),
      h('div', { class: 'form-row' }, h('span', {}, 'Läufer (1. Zuspieler auf Position …)'), laeuferSeg(laeufer, (L) => { laeufer = L; render(); })),
      h('div', { class: 'form-row' }, h('span', {}, 'Seite'), seg));
    luSel.onchange = () => { luId = luSel.value; laeufer = null; render(); };
  };
  render();
  modal({
    title: 'Aufstellung einsetzen',
    body,
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Einsetzen', primary: true,
        onClick: async () => {
          const sq = squadById(sqId);
          const lu = lineupById(sq, luId);
          if (!lu) { toast('Diese Mannschaft hat noch keine Aufstellung'); return false; }
          const hasPlayers = page().elements.some((e) => e.type === 'player' && e.team === team);
          let mode = 'replace';
          if (hasPlayers) {
            mode = await choose('Seite ist schon belegt', `Auf dieser Seite stehen bereits Spieler (${team === 'own' ? 'eigenes Team' : 'Gegner'}).`, [
              { id: 'replace', label: 'Ersetzen', sub: 'vorhandene Spieler dieses Teams entfernen', primary: true },
              { id: 'add', label: 'Hinzufügen', sub: 'vorhandene Spieler bleiben stehen' },
            ]);
            if (!mode) return false;
          }
          applyLineup(sq, lu, team, mode, page(), board(), laeufer);
          toast(`${lu.name} eingesetzt (Läufer ${laeufer})`);
        },
      },
    ],
  });
}

/** Element um die Netzmitte spiegeln (Punktspiegelung: links ↔ rechts, Netz bleibt) */
function mirrorEl(e) {
  if ('x' in e) { e.x = -e.x; e.y = -e.y; }
  if (e.points) e.points = e.points.map((q) => [-q[0], -q[1], ...q.slice(2)]);
  if ('x1' in e) { e.x1 = -e.x1; e.y1 = -e.y1; e.x2 = -e.x2; e.y2 = -e.y2; }
  if (e.from) e.from = { x: -e.from.x, y: -e.from.y };
  if (e.type === 'player') e.rot = (((e.rot || 0) + 360) % 360) - 180;
}
export function mirrorPage(p) {
  p.elements.forEach(mirrorEl);
  for (const s of p.anim?.steps || []) Object.values(s.els || {}).forEach(mirrorEl);
  return p;
}
export function mirrorBoard(b) {
  b.pages.forEach(mirrorPage);
}

/**
 * Vorlage/Animationsvorlage füllen: Figuren mit Position (1–5) werden durch die Spieler der
 * Standard-Aufstellung der Board-Mannschaft (bzw. Gegner-Mannschaft) ersetzt – in allen Animationsschritten
 * mit derselben festen ID. Abschaltbar in den Einstellungen.
 */
export function fillPageWithLineups(p, b = board()) {
  if (state.fillTemplates === false) return p;
  const { own, opp } = boardSquads(b);
  const plans = [['own', own], ['opp', opp]].map(([t, sq]) => ({ t, sq, lu: lineupById(sq, b.setup?.[t]?.lineupId) || defaultLineup(sq) })).filter((x) => x.sq && x.lu);
  if (!plans.length) return p;
  const idMap = {}, used = new Set();
  const apply = (e) => {
    const rl = e.rolle || e.pos;
    if (e.type !== 'player' || !rl) return e;
    if (!(e.id in idMap)) {
      idMap[e.id] = null;
      const plan = plans.find((x) => x.t === e.team);
      const pl = plan && playerById(plan.lu.slots[rl]);
      if (pl && !used.has(pl.id)) {
        used.add(pl.id);
        idMap[e.id] = { id: figureId(pl.id), rosterId: pl.id, label: pl.name, short: pl.kuerzel, number: pl.nummer || '', color: plan.sq.farbe, rolle: rl, role: roleOfPos(rl) };
      }
    }
    return idMap[e.id] ? { ...e, ...idMap[e.id] } : e;
  };
  p.elements = p.elements.map(apply);
  for (const st of p.anim?.steps || []) st.els = Object.fromEntries(Object.values(st.els || {}).map((e) => { const ne = apply(e); return [ne.id, ne]; }));
  return p;
}
/** Seite aus Vorlage: auf die Feldseite des Boards spiegeln und mit Aufstellung füllen */
export function pageFromTpl(t, b = board()) {
  const p = pageFromTemplate(t);
  if (!isNet(p) && (t.ownSide || 'left') !== (b.ownSide || 'left')) mirrorPage(p); // Netzansicht ist immer Spielersicht
  return fillPageWithLineups(p, b);
}


/** Board-Einstellungen: Name, Feld, Mannschaft, Gegner, Seite */
export function openBoardSettings(b = board()) {
  const body = h('div', { class: 'form' });
  const render = () => {
    const name = h('input', { class: 'input', value: b.name });
    name.addEventListener('change', () => renameBoard(b.id, name.value.trim() || b.name));
    const ft = h('select', { class: 'input select' }, Object.entries(FIELDS).map(([k, f]) => h('option', { value: k, selected: b.fieldType === k }, f.label)));
    ft.onchange = () => setFieldType(b.id, ft.value);
    const rt = h('div', { class: 'seg' },
      ...[['own', 'Eigenes Team'], ['opp', 'Gegner']].map(([t, l]) =>
        h('button', { class: 'seg-btn' + (b.rosterTeam === t ? ' active' : ''), onclick: () => { b.rosterTeam = t; touch(b); render(); } }, l)));
    body.replaceChildren(...[
      h('label', { class: 'form-row' }, h('span', {}, 'Name'), name),
      h('label', { class: 'form-row' }, h('span', {}, 'Feld'), ft),
      boardSetupSection(b),
      !b.squadId && !b.oppSquadId ? h('div', { class: 'form-row' }, h('span', {}, 'Kartei-Spieler ohne Mannschaft stehen als'), rt) : null,
      h('div', { class: 'set-row' },
        h('div', {}, h('b', {}, 'Spiel-Infos & Statistik'), h('div', { class: 'muted small' }, b.game?.isGame ? 'Als Spiel markiert' : 'Datum, Gegner, Wettbewerb, Ergebnis')),
        h('button', { class: 'btn text', onclick: () => { if (b.id !== state.boardId) openBoard(b.id); m.close(); openStats('spiel'); } }, 'Öffnen')),
      h('p', { class: 'muted small' }, 'Das Setup gilt für alle Seiten dieses Boards. Beim Seitentausch wird das Board gespiegelt.')].filter(Boolean));
  };
  let m;
  render();
  m = modal({ title: 'Board-Einstellungen', wide: true, body, actions: [{ label: 'Fertig', primary: true }] });
}

/** Neues Board: Name, Feld, Mannschaft(en), optional direkt mit Aufstellung */
export function openNewBoard(onDone) {
  const name = h('input', { class: 'input', placeholder: 'z. B. Spiel gegen …' });
  const ft = h('select', { class: 'input select' }, Object.entries(FIELDS).map(([k, f]) => h('option', { value: k, selected: (board()?.fieldType || 'indiaca') === k }, f.label)));
  const cfg = { left: { squadId: '', lineupId: '', laeufer: 2 }, right: { squadId: '', lineupId: '', laeufer: 2 } };
  let start = true;
  const startBox = h('div', {});
  const renderStart = () => {
    const any = ['left', 'right'].some((s) => cfg[s].lineupId);
    const sw = h('button', { class: 'switch' + (start ? ' on' : ''), role: 'switch', 'aria-checked': String(start), 'aria-label': 'Mit Aufstellung starten', onclick: () => { start = !start; renderStart(); } }, h('span'));
    startBox.replaceChildren(any ? h('div', { class: 'set-row' }, h('div', {}, h('b', {}, 'Mit Aufstellung starten'), h('div', { class: 'muted small' }, 'Gewählte Aufstellungen mit Läufer direkt aufs Feld setzen')), sw) : '');
  };
  const ed = setupEditor(cfg, () => renderStart());
  renderStart();
  modal({
    title: 'Neues Board',
    wide: true,
    body: h('div', { class: 'form' },
      h('div', { class: 'form-2' },
        h('label', { class: 'form-row' }, h('span', {}, 'Name'), name),
        h('label', { class: 'form-row' }, h('span', {}, 'Feld'), ft)),
      h('div', { class: 'form-row' }, h('span', {}, 'Spiel-Setup (optional)'), ed),
      lib.squads.length ? null : h('p', { class: 'muted small' }, 'Tipp: Unter „Mannschaften“ legst du eigene Teams mit Aufstellungen an; Gegner gehen direkt hier über „＋ Neue Gegner-Mannschaft“.'),
      startBox),
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Anlegen', primary: true,
        onClick: () => {
          const n = name.value.trim();
          if (!n) { name.focus(); return false; }
          createBoard(n, ft.value);
          const b = board();
          // Eigene Mannschaft wird intern zum Team 'own' (Statistik); steht sie rechts, liegt das Board andersherum
          const isOwn = (s) => squadById(cfg[s].squadId)?.typ === 'eigen';
          b.ownSide = !isOwn('left') && isOwn('right') ? 'right' : 'left';
          writeSetup(b, cfg);
          if (start) placeSetup(b, b.pages[0]);
          touch(b);
          emit('board');
          emit('page');
          emit('elements');
          emit('boardSquad');
          onDone && onDone();
        },
      },
    ],
  });
  setTimeout(() => name.focus(), 60);
}

/** Titel im Header: Boardname · Mannschaft (vs Gegner) */
export function boardTitle(b = board()) {
  const { own, opp } = boardSquads(b);
  return b.name + (own ? ` · ${own.name}` : '') + (opp ? ` vs ${opp.name}` : '');
}
