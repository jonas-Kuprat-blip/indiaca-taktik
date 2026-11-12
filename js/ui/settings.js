import { h, NS, clamp } from '../util.js';
import { state, set, on, emit } from '../store.js';
import { lib, POS_NUMS, roleName, setPosition, resetPositions, DEFAULT_POSITIONS, ACTION_CATS, setRoleName, updateAction, addAction, deleteAction, resetActions, libChanged } from '../library.js';
import { modal, confirmDlg } from './dialogs.js';
import { MONTHS } from '../alltime.js';
import { openHofSettings } from './hof.js';
import { NET_PRESETS, netHeights, DEFAULT_NET_HEIGHTS, fmtM } from '../net.js';
import { openBoardSettings } from '../kader.js';

/** Menüpunkt „Einstellungen“ */
export function openSettings() {
  const posToggle = h('button', { class: 'switch' + (state.showPosNumbers ? ' on' : ''), role: 'switch', 'aria-checked': String(!!state.showPosNumbers) }, h('span'));
  posToggle.onclick = () => {
    set({ showPosNumbers: !state.showPosNumbers });
    posToggle.classList.toggle('on', state.showPosNumbers);
    posToggle.setAttribute('aria-checked', String(state.showPosNumbers));
  };
  const fillToggle = h('button', { class: 'switch' + (state.fillTemplates !== false ? ' on' : ''), role: 'switch', 'aria-checked': String(state.fillTemplates !== false) }, h('span'));
  fillToggle.onclick = () => {
    set({ fillTemplates: state.fillTemplates === false });
    fillToggle.classList.toggle('on', state.fillTemplates !== false);
    fillToggle.setAttribute('aria-checked', String(state.fillTemplates !== false));
  };
  const season = h('select', { class: 'input select', 'aria-label': 'Saisonstart', style: { width: 'auto' } }, MONTHS.map((mn, i) => h('option', { value: i + 1, selected: lib.seasonStart === i + 1 }, mn)));
  season.onchange = () => { lib.seasonStart = +season.value; libChanged(); };
  const rotToggle = h('button', { class: 'switch' + (state.animRotation !== false ? ' on' : ''), role: 'switch', 'aria-checked': String(state.animRotation !== false), 'aria-label': 'Rotation animieren' }, h('span'));
  rotToggle.onclick = () => {
    set({ animRotation: state.animRotation === false });
    rotToggle.classList.toggle('on', state.animRotation !== false);
    rotToggle.setAttribute('aria-checked', String(state.animRotation !== false));
  };
  const sm = modal({
    title: 'Einstellungen',
    body: h('div', { class: 'form' },
      h('div', { class: 'set-row' },
        h('div', {}, h('b', {}, 'Positionsnummern anzeigen'), h('div', { class: 'muted small' }, 'Kleine Nummer 1–5 (aktuelle Position) an Figuren')),
        posToggle),
      h('div', { class: 'set-row' },
        h('div', {}, h('b', {}, 'Rotation animieren'), h('div', { class: 'muted small' }, 'Beim Drehen gleiten die Spieler in ca. 0,5 s auf ihre neuen Plätze')),
        rotToggle),
      h('div', { class: 'set-row' },
        h('div', {}, h('b', {}, 'Vorlagen mit Aufstellung füllen'), h('div', { class: 'muted small' }, 'Beim Laden einer Vorlage die Standard-Aufstellung der Board-Mannschaft einsetzen')),
        fillToggle),
      h('div', { class: 'set-row' },
        h('div', {}, h('b', {}, 'Board-Einstellungen'), h('div', { class: 'muted small' }, 'Mannschaft, Gegner, Seite, Feld, Name')),
        h('button', { class: 'btn text', onclick: () => openBoardSettings() }, 'Öffnen')),
      h('div', { class: 'set-row' },
        h('div', {}, h('b', {}, 'Saisonstart'), h('div', { class: 'muted small' }, 'Monat, in dem eine neue Saison beginnt (für Filter in Profil und Hall of Fame)')),
        season),
      h('div', { class: 'set-row' },
        h('div', {}, h('b', {}, 'Statistik-Aktionen'), h('div', { class: 'muted small' }, 'Umbenennen, hinzufügen, deaktivieren')),
        h('button', { class: 'btn text', onclick: openActions }, 'Öffnen')),
      h('div', { class: 'set-row' },
        h('div', {}, h('b', {}, 'Netzhöhen'), h('div', { class: 'muted small' }, 'Voreinstellungen für die Netzansicht: ' + NET_PRESETS.filter(([k]) => k !== 'manuell').map(([k, l]) => `${l} ${fmtM(netHeights()[k])}`).join(' · '))),
        h('button', { class: 'btn text', onclick: openNetHeights }, 'Ändern')),
      h('div', { class: 'set-row' },
        h('div', {}, h('b', {}, 'Hall of Fame'), h('div', { class: 'muted small' }, 'Kategorien, Sprüche, Wall of Shame, Mindestwerte')),
        h('button', { class: 'btn text', onclick: openHofSettings }, 'Öffnen')),
      h('div', { class: 'set-row' },
        h('div', {}, h('b', {}, 'Positionen anpassen'), h('div', { class: 'muted small' }, 'Positionspunkte verschieben und Rollen umbenennen')),
        h('button', { class: 'btn text', onclick: openPositions }, 'Öffnen'))),
    actions: [{ label: 'Fertig', primary: true }],
  });
  showVersion(sm.box);
}

/** Installierte Version (aus dem Service Worker) unten in den Einstellungen anzeigen */
function showVersion(modalBox) {
  const box = modalBox?.querySelector('.modal-body');
  if (!box) return;
  const el = h('p', { class: 'muted small app-version' }, 'Version wird geprüft …');
  box.append(el);
  const sw = navigator.serviceWorker;
  if (!sw?.controller) return (el.textContent = 'Version: ohne Offline-Speicher (Browser-Vorschau)');
  const onMsg = (e) => {
    if (!e.data?.version) return;
    el.textContent = `Version ${e.data.version.replace('taktik-', '')} · Updates kommen automatisch beim Öffnen der App`;
    sw.removeEventListener('message', onMsg);
  };
  sw.addEventListener('message', onMsg);
  sw.controller.postMessage('version');
}

/**
 * „Positionen anpassen“: eigene Feldhälfte im Hochformat (Netz oben), 5 Punkte per Drag & Drop.
 * Gespeichert wird relativ (d = Abstand zum Netz, l = seitlich), damit es für jedes Feld passt.
 */
export function openPositions() {
  const HW = 3.05, HL = 8, PAD = 0.6; // Indiaca-Halbfeld als Vorschau (Meter)
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `${-HW - PAD} ${-PAD} ${2 * HW + 2 * PAD} ${HL + 2 * PAD}`);
  svg.classList.add('pos-editor');
  const draw = () => {
    let out = `<rect class="pe-out" x="${-HW - PAD}" y="${-PAD}" width="${2 * HW + 2 * PAD}" height="${HL + 2 * PAD}"/>` +
      `<rect class="pe-court" x="${-HW}" y="0" width="${2 * HW}" height="${HL}"/>` +
      `<line class="pe-line" x1="${-HW}" y1="3" x2="${HW}" y2="3"/>` +
      `<rect class="pe-line" x="${-HW}" y="0" width="${2 * HW}" height="${HL}"/>` +
      `<line class="pe-net" x1="${-HW - 0.3}" y1="0" x2="${HW + 0.3}" y2="0"/>` +
      `<text class="pe-lbl" x="0" y="-0.25" text-anchor="middle" font-size="0.32">Netz</text>`;
    for (const n of POS_NUMS) {
      const p = lib.positions[n];
      const x = p.l * HW, y = p.d * HL;
      out += `<g class="pe-pt" data-n="${n}" transform="translate(${x} ${y})"><circle r="0.62" class="pe-hit"/><circle r="0.42" class="pe-dot"/><text text-anchor="middle" dominant-baseline="central" font-size="0.46">${n}</text></g>`;
    }
    svg.innerHTML = out;
  };
  draw();
  let drag = null;
  const toModel = (e) => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
    return { l: clamp(p.x / HW, -1, 1), d: clamp(p.y / HL, 0, 1) };
  };
  svg.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('.pe-pt');
    if (!g) return;
    e.preventDefault();
    drag = +g.dataset.n;
    try { svg.setPointerCapture(e.pointerId); } catch {}
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { l, d } = toModel(e);
    lib.positions[drag].l = Math.round(l * 1000) / 1000;
    lib.positions[drag].d = Math.round(d * 1000) / 1000;
    draw();
  });
  const end = () => {
    if (drag) setPosition(drag, {}); // speichert
    drag = null;
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  const names = h('div', { class: 'pe-names' });
  const renderNames = () =>
    names.replaceChildren(...POS_NUMS.map((n) => {
      const i = h('input', { class: 'input', value: roleName(n), 'aria-label': `Name Rolle ${n}` });
      i.addEventListener('change', () => setRoleName(n, i.value));
      return h('label', { class: 'pe-name' }, h('span', { class: 'pe-num' }, String(n)), i);
    }));
  renderNames();
  modal({
    title: 'Positionen anpassen',
    wide: true,
    body: h('div', { class: 'pe' },
      h('div', { class: 'pe-field' }, svg, h('div', { class: 'muted small' }, 'Eigene Feldhälfte, Netz oben. Die Punkte sind die Positionen 1–5 – ziehen zum Verschieben.')),
      h('div', {}, h('div', { class: 'muted small', style: { marginBottom: '6px' } }, 'Rollen – in der Grundaufstellung (Läufer 2) steht Rolle n auf Position n. Beim Drehen wandert die Rolle mit dem Spieler.'), names)),
    actions: [
      { label: 'Zurücksetzen', danger: true, onClick: async () => { if (await confirmDlg('Positionen zurücksetzen?', 'Alle 5 Positionspunkte und Rollennamen werden auf den Standard gesetzt.', { okLabel: 'Zurücksetzen', danger: true })) { resetPositions(); draw(); renderNames(); } return false; } },
      { label: 'Fertig', primary: true },
    ],
  });
}

/** Statistik-Aktionen verwalten */
export function openActions() {
  const box = h('div', { class: 'act-ed' });
  const seg = (val, opts, onPick, label) =>
    h('div', { class: 'seg seg-sm', role: 'group', 'aria-label': label },
      opts.map(([v, l, cls]) => h('button', { class: 'seg-btn ' + (cls || '') + (val === v ? ' active' : ''), onclick: () => onPick(v) }, l)));
  const render = () => {
    box.replaceChildren(...ACTION_CATS.map(([cat, catLabel]) => {
      const list = lib.actions.filter((a) => a.cat === cat);
      return h('div', { class: 'act-cat' },
        h('h3', {}, catLabel),
        ...list.map((a) => {
          const name = h('input', { class: 'input', value: a.label, 'aria-label': 'Name der Aktion' });
          name.addEventListener('change', () => updateAction(a.id, { label: name.value.trim() || a.label }));
          const sw = h('button', { class: 'switch' + (a.active ? ' on' : ''), role: 'switch', 'aria-checked': String(a.active), 'aria-label': `${a.label} aktiv`, onclick: () => updateAction(a.id, { active: !a.active }) }, h('span'));
          return h('div', { class: 'act-row' + (a.active ? '' : ' off') },
            name,
            seg(a.sign, [[1, '+', 'pos'], [0, '○', 'neu'], [-1, '−', 'neg']], (v) => updateAction(a.id, { sign: v }), 'Wertung'),
            seg(a.pt, [[1, 'Pkt Wir'], [0, '–'], [-1, 'Pkt Geg']], (v) => updateAction(a.id, { pt: v }), 'Spielstand'),
            sw,
            a.builtin ? h('span', { class: 'act-sp' }) : h('button', { class: 'btn danger-ic', 'aria-label': `${a.label} löschen`, html: '✕', onclick: async () => { if (await confirmDlg('Aktion löschen?', `„${a.label}“ wird entfernt. Bereits erfasste Einträge bleiben gespeichert, werden aber nicht mehr angezeigt.`, { okLabel: 'Löschen', danger: true })) deleteAction(a.id); } }));
        }),
        h('button', { class: 'btn text act-add', onclick: () => addAction({ cat, label: 'Neue Aktion', sign: 1, pt: 0 }) }, `+ Aktion (${catLabel})`));
    }));
  };
  render();
  const m = modal({
    title: 'Statistik-Aktionen',
    wide: true,
    body: h('div', {},
      h('p', { class: 'muted small' }, 'Wertung: + positiv, ○ neutral, − negativ (für Quoten, Noten und Hall of Fame). Spielstand: zählt bei der Live-Erfassung automatisch einen Punkt für uns oder den Gegner. Deaktivierte Aktionen verschwinden aus der Erfassung, alte Einträge bleiben erhalten.'),
      box),
    actions: [
      { label: 'Standard wiederherstellen', danger: true, onClick: async () => { if (await confirmDlg('Standard wiederherstellen?', 'Namen und Einstellungen der Standard-Aktionen werden zurückgesetzt. Eigene Aktionen bleiben.', { okLabel: 'Zurücksetzen', danger: true })) resetActions(); return false; } },
      { label: 'Fertig', primary: true },
    ],
  });
  on('library', () => document.body.contains(m.box) && render());
}

/** Netzhöhen der Voreinstellungen (Herren, Damen, Mixed, Jugend) */
export function openNetHeights() {
  const vals = { ...netHeights() };
  const rows = NET_PRESETS.filter(([k]) => k !== 'manuell').map(([k, l]) => {
    const i = h('input', { class: 'input', type: 'text', inputmode: 'decimal', value: String(vals[k]).replace('.', ','), 'aria-label': `Netzhöhe ${l}`, style: { width: '100px' } });
    i.onchange = () => {
      const v = parseFloat(i.value.replace(',', '.'));
      if (v > 0.5 && v < 4) vals[k] = Math.round(v * 100) / 100;
      i.value = String(vals[k]).replace('.', ',');
    };
    return h('div', { class: 'set-row' }, h('b', {}, l), h('label', { class: 'nb-man' }, i, 'm'));
  });
  modal({
    title: 'Netzhöhen',
    body: h('div', { class: 'form' }, ...rows,
      h('p', { class: 'muted small' }, 'Vorbelegt nach CVJM-Indiaca-Regeln (seit 11/2018) bzw. IIA: Herren 2,35 · Damen 2,20 · Mixed 2,30 · Jugend 2,25 m (männl. B-Jugend; weibl. Jugend 2,15 m). Gilt für alle Netzansichten mit dieser Voreinstellung.')),
    actions: [
      { label: 'Standard', onClick: () => { lib.netHeights = null; libChanged(); emit('page'); } },
      { label: 'Speichern', primary: true, onClick: () => { lib.netHeights = { ...vals }; libChanged(); emit('page'); } },
    ],
  });
}
