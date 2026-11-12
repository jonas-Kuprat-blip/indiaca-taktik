import { h, NS, colorCss } from '../util.js';
import { I } from '../icons.js';
import { on } from '../store.js';
import {
  lib, POS_NUMS, roleName, posOfRole, rotOfLaeufer, sortedRoster, sortedSquads, squadById, squadPlayers, addSquad, updateSquad, deleteSquad,
  setSquadMember, addLineup, lineupById, updateLineup, assignSlot, setDefaultLineup, deleteLineup, duplicateLineup, playerById,
} from '../library.js';
import { modal, confirmDlg, promptText, colorPicker } from './dialogs.js';
import { editPlayer } from './roster.js';
import { laeuferSeg } from '../kader.js';
import { openNewOpponent } from './setup.js';

const live = (m, render) => on('library', () => document.body.contains(m.box) && render());

/** Menüpunkt „Mannschaften“ */
export function openSquads() {
  const listEl = h('div', { class: 'ros-list' });
  const row = (sq) =>
            h('div', { class: 'ros-row' },
              h('span', { class: 'sq-dot', style: { background: sq.farbe } }),
              h('button', { class: 'ros-main', onclick: () => openSquad(sq.id) },
                h('b', {}, sq.name),
                h('span', { class: 'muted small' }, `${sq.spielerIds.length} Spieler · ${sq.aufstellungen.length} Aufstellung${sq.aufstellungen.length === 1 ? '' : 'en'}`)),
              h('button', { class: 'btn', 'aria-label': `${sq.name} bearbeiten`, html: I.edit, onclick: () => openSquad(sq.id) }),
              h('button', {
                class: 'btn danger-ic', 'aria-label': `${sq.name} löschen`, html: I.trash,
                onclick: async () => { if (await confirmDlg('Mannschaft löschen?', `„${sq.name}“ mit allen Aufstellungen wird gelöscht. Die Spieler bleiben in der Kartei.`, { okLabel: 'Löschen', danger: true })) deleteSquad(sq.id); },
              }));
  const render = () => {
    const own = sortedSquads().filter((s) => s.typ !== 'gegner');
    const opp = sortedSquads().filter((s) => s.typ === 'gegner');
    listEl.replaceChildren(
      ...(lib.squads.length
        ? [h('h3', {}, `Eigene Mannschaften (${own.length})`), ...own.map(row),
           ...(opp.length ? [h('h3', {}, `Gegner / Liga (${opp.length})`), ...opp.map(row)] : [])]
        : [h('p', { class: 'muted' }, 'Noch keine Mannschaften. Tippe auf „+ Mannschaft“.')])
    );
  };
  const m = modal({
    title: 'Mannschaften',
    wide: true,
    body: h('div', { class: 'ros' },
      h('div', { class: 'ros-top' }, h('div', { style: { flex: 1 } }),
        h('button', { class: 'btn text', onclick: () => openNewOpponent((sq) => openSquad(sq.id)) }, '+ Gegner'),
        h('button', { class: 'btn text primary', onclick: async () => { const n = await promptText('Neue Mannschaft', '', { placeholder: 'z. B. Herren 1', okLabel: 'Anlegen' }); if (n) openSquad(addSquad({ name: n }).id); } }, '+ Mannschaft')),
      listEl),
  });
  render();
  live(m, render);
}

/** Eine Mannschaft bearbeiten: Name, Farbe, Spieler, Aufstellungen */
export function openSquad(id) {
  const body = h('div', { class: 'sq' });
  const render = () => {
    const sq = squadById(id);
    if (!sq) return;
    const name = h('input', { class: 'input', value: sq.name, 'aria-label': 'Name der Mannschaft' });
    name.addEventListener('change', () => updateSquad(id, { name: name.value.trim() || sq.name }));
    const colorBtn = h('button', { class: 'swatch-btn', 'aria-label': 'Teamfarbe', title: 'Teamfarbe' }, h('span', { class: 'swatch', style: { background: sq.farbe } }));
    colorBtn.onclick = () => colorPicker(colorBtn, sq.farbe, (c) => updateSquad(id, { farbe: c }), { allowInk: false });

    // Spieler zuteilen (ein Spieler kann in mehreren Mannschaften sein)
    const q = body.querySelector('.sq-search')?.value || '';
    const search = h('input', { class: 'input sq-search', type: 'search', placeholder: 'Kartei durchsuchen …', value: q });
    const members = h('div', { class: 'sq-members' });
    const renderMembers = () => {
      const t = search.value.trim().toLowerCase();
      const all = sortedRoster().filter((p) => sq.typ === 'gegner' || !p.extern || sq.spielerIds.includes(p.id)).filter((p) => !t || p.name.toLowerCase().includes(t) || p.kuerzel.toLowerCase().includes(t));
      members.replaceChildren(
        ...(all.length
          ? all.map((p) => {
              const on = sq.spielerIds.includes(p.id);
              return h('button', { class: 'mem' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: () => setSquadMember(id, p.id, !on) },
                h('span', { class: 'mem-check', html: on ? '✓' : '' }), h('span', { class: 'ros-badge sm', style: { background: sq.farbe } }, p.kuerzel), h('span', { class: 'mem-name' }, p.name));
            })
          : [h('p', { class: 'muted small' }, lib.roster.length ? 'Kein Spieler gefunden.' : 'Die Kartei ist noch leer.')])
      );
    };
    search.addEventListener('input', renderMembers);
    renderMembers();

    const lineups = h('div', { class: 'ros-list' },
      ...(sq.aufstellungen.length
        ? sq.aufstellungen.map((a) => {
            const filled = POS_NUMS.filter((n) => a.slots[n]).length;
            return h('div', { class: 'ros-row' },
              h('button', { class: 'btn star' + (a.standard ? ' on' : ''), 'aria-label': 'Als Standard markieren', title: a.standard ? 'Standard-Aufstellung' : 'Als Standard markieren', html: I.star, onclick: () => setDefaultLineup(id, a.id) }),
              h('button', { class: 'ros-main', onclick: () => openLineup(id, a.id) },
                h('b', {}, a.name + (a.standard ? ' · Standard' : '')),
                h('span', { class: 'muted small' }, POS_NUMS.map((n) => `${n}: ${playerById(a.slots[n])?.kuerzel || '–'}`).join('  ') + `  (${filled}/5)`)),
              h('button', { class: 'btn', 'aria-label': 'Duplizieren', html: I.copy, onclick: () => duplicateLineup(id, a.id) }),
              h('button', { class: 'btn danger-ic', 'aria-label': 'Aufstellung löschen', html: I.trash, onclick: async () => { if (await confirmDlg('Aufstellung löschen?', `„${a.name}“ wird gelöscht.`, { okLabel: 'Löschen', danger: true })) deleteLineup(id, a.id); } }));
          })
        : [h('p', { class: 'muted small' }, 'Noch keine Aufstellung.')]));

    const typ = h('div', { class: 'seg' },
      [['eigen', 'Eigene Mannschaft'], ['gegner', 'Gegner / Liga']].map(([k, l]) =>
        h('button', { class: 'seg-btn' + ((sq.typ || 'eigen') === k ? ' active' : ''), onclick: () => updateSquad(id, { typ: k }) }, l)));
    body.replaceChildren(
      h('div', { class: 'sq-head' }, colorBtn, name),
      h('div', { class: 'form-row' }, h('span', {}, sq.typ === 'gegner' ? 'Typ – zählt nicht in Hall of Fame und Siegquoten' : 'Typ'), typ),
      h('h3', {}, `Spieler (${sq.spielerIds.length})`),
      h('div', { class: 'ros-top' }, search, h('button', { class: 'btn text', onclick: () => editPlayer(null, { onSaved: (p) => setSquadMember(id, p.id, true) }) }, '+ Neuer Spieler')),
      members,
      h('h3', {}, 'Aufstellungen'),
      lineups,
      h('button', { class: 'btn text', style: { alignSelf: 'flex-start' }, onclick: () => openLineup(id, addLineup(id).id) }, '+ Aufstellung'));
  };
  const m = modal({ title: 'Mannschaft', wide: true, body, actions: [{ label: 'Fertig', primary: true }] });
  render();
  live(m, () => { if (!body.contains(document.activeElement)) render(); });
}

/**
 * Aufstellung bearbeiten: Mini-Feld (eigene Hälfte, Netz oben) mit den 5 Positionen.
 * Zuordnen per Dropdown oder per Drag & Drop eines Spielers auf eine Position.
 */
export function openLineup(squadId, lineupId) {
  const HW = 3.05, HL = 8, PAD = 0.7;
  const body = h('div', { class: 'lu' });
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `${-HW - PAD} ${-PAD} ${2 * HW + 2 * PAD} ${HL + 2 * PAD}`);
  svg.classList.add('pos-editor', 'lu-field');
  const render = () => {
    const sq = squadById(squadId);
    const a = lineupById(sq, lineupId);
    if (!a) return;
    let out = `<rect class="pe-out" x="${-HW - PAD}" y="${-PAD}" width="${2 * HW + 2 * PAD}" height="${HL + 2 * PAD}"/><rect class="pe-court" x="${-HW}" y="0" width="${2 * HW}" height="${HL}"/>` +
      `<line class="pe-line" x1="${-HW}" y1="3" x2="${HW}" y2="3"/><rect class="pe-line" x="${-HW}" y="0" width="${2 * HW}" height="${HL}"/><line class="pe-net" x1="${-HW - 0.3}" y1="0" x2="${HW + 0.3}" y2="0"/>`;
    const r = rotOfLaeufer(a.laeufer || 2);
    for (const n of POS_NUMS) {
      // n = Rolle; sie steht bei diesem Läufer auf Position pos
      const pos = posOfRole(n, r);
      const p = lib.positions[pos];
      const pl = playerById(a.slots[n]);
      out += `<g class="lu-slot${pl ? ' filled' : ''}" data-n="${n}" transform="translate(${p.l * HW} ${p.d * HL})"><circle r="0.75" class="pe-hit"/>` +
        `<circle r="0.55" class="lu-dot" style="fill:${pl ? sq.farbe : 'transparent'}"/>` +
        `<text text-anchor="middle" dominant-baseline="central" font-size="${pl ? 0.42 : 0.42}">${pl ? pl.kuerzel : 'R' + n}</text>` +
        `<text class="lu-num" x="0.62" y="-0.55" font-size="0.32">${pos}</text></g>`;
    }
    svg.innerHTML = out;

    const name = h('input', { class: 'input', value: a.name, 'aria-label': 'Name der Aufstellung' });
    name.addEventListener('change', () => updateLineup(squadId, lineupId, { name: name.value.trim() || a.name }));
    const std = h('button', { class: 'switch' + (a.standard ? ' on' : ''), role: 'switch', 'aria-checked': String(a.standard), onclick: () => setDefaultLineup(squadId, lineupId) }, h('span'));
    const players = squadPlayers(sq);
    const rot = (d) => updateLineup(squadId, lineupId, { laeufer: posOfRole(2, rotOfLaeufer(a.laeufer || 2) + d) });
    const rotRow = h('div', { class: 'lu-rot' },
      h('button', { class: 'btn text', 'aria-label': 'Zurück drehen', title: 'Zurück drehen (Pos. 1 → 2 …)', onclick: () => rot(1) }, '↺ Zurück'),
      h('span', { class: 'lu-l' }, h('b', {}, 'Läufer ' + (a.laeufer || 2)), h('span', { class: 'muted small' }, 'Standard dieser Aufstellung')),
      h('button', { class: 'btn text', 'aria-label': 'Vor drehen', title: 'Vor drehen (Pos. 2 → 1 …)', onclick: () => rot(-1) }, 'Vor ↻'));
    const rows = POS_NUMS.map((n) => {
      const sel = h('select', { class: 'input select', 'aria-label': `Rolle ${n} ${roleName(n)}` },
        h('option', { value: '' }, '– leer –'),
        players.map((p) => h('option', { value: p.id, selected: a.slots[n] === p.id }, `${p.kuerzel} · ${p.name}`)));
      sel.onchange = () => assignSlot(squadId, lineupId, n, sel.value || null);
      return h('label', { class: 'pe-name' }, h('span', { class: 'pe-num', style: { background: sq.farbe } }, 'R' + n), h('span', { class: 'lu-role' }, `${roleName(n)} · Pos. ${posOfRole(n, rotOfLaeufer(a.laeufer || 2))}`), sel);
    });
    const chips = h('div', { class: 'lu-chips' },
      ...(players.length
        ? players.map((p) => {
            const used = POS_NUMS.some((n) => a.slots[n] === p.id);
            const c = h('div', { class: 'lu-chip' + (used ? ' used' : ''), title: 'Auf eine Position ziehen' }, h('span', { class: 'ros-badge sm', style: { background: sq.farbe } }, p.kuerzel), p.name);
            bindChipDrag(c, p.id);
            return c;
          })
        : [h('span', { class: 'muted small' }, 'Der Mannschaft sind noch keine Spieler zugeteilt.')]));
    body.replaceChildren(
      h('div', { class: 'lu-top' }, name, h('label', { class: 'lu-std' }, std, 'Standard')),
      h('div', { class: 'pe' },
        h('div', { class: 'pe-field' }, svg, rotRow, laeuferSeg(a.laeufer || 2, (L) => updateLineup(squadId, lineupId, { laeufer: L })), h('div', { class: 'muted small' }, 'Spieler auf einen Platz ziehen. Antippen eines belegten Platzes leert ihn. Kleine Zahl = Position.')),
        h('div', { class: 'pe-names' }, ...rows, h('div', { class: 'muted small', style: { marginTop: '6px' } }, 'Spieler der Mannschaft'), chips)));
  };
  const bindChipDrag = (chip, playerId) => {
    let ghost = null, start = null;
    chip.addEventListener('pointerdown', (e) => { e.preventDefault(); start = { x: e.clientX, y: e.clientY }; try { chip.setPointerCapture(e.pointerId); } catch {} });
    chip.addEventListener('pointermove', (e) => {
      if (!start) return;
      if (!ghost && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) {
        ghost = chip.cloneNode(true);
        ghost.classList.add('lu-ghost');
        document.body.append(ghost);
      }
      if (ghost) { ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px'; }
    });
    const end = (e) => {
      if (!start) return;
      start = null;
      if (!ghost) return;
      ghost.remove();
      ghost = null;
      const slot = document.elementsFromPoint(e.clientX, e.clientY).map((el) => el.closest?.('.lu-slot')).find(Boolean);
      if (slot) assignSlot(squadId, lineupId, +slot.dataset.n, playerId);
    };
    chip.addEventListener('pointerup', end);
    chip.addEventListener('pointercancel', () => { start = null; ghost?.remove(); ghost = null; });
  };
  // Tippen auf eine belegte Position leert sie
  svg.addEventListener('click', (e) => {
    const slot = e.target.closest('.lu-slot.filled');
    if (slot) assignSlot(squadId, lineupId, +slot.dataset.n, null);
  });
  const m = modal({ title: 'Aufstellung', wide: true, body, actions: [{ label: 'Fertig', primary: true }] });
  render();
  live(m, () => { if (!body.contains(document.activeElement) || document.activeElement.tagName === 'SELECT') render(); });
}
