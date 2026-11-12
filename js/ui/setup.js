import { h } from '../util.js';
import { page, touch, emit } from '../store.js';
import { POS_NUMS, roleName, squadById, sortedSquads, lineupById, defaultLineup, addSquad, addPlayer, setSquadMember, addLineup, assignSlot, updateSquad, initials } from '../library.js';
import { applyLineup, laeuferSeg, mirrorBoard } from '../kader.js';
import { modal, choose, toast } from './dialogs.js';
import { COLORS } from '../model.js';

/*
 * Spiel-Setup „Mannschaft gegen Mannschaft“: linke und rechte Seite mit Mannschaft, Aufstellung und Läufer.
 * Intern bleiben die Teams 'own' (Seite board.ownSide) und 'opp':
 *   board.squadId / board.oppSquadId   Mannschaften
 *   board.setup = { own: { lineupId, laeufer }, opp: { lineupId, laeufer } }
 */

const other = (s) => (s === 'left' ? 'right' : 'left');
export const teamOfSide = (b, side) => ((b.ownSide || 'left') === side ? 'own' : 'opp');

/** Setup eines Boards als { left, right } */
export function setupFromBoard(b) {
  const one = (team) => {
    const sqId = team === 'own' ? b.squadId : b.oppSquadId;
    const sq = squadById(sqId);
    const st = b.setup?.[team] || {};
    const lu = lineupById(sq, st.lineupId) || defaultLineup(sq);
    return { squadId: sq ? sq.id : '', lineupId: lu?.id || '', laeufer: st.laeufer || lu?.laeufer || 2 };
  };
  return { left: one(teamOfSide(b, 'left')), right: one(teamOfSide(b, 'right')) };
}

/** Setup ins Board schreiben (ohne Figuren zu verändern) */
export function writeSetup(b, cfg) {
  const own = cfg[b.ownSide || 'left'], opp = cfg[other(b.ownSide || 'left')];
  if (own.squadId) b.squadId = own.squadId; else delete b.squadId;
  if (opp.squadId) b.oppSquadId = opp.squadId; else delete b.oppSquadId;
  b.setup = {
    own: { lineupId: own.lineupId || null, laeufer: own.laeufer || 2 },
    opp: { lineupId: opp.lineupId || null, laeufer: opp.laeufer || 2 },
  };
  touch(b);
  emit('board');
  emit('boardSquad');
}

/** Aufstellungen des Setups auf eine Seite setzen (ersetzt die Spieler der jeweiligen Teams) */
export function placeSetup(b, pg) {
  let n = 0;
  for (const team of ['own', 'opp']) {
    const sq = squadById(team === 'own' ? b.squadId : b.oppSquadId);
    const st = b.setup?.[team] || {};
    const lu = lineupById(sq, st.lineupId) || defaultLineup(sq);
    if (!sq || !lu) continue;
    applyLineup(sq, lu, team, 'replace', pg, b, st.laeufer || lu.laeufer || 2);
    n++;
  }
  return n;
}

const typLabel = (s) => (s.typ === 'gegner' ? 'Gegner/Liga' : 'Eigene');
export function squadSelect(cur, onPick, label) {
  const eigene = sortedSquads().filter((s) => s.typ !== 'gegner');
  const gegner = sortedSquads().filter((s) => s.typ === 'gegner');
  const sel = h('select', { class: 'input select', 'aria-label': label },
    h('option', { value: '' }, '– keine –'),
    eigene.length ? h('optgroup', { label: 'Eigene Mannschaften' }, eigene.map((s) => h('option', { value: s.id, selected: s.id === cur }, s.name))) : null,
    gegner.length ? h('optgroup', { label: 'Gegner / Liga' }, gegner.map((s) => h('option', { value: s.id, selected: s.id === cur }, s.name))) : null);
  sel.onchange = () => onPick(sel.value);
  return sel;
}

/**
 * Editor für beide Seiten. cfg wird direkt verändert, onChange(cfg, what) danach aufgerufen.
 * opts.onSwap: eigener Seitentausch (Board-Einstellungen spiegeln das Board)
 */
export function setupEditor(cfg, onChange, { onSwap } = {}) {
  const box = h('div', { class: 'setup' });
  const render = () => {
    const col = (side) => {
      const c = cfg[side];
      const sq = squadById(c.squadId);
      if (sq && !lineupById(sq, c.lineupId)) {
        const d = defaultLineup(sq);
        c.lineupId = d?.id || '';
        c.laeufer = d?.laeufer || 2;
      }
      if (!sq) c.lineupId = '';
      const lus = sq?.aufstellungen || [];
      const luSel = h('select', { class: 'input select', disabled: !lus.length, 'aria-label': `Aufstellung ${side === 'left' ? 'links' : 'rechts'}` },
        lus.length ? lus.map((a) => h('option', { value: a.id, selected: a.id === c.lineupId }, a.name + (a.standard ? ' (Standard)' : ''))) : h('option', { value: '' }, sq ? 'keine Aufstellung' : '–'));
      luSel.onchange = () => { c.lineupId = luSel.value; c.laeufer = lineupById(sq, luSel.value)?.laeufer || 2; changed('lineup'); };
      return h('div', { class: 'setup-col', style: { '--team': sq?.farbe || 'var(--border)' } },
        h('div', { class: 'setup-h' }, h('b', {}, side === 'left' ? 'Linke Seite' : 'Rechte Seite'), sq ? h('span', { class: 'setup-typ' }, typLabel(sq)) : null),
        h('label', { class: 'form-row' }, h('span', {}, 'Mannschaft'),
          squadSelect(c.squadId, (v) => { c.squadId = v; c.lineupId = ''; changed('squad'); }, `Mannschaft ${side === 'left' ? 'links' : 'rechts'}`)),
        h('button', { class: 'btn text setup-new', onclick: () => openNewOpponent((s) => { c.squadId = s.id; c.lineupId = ''; changed('squad'); }) }, '＋ Neue Gegner-Mannschaft'),
        h('label', { class: 'form-row' }, h('span', {}, 'Aufstellung'), luSel),
        h('div', { class: 'form-row' }, h('span', {}, 'Läufer'), laeuferSeg(c.laeufer || 2, (L) => { c.laeufer = L; changed('laeufer'); })));
    };
    box.replaceChildren(
      h('div', { class: 'setup-cols' }, col('left'),
        h('button', {
          class: 'btn setup-swap', title: 'Seiten tauschen', 'aria-label': 'Seiten tauschen', html: '⇄',
          onclick: () => {
            if (onSwap) onSwap();
            else [cfg.left, cfg.right] = [cfg.right, cfg.left];
            changed('swap');
          },
        }),
        col('right')));
  };
  const changed = (what) => {
    onChange && onChange(cfg, what);
    render();
  };
  render();
  box.refresh = render;
  return box;
}

/** Setup-Abschnitt für die Board-Einstellungen (wirkt sofort auf das Board) */
export function boardSetupSection(b) {
  let cfg = setupFromBoard(b);
  const ed = setupEditor(cfg, (c, what) => {
    if (what !== 'swap') writeSetup(b, c);
  }, {
    onSwap: () => {
      b.ownSide = b.ownSide === 'right' ? 'left' : 'right';
      mirrorBoard(b);
      touch(b);
      emit('board');
      emit('page');
      emit('elements');
      Object.assign(cfg, setupFromBoard(b));
    },
  });
  const placeBtn = h('button', {
    class: 'btn text primary', onclick: async () => {
      const pg = page();
      const has = pg.elements.some((e) => e.type === 'player');
      if (has && !(await choose('Aufstellungen aufs Feld setzen?', 'Die Spieler beider Mannschaften auf dieser Seite werden durch die gewählten Aufstellungen ersetzt.', [{ id: 'ok', label: 'Ersetzen', primary: true }]))) return;
      const n = placeSetup(b, pg);
      toast(n ? 'Aufstellungen gesetzt' : 'Keine Aufstellung gewählt');
    },
  }, 'Aufstellungen aufs Feld setzen');
  return h('div', { class: 'form-row' }, h('span', {}, 'Spiel-Setup'), ed, placeBtn);
}

/** Schnell eine Gegner-/Liga-Mannschaft anlegen: Name, Farbe, optional Spieler mit Rolle */
export function openNewOpponent(onCreated) {
  const name = h('input', { class: 'input', placeholder: 'z. B. TV Musterstadt', 'aria-label': 'Name der Gegner-Mannschaft' });
  let farbe = '#dc2626';
  const swatches = h('div', { class: 'swatch-row' });
  const renderSw = () => swatches.replaceChildren(...COLORS.filter((c) => c !== 'ink' && c !== '#ffffff').concat(['#111827', '#0ea5e9', '#ec4899']).map((c) =>
    h('button', { class: 'swatch-btn' + (c === farbe ? ' active' : ''), 'aria-label': `Farbe ${c}`, onclick: () => { farbe = c; renderSw(); } }, h('span', { class: 'swatch', style: { background: c } }))));
  renderSw();
  const rows = POS_NUMS.map((n) => {
    const i = h('input', { class: 'input', placeholder: 'Name (optional)', 'aria-label': `Spieler ${roleName(n)}`, autocomplete: 'off' });
    return { n, i, el: h('label', { class: 'pe-name' }, h('span', { class: 'pe-num' }, 'R' + n), h('span', { class: 'lu-role' }, roleName(n)), i) };
  });
  modal({
    title: 'Neue Gegner-Mannschaft',
    body: h('div', { class: 'form' },
      h('label', { class: 'form-row' }, h('span', {}, 'Name'), name),
      h('div', { class: 'form-row' }, h('span', {}, 'Farbe'), swatches),
      h('div', { class: 'form-row' }, h('span', {}, 'Spieler (optional, mit Rolle in der Grundaufstellung)'), h('div', { class: 'pe-names' }, rows.map((r) => r.el))),
      h('p', { class: 'muted small' }, 'Die Spieler landen als „extern“ in der Kartei und sind dort standardmäßig ausgeblendet.')),
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Anlegen', primary: true,
        onClick: () => {
          const n = name.value.trim();
          if (!n) { name.focus(); return false; }
          const sq = addSquad({ name: n, farbe });
          updateSquad(sq.id, { typ: 'gegner' });
          const filled = rows.filter((r) => r.i.value.trim());
          if (filled.length) {
            const lu = addLineup(sq.id, 'Standard');
            for (const r of filled) {
              const pn = r.i.value.trim();
              const p = addPlayer({ name: pn, kuerzel: initials(pn), stdPos: r.n, extern: true });
              setSquadMember(sq.id, p.id, true);
              assignSlot(sq.id, lu.id, r.n, p.id);
            }
          }
          toast(`${n} angelegt`);
          onCreated && onCreated(squadById(sq.id));
        },
      },
    ],
  });
  setTimeout(() => name.focus(), 60);
}
