import { h } from '../util.js';
import { I } from '../icons.js';
import { on } from '../store.js';
import { lib, POS_NUMS, roleName, initials, addPlayer, updatePlayer, deletePlayer, sortedRoster, playerById } from '../library.js';
import { modal, confirmDlg, choose } from './dialogs.js';
import { playerHasStats, purgePlayerStats } from '../gamestats.js';

/** Menüpunkt „Spieler“: Spielerkartei (app-weit, für alle Boards) */
export function openRoster() {
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Spieler suchen …', enterkeyhint: 'search' });
  const listEl = h('div', { class: 'ros-list' });
  const render = () => {
    const q = search.value.trim().toLowerCase();
    const list = sortedRoster().filter((p) => !q || p.name.toLowerCase().includes(q) || p.kuerzel.toLowerCase().includes(q) || String(p.nummer).includes(q));
    listEl.replaceChildren(
      ...(list.length
        ? list.map((p) =>
            h('div', { class: 'ros-row' },
              h('span', { class: 'ros-badge' }, p.kuerzel || '?'),
              h('button', { class: 'ros-main', onclick: () => editPlayer(p.id) },
                h('b', {}, p.name),
                h('span', { class: 'muted small' }, [p.nummer !== '' && p.nummer != null ? `#${p.nummer}` : null, p.stdPos ? `Pos. ${p.stdPos} · ${roleName(p.stdPos)}` : 'keine Standardposition'].filter(Boolean).join(' · '))),
              h('button', { class: 'btn', 'aria-label': `${p.name} bearbeiten`, html: I.edit, onclick: () => editPlayer(p.id) }),
              h('button', { class: 'btn danger-ic', 'aria-label': `${p.name} löschen`, html: I.trash, onclick: () => removePlayer(p.id) })))
        : [h('p', { class: 'muted' }, lib.roster.length ? 'Kein Spieler gefunden.' : 'Noch keine Spieler angelegt. Tippe auf „+ Spieler“.')])
    );
  };
  search.addEventListener('input', render);
  const m = modal({
    title: 'Spieler',
    wide: true,
    body: h('div', { class: 'ros' },
      h('div', { class: 'ros-top' }, search, h('button', { class: 'btn text primary', onclick: () => editPlayer(null) }, '+ Spieler')),
      listEl,
      h('p', { class: 'muted small' }, 'Die Kartei gilt für alle Boards. Namensänderungen werden auf allen Seiten übernommen.')),
  });
  render();
  on('library', () => document.body.contains(m.box) && render());
}

async function removePlayer(id) {
  const p = playerById(id);
  if (playerHasStats(id)) {
    const r = await choose(`${p.name} löschen?`, 'Der Spieler hat Statistik-Einträge. Was soll damit passieren? Figuren auf dem Feld bleiben als normale Figuren stehen.', [
      { id: 'keep', label: 'Stats behalten (archivieren)', sub: 'zählt weiter in Hall of Fame und Spielstatistik', primary: true },
      { id: 'del', label: 'Stats ebenfalls löschen', sub: 'alle Einträge in allen Boards entfernen', danger: true },
    ]);
    if (!r) return;
    if (r === 'del') purgePlayerStats(id);
    deletePlayer(id, { archive: r === 'keep' });
    return;
  }
  if (await confirmDlg('Spieler löschen?', `„${p.name}“ wird aus der Kartei und allen Mannschaften entfernt. Figuren auf dem Feld bleiben als normale Figuren stehen.`, { okLabel: 'Löschen', danger: true }))
    deletePlayer(id);
}

/** Spieler anlegen (id = null) oder bearbeiten */
export function editPlayer(id, { onSaved } = {}) {
  const p = id ? playerById(id) : null;
  const name = h('input', { class: 'input', value: p?.name || '', placeholder: 'Vor- und Nachname', autocomplete: 'off' });
  const kz = h('input', { class: 'input', value: p?.kuerzel || '', placeholder: 'z. B. JK', maxlength: 4, autocomplete: 'off' });
  const nr = h('input', { class: 'input', value: p?.nummer ?? '', placeholder: 'optional', inputmode: 'numeric', maxlength: 3 });
  let kzTouched = !!p;
  kz.addEventListener('input', () => (kzTouched = true));
  name.addEventListener('input', () => { if (!kzTouched) kz.value = initials(name.value); });
  let pos = p?.stdPos || null;
  const posBox = h('div', { class: 'pos-pick' });
  const renderPos = () =>
    posBox.replaceChildren(
      h('button', { class: 'pos-btn' + (!pos ? ' active' : ''), onclick: () => { pos = null; renderPos(); } }, h('b', {}, '–'), h('span', {}, 'keine')),
      ...POS_NUMS.map((n) => h('button', { class: 'pos-btn' + (pos === n ? ' active' : ''), onclick: () => { pos = n; renderPos(); } }, h('b', {}, String(n)), h('span', {}, roleName(n))))
    );
  renderPos();
  const field = (label, input) => h('label', { class: 'form-row' }, h('span', {}, label), input);
  modal({
    title: p ? 'Spieler bearbeiten' : 'Neuer Spieler',
    body: h('div', { class: 'form' },
      field('Name', name),
      h('div', { class: 'form-2' }, field('Kürzel (auf der Figur)', kz), field('Rückennummer', nr)),
      h('div', { class: 'form-row' }, h('span', {}, 'Standardposition'), posBox)),
    actions: [
      { label: 'Abbrechen' },
      {
        label: 'Speichern', primary: true,
        onClick: () => {
          const n = name.value.trim();
          if (!n) { name.focus(); return false; }
          const data = { name: n, kuerzel: kz.value.trim() || initials(n), nummer: nr.value.trim(), stdPos: pos };
          const saved = p ? (updatePlayer(p.id, data), playerById(p.id)) : addPlayer(data);
          onSaved && onSaved(saved);
        },
      },
    ],
  });
  setTimeout(() => !p && name.focus(), 60);
}
