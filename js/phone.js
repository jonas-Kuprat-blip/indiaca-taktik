import { h } from './util.js';
import { I } from './icons.js';
import { state, on, emit, setTool, undo, canUndo } from './store.js';
import { ui } from './render.js';

/*
 * Handy-Layout (Querformat, Höhe < 500 px) – reine Zusatzschicht.
 * Die vorhandenen Bedienelemente (Werkzeuge, Paletten, Seitenleiste, Menü-Buttons) werden in
 * einfahrende Panels an einer schmalen Icon-Leiste rechts umgehängt. Beim Verlassen des Handy-Layouts
 * kommt jedes Element wieder an seine ursprüngliche Stelle – iPad/Desktop bleiben unverändert.
 */
const MQ = '(orientation: landscape) and (max-height: 499px)';
const DRAW_TOOLS = ['pen', 'arrow', 'eraser'];
let active = false;
let rail, panelBox, modeBtn, undoBtn;
const panels = {};
const railBtns = {};
let openName = null;
let moved = []; // [Platzhalter, Element]
let lastDraw = 'pen';

export function initPhone() {
  // Hochformat-Hinweis (wird per CSS nur auf dem Handy im Hochformat gezeigt)
  document.body.append(
    h('div', { id: 'rotate-hint' },
      h('div', { class: 'rh-ic', html: I.phoneRotate }),
      h('div', { class: 'rh-t' }, 'Bitte Gerät drehen'),
      h('div', { class: 'rh-s' }, 'Das Taktikboard ist fürs Querformat gemacht.'))
  );
  build();
  const mq = matchMedia(MQ);
  const apply = () => (mq.matches ? enter() : leave());
  mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply);
  apply();
  on(['ui', 'elements', 'page'], sync);
}

function build() {
  const railBtn = (name, icon, label, fn) => {
    const b = h('button', { class: 'ph-btn', 'aria-label': label, title: label, onclick: fn },
      h('span', { class: 'ph-ic', html: icon }), h('span', { class: 'ph-lbl' }, label));
    railBtns[name] = b;
    return b;
  };
  // Verschieben/Zeichnen: ohne Pencil entscheidet der Modus, was der Finger tut
  modeBtn = railBtn('mode', I.select, 'Verschieben', () => {
    if (DRAW_TOOLS.includes(state.tool)) setTool('select');
    else setTool(lastDraw);
  });
  undoBtn = railBtn('undo', I.undo, 'Zurück', undo);
  rail = h('nav', { id: 'phonebar', 'aria-label': 'Werkzeuge' },
    modeBtn,
    railBtn('stift', I.pen, 'Stift', () => toggle('stift')),
    railBtn('formen', I.rect, 'Formen', () => toggle('formen')),
    railBtn('spieler', I.person, 'Spieler', () => toggle('spieler')),
    railBtn('seiten', I.pages, 'Seiten', () => toggle('seiten')),
    undoBtn,
    railBtn('mehr', I.more, 'Mehr', () => toggle('mehr')));

  const panel = (name, title) => {
    const body = h('div', { class: 'ph-body' });
    const p = h('section', { class: 'ph-panel', 'data-name': name },
      h('header', {}, h('b', {}, title), h('button', { class: 'btn', 'aria-label': 'Schließen', html: I.close, onclick: close })), body);
    panels[name] = body;
    return p;
  };
  panelBox = h('div', { id: 'ph-panels' },
    panel('stift', 'Zeichnen'), panel('formen', 'Formen & Ziele'), panel('spieler', 'Spieler'), panel('seiten', 'Seiten'), panel('mehr', 'Mehr'));
  document.body.append(rail, panelBox);

  // Formen/Werkzeug gewählt → Panel schließen, damit das Feld frei ist
  panelBox.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.closest('[data-name="formen"]') && b.classList.contains('pal-btn')) setTimeout(close, 120);
    if (b.closest('[data-name="stift"]') && b.dataset.tool) setTimeout(close, 120);
    if (b.closest('[data-name="mehr"]') && !b.classList.contains('board-name')) setTimeout(close, 120);
  });
  // Antippen des Feldes schließt ein offenes Panel
  document.getElementById('stage-wrap').addEventListener('pointerdown', (e) => {
    if (active && openName && e.target.closest('#stage')) close();
  }, true);
}

function toggle(name) {
  if (openName === name) return close();
  openName = name;
  panelBox.classList.add('open');
  panelBox.querySelectorAll('.ph-panel').forEach((p) => p.classList.toggle('active', p.dataset.name === name));
  Object.entries(railBtns).forEach(([n, b]) => b.classList.toggle('open', n === name));
  if (name === 'seiten') panels.seiten.querySelector('.thumb.active')?.scrollIntoView({ block: 'nearest' });
}
function close() {
  openName = null;
  panelBox.classList.remove('open');
  Object.values(railBtns).forEach((b) => b.classList.remove('open'));
}

function move(node, target) {
  if (!node) return;
  const marker = document.createComment('ph');
  node.before(marker);
  target.append(node);
  moved.push([marker, node]);
}

function enter() {
  if (active) return;
  active = true;
  document.documentElement.classList.add('phone');
  ui.tokenScale = 1.3; // Spieler/Marker relativ zum Feld etwas größer

  const tb = document.getElementById('toolbar');
  const groups = tb.querySelectorAll(':scope > .group');
  const byLabel = (l) => tb.querySelector(`button[aria-label^="${l}"]`);
  const pal = document.querySelectorAll('#palette > .pal-sec');

  move(groups[0], panels.stift); // Auswahl, Stift, Pfeil, Radierer
  move(groups[1], panels.stift); // Farben
  move(groups[2], panels.stift); // Strichstärke / gestrichelt
  move(pal[1], panels.formen); // Ziel / Position (Punkt, Kreuz, Indiaca)
  move(pal[2], panels.formen); // Zonen
  move(pal[0], panels.spieler); // Spieler
  move(document.getElementById('pagebar'), panels.seiten);
  for (const l of ['Boards verwalten', 'Board umbenennen', 'Wiederholen', 'Feld kippen', 'Notizen', 'Statistik', 'Spieler', 'Mannschaften', 'Einstellungen', 'Nur Stift', 'Theme']) move(l === 'Board umbenennen' ? tb.querySelector('.board-name') : byLabel(l), panels.mehr);
  sync();
  emit('board');
  emit('page');
  emit('elements');
  emit('ui');
}

function leave() {
  if (!active) return;
  active = false;
  close();
  for (const [marker, node] of moved.reverse()) marker.replaceWith(node);
  moved = [];
  document.documentElement.classList.remove('phone');
  ui.tokenScale = 1;
  emit('board');
  emit('page');
  emit('elements');
  emit('ui');
}

function sync() {
  if (!modeBtn) return;
  const drawing = DRAW_TOOLS.includes(state.tool);
  if (drawing) lastDraw = state.tool;
  modeBtn.querySelector('.ph-ic').innerHTML = drawing ? I.pen : I.select;
  modeBtn.querySelector('.ph-lbl').textContent = drawing ? 'Zeichnen' : 'Verschieben';
  modeBtn.classList.toggle('drawing', drawing);
  undoBtn.disabled = !canUndo();
}
