import { h, uid, clone } from './util.js';
import { I } from './icons.js';
import { FIELDS, newPage, ensureAnim } from './model.js';
import { state, on, emit, board, page, commit, touch, pageOrientation } from './store.js';
import { renderOne } from './render.js';
import * as stage from './stage.js';
import { menu } from './ui/dialogs.js';

/*
 * Animationsseiten (kind = 'anim').
 * Bearbeiten: Die Spieler des aktuellen Schritts liegen als normale Spieler in page.elements – dadurch
 * funktionieren Verschieben, Größe, Farbe, Mülleimer usw. unverändert. Jede Änderung wird sofort in
 * page.anim.steps[cur] übernommen (capture).
 * Wiedergabe: page.elements bleibt unangetastet; die Bühne zeigt per Override interpolierte Positionen.
 */

const HOLD = 0.45; // kurze Pause auf jedem Schritt (Sekunden)
const SPEEDS = [0.5, 1, 2];
const DURS = [0.5, 1, 1.5, 2, 3];
const play = { on: false, t: 0, speed: 1, loop: false, trails: false, raf: 0, last: 0, shown: 0 };

export const isAnim = (p = page()) => p?.kind === 'anim';
const playersOf = (p) => p.elements.filter((e) => e.type === 'player');

// ---------- Schritte ↔ Elemente ----------
/** Aktuelle Spieler in den aktuellen Schritt übernehmen */
export function capture(p = page()) {
  if (!isAnim(p)) return;
  ensureAnim(p);
  const a = p.anim;
  const st = a.steps[a.cur];
  st.pos = {};
  for (const e of playersOf(p)) {
    st.pos[e.id] = [e.x, e.y];
    a.actors[e.id] = { team: e.team, color: e.color, size: e.size || 1, label: e.label || '', number: e.number || '' };
  }
  // Actors, die in keinem Schritt mehr vorkommen, entfernen
  for (const id of Object.keys(a.actors)) if (!a.steps.some((s) => s.pos[id])) delete a.actors[id];
}
/** Schritt i auf das Feld laden */
function load(p, i) {
  const a = p.anim;
  a.cur = Math.max(0, Math.min(i, a.steps.length - 1));
  const st = a.steps[a.cur];
  const players = Object.entries(st.pos)
    .filter(([id]) => a.actors[id])
    .map(([id, [x, y]]) => ({ id, type: 'player', ...a.actors[id], x, y }));
  p.elements = p.elements.filter((e) => e.type !== 'player').concat(players);
}
function refresh() {
  state.selectionId = null;
  touch();
  emit('elements');
  emit('anim');
  emit('ui');
}

export function goTo(i) {
  stop(false);
  const p = page();
  capture(p);
  load(p, i);
  refresh();
}
function stepOp(fn) {
  stop(false);
  commit((p) => {
    capture(p);
    fn(p, p.anim);
  });
  refresh();
}
export const addStep = () =>
  stepOp((p, a) => {
    a.steps.splice(a.cur + 1, 0, { id: uid(), note: '', dur: 1, pos: clone(a.steps[a.cur].pos) });
    load(p, a.cur + 1);
  });
const dupStep = (i) =>
  stepOp((p, a) => {
    a.steps.splice(i + 1, 0, { ...clone(a.steps[i]), id: uid() });
    load(p, i + 1);
  });
const insertBefore = (i) =>
  stepOp((p, a) => {
    a.steps.splice(i, 0, { id: uid(), note: '', dur: 1, pos: clone(a.steps[i].pos) });
    load(p, i);
  });
const delStep = (i) =>
  stepOp((p, a) => {
    if (a.steps.length < 2) return;
    a.steps.splice(i, 1);
    load(p, Math.min(i, a.steps.length - 1));
  });
const moveStep = (i, d) =>
  stepOp((p, a) => {
    const j = i + d;
    if (j < 0 || j >= a.steps.length) return;
    [a.steps[i], a.steps[j]] = [a.steps[j], a.steps[i]];
    load(p, j);
  });

/** Neue Animationsseite – Spieler der aktuellen Seite werden zu Schritt 1 */
export function makeAnimPage() {
  const src = page();
  const n = board().pages.filter((p) => p.kind === 'anim').length + 1;
  const p = newPage('anim', `Animation ${n}`);
  p.elements = playersOf(src).map((e) => ({ ...clone(e), id: uid() }));
  p.orientation = pageOrientation(src);
  if (src.half) p.half = true;
  ensureAnim(p);
  capture(p);
  return p;
}

// ---------- Wiedergabe ----------
const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
function timeline(a) {
  const segs = [];
  let t = 0;
  for (let i = 1; i < a.steps.length; i++) {
    segs.push({ from: i - 1, to: i, t0: t, dur: a.steps[i].dur });
    t += HOLD + a.steps[i].dur;
  }
  return { segs, total: t + HOLD };
}
function at(a, t) {
  const { segs } = timeline(a);
  for (const s of segs) {
    if (t < s.t0 + HOLD) return { from: s.from, to: s.from, u: 0 };
    if (t < s.t0 + HOLD + s.dur) return { from: s.from, to: s.to, u: (t - s.t0 - HOLD) / s.dur };
  }
  const last = a.steps.length - 1;
  return { from: last, to: last, u: 0 };
}
const startOf = (a, i) => (i <= 0 ? 0 : timeline(a).segs[i - 1].t0 + HOLD + a.steps[i].dur);

function frame() {
  const p = page();
  const a = p.anim;
  const { from, to, u } = at(a, play.t);
  const e = ease(u);
  const A = a.steps[from].pos, B = a.steps[to].pos;
  const ids = new Set([...Object.keys(A), ...Object.keys(B)]);
  const players = [];
  for (const id of ids) {
    const act = a.actors[id];
    if (!act) continue;
    const pa = A[id], pb = B[id];
    if (pa && pb) players.push({ id, type: 'player', ...act, x: pa[0] + (pb[0] - pa[0]) * e, y: pa[1] + (pb[1] - pa[1]) * e });
    else if (pa) players.push({ id, type: 'player', ...act, x: pa[0], y: pa[1], fade: 1 - e });
    else players.push({ id, type: 'player', ...act, x: pb[0], y: pb[1], fade: e });
  }
  play.shown = u >= 0.5 ? to : from;
  return { ...p, elements: p.elements.filter((x) => x.type !== 'player').concat(players) };
}

function tick(now) {
  if (!play.on) return;
  const a = page().anim;
  const { total } = timeline(a);
  play.t += ((now - play.last) / 1000) * play.speed;
  play.last = now;
  if (play.t >= total) {
    if (play.loop && a.steps.length > 1) play.t = 0;
    else {
      stop(true, a.steps.length - 1);
      return;
    }
  }
  const prevShown = play.shown;
  stage.redraw();
  if (play.shown !== prevShown) updateBar();
  updateNote();
  play.raf = requestAnimationFrame(tick);
}

export function start() {
  const p = page();
  if (!isAnim(p) || p.anim.steps.length < 2) return;
  capture(p);
  const a = p.anim;
  play.t = a.cur >= a.steps.length - 1 ? 0 : startOf(a, a.cur);
  play.on = true;
  play.last = performance.now();
  state.selectionId = null;
  stage.setFrameOverride(frame);
  emit('ui');
  updateBar();
  play.raf = requestAnimationFrame(tick);
}
/** Wiedergabe beenden; optional auf den zuletzt gezeigten (oder angegebenen) Schritt springen */
export function stop(jump = true, toStep = null) {
  if (!play.on) return;
  play.on = false;
  cancelAnimationFrame(play.raf);
  stage.setFrameOverride(null);
  updateNote();
  if (jump) {
    const p = page();
    load(p, toStep ?? play.shown);
    refresh();
  } else updateBar();
}

// ---------- Geister & Laufwege ----------
function ghosts(rot) {
  const p = page();
  if (!isAnim(p)) return '';
  const a = p.anim;
  const b = board();
  const s = FIELDS[b.fieldType].s;
  let out = '';
  if (play.trails) {
    for (const id of Object.keys(a.actors)) {
      const pts = a.steps.map((st) => st.pos[id]).filter(Boolean);
      if (pts.length < 2) continue;
      out += `<path class="trail" d="M${pts.map((q) => `${q[0]} ${q[1]}`).join('L')}" style="stroke:${a.actors[id].color};stroke-width:${0.06 * s}"/>`;
    }
  }
  if (play.on || a.cur === 0) return out;
  // Vorheriger Schritt als blasse Geister + Pfeil zur neuen Position
  const prev = a.steps[a.cur - 1].pos, cur = a.steps[a.cur].pos;
  for (const [id, q] of Object.entries(prev)) {
    const act = a.actors[id];
    if (!act) continue;
    out += renderOne({ id: 'g' + id, type: 'player', ...act, label: '', x: q[0], y: q[1], fade: 0.3 }, p, b, rot);
    const n = cur[id];
    if (n && Math.hypot(n[0] - q[0], n[1] - q[1]) > 0.2)
      out += renderOne({ id: 'ga' + id, type: 'arrow', x1: q[0], y1: q[1], x2: n[0], y2: n[1], color: act.color, width: 0.05 * s, dashed: true }, p, b, rot);
  }
  return out;
}

// ---------- Leiste ----------
let bar, chips, playBtn, speedBtn, loopBtn, trailsBtn, prevBtn, nextBtn, stepLbl, noteIn, durSel, noteBox, wrapEl;

export function initAnim(wrap) {
  wrapEl = wrap;
  stage.setGhostRenderer(ghosts);
  stage.setEditLock(() => play.on);

  const btn = (icon, label, fn, cls = '') => h('button', { class: 'btn ' + cls, html: icon, 'aria-label': label, title: label, onclick: fn });
  playBtn = btn(I.play, 'Abspielen', () => (play.on ? stop(true) : start()), 'play');
  const curStep = () => (play.on ? play.shown : page().anim.cur);
  prevBtn = btn(I.prev, 'Schritt zurück', () => goTo(curStep() - 1));
  nextBtn = btn(I.next, 'Schritt vor', () => goTo(curStep() + 1));
  speedBtn = h('button', { class: 'btn text small', title: 'Geschwindigkeit', onclick: () => { play.speed = SPEEDS[(SPEEDS.indexOf(play.speed) + 1) % SPEEDS.length]; updateBar(); } });
  loopBtn = btn(I.loop, 'Wiederholen (Loop)', () => { play.loop = !play.loop; updateBar(); });
  trailsBtn = btn(I.trail, 'Laufwege anzeigen', () => { play.trails = !play.trails; stage.redraw(); updateBar(); });
  chips = h('div', { class: 'step-chips' });
  const addBtn = h('button', { class: 'btn text add-step', onclick: addStep }, '+ Schritt');

  stepLbl = h('span', { class: 'step-lbl' });
  noteIn = h('input', { class: 'input sm note-in', placeholder: 'Notiz zum Schritt (z. B. Annahme auf Pos. 3)', enterkeyhint: 'done' });
  noteIn.addEventListener('input', () => { page().anim.steps[page().anim.cur].note = noteIn.value; touch(); });
  noteIn.addEventListener('keydown', (e) => e.key === 'Enter' && noteIn.blur());
  durSel = h('select', { class: 'input sm select', 'aria-label': 'Dauer der Bewegung' },
    DURS.map((d) => h('option', { value: d }, `${String(d).replace('.', ',')} s`)));
  durSel.onchange = () => { page().anim.steps[page().anim.cur].dur = +durSel.value; touch(); };

  bar = h('div', { id: 'animbar' },
    h('div', { class: 'anim-row' }, playBtn, prevBtn, nextBtn, speedBtn, loopBtn, trailsBtn, h('div', { class: 'sep' }), chips, addBtn),
    h('div', { class: 'anim-row edit' }, stepLbl, noteIn, h('span', { class: 'sel-lbl' }, 'Dauer'), durSel));
  noteBox = h('div', { id: 'anim-note' });
  wrap.append(bar, noteBox);

  // Jede Änderung am Feld sofort in den aktuellen Schritt übernehmen
  on('elements', () => { if (isAnim() && !play.on) capture(); });
  on('page', () => { if (play.on) stop(false); });
  on(['page', 'board', 'anim'], updateBar);
}

function chipMenu(anchor, i) {
  const n = page().anim.steps.length;
  menu(anchor, [
    { label: 'Duplizieren', icon: I.copy, onClick: () => dupStep(i) },
    { label: 'Davor einfügen', icon: I.plus, onClick: () => insertBefore(i) },
    { label: 'Nach links', icon: I.left, disabled: i === 0, onClick: () => moveStep(i, -1) },
    { label: 'Nach rechts', icon: I.right, disabled: i === n - 1, onClick: () => moveStep(i, 1) },
    { label: 'Löschen', icon: I.trash, danger: true, disabled: n < 2, onClick: () => delStep(i) },
  ]);
}

function updateBar() {
  if (!bar) return;
  const p = page();
  const anim = isAnim(p);
  wrapEl.classList.toggle('anim', anim);
  if (!anim) return;
  const a = p.anim;
  const active = play.on ? play.shown : a.cur;
  chips.replaceChildren(
    ...a.steps.map((st, i) => {
      const c = h('button', { class: 'step-chip' + (i === active ? ' active' : '') + (st.note ? ' has-note' : ''), title: st.note || `Schritt ${i + 1}` }, String(i + 1));
      c.onclick = () => (i === a.cur && !play.on ? chipMenu(c, i) : goTo(i));
      return c;
    })
  );
  chips.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  playBtn.innerHTML = play.on ? I.pause : I.play;
  playBtn.setAttribute('aria-label', play.on ? 'Pause' : 'Abspielen');
  playBtn.disabled = a.steps.length < 2;
  prevBtn.disabled = play.on ? false : a.cur === 0;
  nextBtn.disabled = play.on ? false : a.cur >= a.steps.length - 1;
  speedBtn.textContent = `${String(play.speed).replace('.', ',')}×`;
  loopBtn.classList.toggle('active', play.loop);
  trailsBtn.classList.toggle('active', play.trails);
  bar.classList.toggle('playing', play.on);
  const st = a.steps[a.cur];
  stepLbl.textContent = `Schritt ${a.cur + 1}`;
  if (document.activeElement !== noteIn) noteIn.value = st.note;
  durSel.value = String(st.dur);
  durSel.disabled = a.cur === 0;
  durSel.title = a.cur === 0 ? 'Schritt 1 ist die Startaufstellung' : 'Dauer der Bewegung zu diesem Schritt';
}

function updateNote() {
  const p = page();
  const note = play.on && isAnim(p) ? p.anim.steps[play.shown]?.note : '';
  noteBox.textContent = note ? `${play.shown + 1}. ${note}` : '';
  noteBox.classList.toggle('show', !!note);
}

// ---------- Beispielvorlagen ----------
function example(name, steps) {
  const b = board();
  const actors = {};
  for (const st of steps) for (const id of Object.keys(st.pos)) {
    const team = id[0] === 'o' ? 'opp' : 'own';
    actors[id] = { team, color: b.teams[team].color, size: 1, label: '', number: '' };
  }
  const pg = { id: uid(), kind: 'anim', name, notes: '', elements: [], anim: { actors, steps: steps.map((s) => ({ id: uid(), dur: 1, ...s })), cur: 0 } };
  load(pg, 0);
  return { id: 'ex-' + name, name, builtin: true, fieldType: b.fieldType, page: pg };
}
const OPP = { o1: [5.5, -2], o2: [6, 0], o3: [5.5, 2], o4: [2, -1.4], o5: [2, 1.4] };
export function exampleTemplates() {
  return [
    example('K1: Annahme → Aufbau → Angriff', [
      { note: 'Annahme: drei hinten, Steller vorne', pos: { a1: [-6, -2], a2: [-6.4, 0], a3: [-6, 2], a4: [-3.2, -1.3], a5: [-1.5, 1.8], ...OPP } },
      { note: 'Pass zum Steller, Angreifer läuft an', dur: 1.2, pos: { a1: [-5.6, -2.2], a2: [-5.2, 0.2], a3: [-5.6, 2.2], a4: [-2.6, -2], a5: [-0.9, 0.4], ...OPP } },
      { note: 'Angriff über links, Rest sichert ab', pos: { a1: [-4.2, -2], a2: [-4.6, 0.2], a3: [-4.2, 2], a4: [-0.7, -1.8], a5: [-1.6, 0.6], ...OPP } },
    ]),
    example('K2: Grundstellung → Block/Abwehr', [
      { note: 'Grundstellung', pos: { a1: [-5.5, -2], a2: [-6.2, 0], a3: [-5.5, 2], a4: [-1.4, -1.4], a5: [-1.4, 1.4], o1: [5.5, -2], o2: [6, 0], o3: [5.5, 2], o4: [1.8, -1.5], o5: [1.2, 1.2] } },
      { note: 'Gegner stellt nach außen, Block orientiert sich', pos: { a1: [-5.2, -2.2], a2: [-6, -0.2], a3: [-5, 1.8], a4: [-0.9, -1.6], a5: [-1, 0.2], o1: [5.2, -2], o2: [5.8, 0], o3: [5.2, 2], o4: [1, -2], o5: [0.8, 0] } },
      { note: 'Doppelblock links, Abwehr dahinter', pos: { a1: [-4.6, -2.4], a2: [-5.6, -0.4], a3: [-3.8, 1.2], a4: [-0.4, -2.2], a5: [-0.4, -1.2], o1: [5.2, -2], o2: [5.8, 0], o3: [5.2, 2], o4: [0.6, -2], o5: [0.8, 0] } },
    ]),
    example('Angabe → Annahme', [
      { note: 'Gegner schlägt auf', pos: { a1: [-6, -2], a2: [-6.4, 0], a3: [-6, 2], a4: [-2.5, -1.5], a5: [-2.5, 1.5], o1: [7.6, 1.5], o2: [5, 0], o3: [4.5, 2], o4: [1.6, -1.4], o5: [1.6, 1.4] } },
      { note: 'Annahme rechts hinten, Steller löst sich', pos: { a1: [-5.4, -1.6], a2: [-6.2, 0.6], a3: [-6.8, 2.3], a4: [-2.8, -1.8], a5: [-1, 0.8], o1: [6, 1.5], o2: [5, 0], o3: [4.5, 2], o4: [1.6, -1.4], o5: [1.6, 1.4] } },
    ]),
  ];
}
