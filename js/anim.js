import { h, uid, clone } from './util.js';
import { I } from './icons.js';
import { FIELDS, newPage, ensureAnim, ANIM_TYPES } from './model.js';
import { isNet, netCfg } from './net.js';
import { posToModel, roleOfPos, DEFAULT_POSITIONS } from './library.js';
import { state, on, emit, board, page, commit, touch, pageOrientation } from './store.js';
import { renderOne } from './render.js';
import * as stage from './stage.js';
import { menu } from './ui/dialogs.js';

/*
 * Animationsseiten (kind = 'anim').
 * Bearbeiten: Die Elemente des aktuellen Schritts liegen als normale Elemente in page.elements – dadurch
 * funktionieren Verschieben, Größe, Drehen, Farbe, Mülleimer usw. unverändert. Jede Änderung wird sofort
 * in page.anim.steps[cur].els übernommen (capture).
 * Wiedergabe: page.elements bleibt unangetastet; die Bühne zeigt per Override interpolierte Elemente
 * (Position, Größe, Form, Deckkraft).
 */

const HOLD = 0.45; // kurze Pause auf jedem Schritt (Sekunden)
const SPEEDS = [0.1, 0.25, 0.5, 1];
const DURS = [0.5, 1, 1.5, 2, 3];
const play = { on: false, t: 0, speed: 0.5, loop: false, trails: false, raf: 0, last: 0, shown: 0 };

export const isAnim = (p = page()) => p?.kind === 'anim';
const animEls = (p) => p.elements.filter((e) => ANIM_TYPES.includes(e.type));
const isStatic = (e) => !ANIM_TYPES.includes(e.type);

// ---------- Schritte ↔ Elemente ----------
/** Aktuelle Elemente in den aktuellen Schritt übernehmen */
export function capture(p = page()) {
  if (!isAnim(p)) return;
  ensureAnim(p);
  const st = p.anim.steps[p.anim.cur];
  const old = st.els || {};
  st.els = {};
  for (const e of animEls(p)) {
    st.els[e.id] = clone(e);
    // Spielername gilt für alle Schritte: geänderten Namen überall übernehmen
    if (e.type === 'player' && (old[e.id]?.label || '') !== (e.label || ''))
      for (const other of p.anim.steps) if (other.els[e.id]) other.els[e.id].label = e.label || '';
    // Rolle (Angreifer/Zuspieler) gilt ebenfalls für alle Schritte
    if (e.type === 'player' && old[e.id] && (old[e.id].role || 'angriff') !== (e.role || 'angriff'))
      for (const other of p.anim.steps) if (other.els[e.id]) other.els[e.id].role = e.role;
  }
}
/** Fehlende Spielernamen aus anderen Schritten ergänzen (z. B. in Schritt 1 benannt, Schritt 3 noch ohne Namen) */
function fillNames(a) {
  const names = {};
  for (const st of a.steps) for (const [id, e] of Object.entries(st.els)) if (e.type === 'player' && e.label && !names[id]) names[id] = e.label;
  for (const st of a.steps) for (const [id, e] of Object.entries(st.els)) if (e.type === 'player' && !e.label && names[id]) e.label = names[id];
}
/** Schritt i auf das Feld laden */
function load(p, i) {
  const a = p.anim;
  a.cur = Math.max(0, Math.min(i, a.steps.length - 1));
  fillNames(a);
  p.elements = p.elements.filter(isStatic).concat(Object.values(a.steps[a.cur].els).map(clone));
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
    a.steps.splice(a.cur + 1, 0, { id: uid(), note: '', dur: 1, els: clone(a.steps[a.cur].els) });
    load(p, a.cur + 1);
  });
const dupStep = (i) =>
  stepOp((p, a) => {
    a.steps.splice(i + 1, 0, { ...clone(a.steps[i]), id: uid() });
    load(p, i + 1);
  });
const insertBefore = (i) =>
  stepOp((p, a) => {
    a.steps.splice(i, 0, { id: uid(), note: '', dur: 1, els: clone(a.steps[i].els) });
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

/** Netz-Animation: Netzansicht mit Schritten (Marker, Linien und Silhouetten werden interpoliert) */
export function makeNetAnimPage(sils = []) {
  const src = page();
  const n = board().pages.filter((p) => p.kind === 'anim' && p.net).length + 1;
  const p = newPage('anim', `Netz-Animation ${n}`);
  if (isNet(src)) {
    // aus einer Netzansicht: Marker, Silhouetten, Linien übernehmen (IDs neu, Linien umhängen)
    const map = {};
    const els = src.elements.filter((e) => ['marker', 'sil', 'link'].includes(e.type));
    for (const e of els) map[e.id] = e.type === 'sil' && e.rosterId ? e.id : uid();
    p.elements = els.map((e) => ({ ...clone(e), id: map[e.id], ...(e.type === 'link' ? { a: map[e.a], b: map[e.b] } : {}) }));
    p.net = clone(netCfg(src));
  } else {
    p.elements = clone(sils);
    p.net = {};
    netCfg(p);
  }
  ensureAnim(p);
  capture(p);
  return p;
}

/** Neue Animationsseite – Spieler und Marker (z. B. Indiaca) der aktuellen Seite werden zu Schritt 1 */
export function makeAnimPage() {
  const src = page();
  if (isNet(src)) return makeNetAnimPage();
  const n = board().pages.filter((p) => p.kind === 'anim').length + 1;
  const p = newPage('anim', `Animation ${n}`);
  p.elements = src.elements.filter((e) => e.type === 'player' || e.type === 'marker').map((e) => ({ ...clone(e), id: uid() }));
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

/** Zwischenstand zweier Elemente (Position, Größe, Form, Deckkraft); Farbe/Symbol wechseln zur Hälfte */
const NUM = ['x', 'y', 'r', 'opacity', 'x1', 'y1', 'x2', 'y2', 'width', 'sprung', 'groesse', 'd'];
function lerpEl(A, B, u) {
  const o = { ...(u < 0.5 ? A : B) };
  const L = (p, q) => p + (q - p) * u;
  for (const k of NUM) if (typeof A[k] === 'number' && typeof B[k] === 'number') o[k] = L(A[k], B[k]);
  if (A.type === 'player' || A.type === 'marker') o.size = L(A.size || 1, B.size || 1);
  // Netzansicht: Tiefe (fehlt sie in einem Schritt, gilt der Standard: Marker im Netz, Silhouetten knapp davor/dahinter)
  if (A.type === 'marker' || A.type === 'sil') {
    const dd = (e) => (typeof e.d === 'number' ? e.d : e.type === 'sil' ? (e.team === 'opp' ? 0.9 : -0.6) : 0);
    if (typeof A.d === 'number' || typeof B.d === 'number') o.d = L(dd(A), dd(B));
  }
  if (A.type === 'player') {
    // kürzester Drehweg
    const ra = A.rot || 0, d = ((((B.rot || 0) - ra + 180) % 360) + 360) % 360 - 180;
    o.rot = ra + d * u;
  }
  if (A.points && B.points && A.points.length === B.points.length) o.points = A.points.map((p, i) => [L(p[0], B.points[i][0]), L(p[1], B.points[i][1])]);
  if (A.from && B.from) o.from = { x: L(A.from.x, B.from.x), y: L(A.from.y, B.from.y) };
  return o;
}

function frame() {
  const p = page();
  const a = p.anim;
  const { from, to, u } = at(a, play.t);
  const e = ease(u);
  const A = a.steps[from].els, B = a.steps[to].els;
  const ids = [...new Set([...Object.keys(A), ...Object.keys(B)])];
  const els = ids.map((id) => {
    const ea = A[id], eb = B[id];
    if (ea && eb) return lerpEl(ea, eb, e);
    if (ea) return { ...ea, fade: 1 - e };
    return { ...eb, fade: e };
  });
  play.shown = u >= 0.5 ? to : from;
  return { ...p, elements: p.elements.filter(isStatic).concat(els) };
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
const MOVERS = ['player', 'marker'];
function ghosts(rot) {
  const p = page();
  if (!isAnim(p)) return '';
  const a = p.anim;
  const b = board();
  const s = FIELDS[b.fieldType].s;
  let out = '';
  if (play.trails) {
    const ids = new Set(a.steps.flatMap((st) => Object.keys(st.els)));
    for (const id of ids) {
      const pts = a.steps.map((st) => st.els[id]).filter((e) => e && MOVERS.includes(e.type));
      if (pts.length < 2) continue;
      const col = pts[0].type === 'marker' && pts[0].symbol === 'indiaca' ? '#dc2626' : pts[0].color === 'ink' ? '#111827' : pts[0].color;
      out += `<path class="trail" d="M${pts.map((q) => `${q.x} ${q.y}`).join('L')}" style="stroke:${col};stroke-width:${0.06 * s}"/>`;
    }
  }
  if (play.on || a.cur === 0) return out;
  // Vorheriger Schritt als blasse Geister + Pfeil zur neuen Position (Spieler und Marker)
  const prev = a.steps[a.cur - 1].els, cur = a.steps[a.cur].els;
  for (const [id, q] of Object.entries(prev)) {
    if (!MOVERS.includes(q.type)) continue;
    out += `<g style="opacity:.3">${renderOne({ ...q, id: 'g' + id, label: '', from: undefined }, p, b, rot)}</g>`;
    const n = cur[id];
    if (n && Math.hypot(n.x - q.x, n.y - q.y) > 0.2) {
      const col = q.type === 'marker' && q.symbol === 'indiaca' ? '#dc2626' : q.color;
      out += renderOne({ id: 'ga' + id, type: 'arrow', x1: q.x, y1: q.y, x2: n.x, y2: n.y, color: col, width: 0.05 * s, dashed: true }, p, b, rot);
    }
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
  speedBtn.title = 'Tempo (0,1× langsam … 1× schnell)';
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
  const mk = (id, [x, y]) => {
    if (id === 'ball') return { id, type: 'marker', symbol: 'indiaca', color: '#dc2626', label: '', size: 1, x, y };
    const team = id[0] === 'o' ? 'opp' : 'own';
    const pos = +id.slice(1);
    return { id, type: 'player', team, color: b.teams[team].color, size: 1, label: '', number: '', pos, rolle: pos, role: roleOfPos(pos), x, y };
  };
  const pg = {
    id: uid(), kind: 'anim', name, notes: '', elements: [],
    anim: { cur: 0, steps: steps.map((s) => ({ id: uid(), dur: 1, note: s.note, ...(s.dur ? { dur: s.dur } : {}), els: Object.fromEntries(Object.entries(s.pos).map(([id, xy]) => [id, mk(id, xy)])) })) },
  };
  load(pg, 0);
  // Beispiele sind für „eigenes Team links“ definiert
  return { id: 'ex-' + name, name, builtin: true, fieldType: 'indiaca', ownSide: 'left', page: pg };
}

/*
 * Grundaufstellung nach Positionssystem (Standardpunkte, Indiaca-Feld, eigenes Team links):
 *   p1 Außenangreifer hinten rechts · p2 1. Zuspieler vorne rechts am Netz · p3 Hauptangreifer Mitte (3-m-Linie)
 *   p4 2. Zuspieler links (3-m-Linie) · p5 2. Mitte hinten links
 * Gegner o1–o5 gespiegelt (aus seiner Sicht dieselbe Aufstellung).
 * Figuren tragen ihre Position → beim Laden in ein Board mit Mannschaft wird die Standard-Aufstellung eingesetzt.
 */
const xy = (n, side) => { const q = posToModel(n, side, 'indiaca', DEFAULT_POSITIONS); return [Math.round(q.x * 100) / 100, Math.round(q.y * 100) / 100]; };
const OWN = Object.fromEntries([1, 2, 3, 4, 5].map((n) => ['p' + n, xy(n, 'left')]));
const OPP = Object.fromEntries([1, 2, 3, 4, 5].map((n) => ['o' + n, xy(n, 'right')]));
const withOpp = (own, opp = {}) => ({ ...OPP, ...opp, ...own });

// ---------- Beispiele in der Netzansicht (3D) ----------
/*
 * Sicht eines eigenen Spielers an der 3-m-Linie aufs Netz: x = Meter ab linker Seitenlinie, y = −Höhe.
 * Silhouetten: eigene vor dem Netz, Gegner (Block) dahinter. Ball = Indiaca-Marker.
 */
function netExample(name, steps) {
  const pg = {
    id: uid(), kind: 'anim', name, notes: '', elements: [], net: { preset: 'herren', view: '3d' },
    anim: { cur: 0, steps: steps.map((st) => ({ id: uid(), dur: st.dur || 1, note: st.note, els: Object.fromEntries(st.els.map((e) => [e.id, clone(e)])) })) },
  };
  netCfg(pg);
  load(pg, 0);
  return { id: 'ex-' + name, name, builtin: true, fieldType: 'indiaca', ownSide: 'left', page: pg };
}
const SIL = (id, x, sprung, extra) => ({ id, type: 'sil', y: 0, x, sprung, groesse: 1.85, team: 'own', color: '#2563eb', label: '', ...extra });
const ZU = (x, sprung = 0) => SIL('n_zu', x, sprung, { label: '1. Zuspieler', short: 'Z', groesse: 1.8 });
const BL = (id, x, sprung = 0) => SIL(id, x, sprung, { team: 'opp', color: '#dc2626', label: 'Block', short: 'B' });
const BALL = (x, h, d = 0) => ({ id: 'n_ball', type: 'marker', symbol: 'indiaca', color: '#dc2626', label: '', size: 1, x, y: -h, d });
const TP = (x, h, d = -0.3) => ({ id: 'n_tp', type: 'marker', symbol: 'x', color: '#ef4444', label: 'Treffpunkt', size: 1, x, y: -h, d });
const UEB = (x, h) => ({ id: 'n_ueb', type: 'marker', symbol: 'ring', color: '#3b82f6', label: 'über die Netzkante', size: 1, x, y: -h, d: 0 });
const LAND = (x, d) => ({ id: 'n_land', type: 'marker', symbol: 'dot', color: '#f59e0b', label: 'Aufprall', size: 1, x, y: -0.05, d });
const FLUG2 = { id: 'n_flug2', type: 'link', a: 'n_ueb', b: 'n_land', color: '#ef4444', dashed: true };
const FLUG = { id: 'n_flug', type: 'link', a: 'n_tp', b: 'n_ueb', color: '#ef4444', dashed: true };

function netExamples() {
  const AA = (x, sprung = 0) => SIL('n_aa', x, sprung, { label: 'Außenangreifer', short: 'AA' });
  const HA = (x, sprung = 0) => SIL('n_ha', x, sprung, { label: 'Hauptangreifer', short: 'HA', groesse: 1.9 });
  return [
    netExample('3D: Außenangriff', [
      { note: '1. Zuspieler nimmt die Indiaca – Außenangreifer startet links', els: [ZU(4.7), AA(1.5), BL('n_b1', 3.8), BL('n_b2', 2.7), BALL(4.6, 2.3, -0.5)] },
      { note: 'Hohes Zuspiel nach außen – der Block verschiebt mit', dur: 1.2, els: [ZU(4.7, 0.15), AA(1.15), BL('n_b1', 2.5), BL('n_b2', 1.7), BALL(2.8, 3.6, -0.6)] },
      { note: 'Absprung – Treffpunkt hoch über der Netzkante', els: [ZU(4.6), AA(1.0, 0.6), BL('n_b1', 2.3, 0.45), BL('n_b2', 1.55, 0.5), BALL(1.19, 3.06, -0.3), TP(1.19, 3.06)] },
      { note: 'Schlag an der Linie entlang – am Block vorbei über die Netzkante', dur: 0.6, els: [ZU(4.6), AA(1.0, 0.1), BL('n_b1', 2.3, 0.2), BL('n_b2', 1.55, 0.25), BALL(0.5, 2.5, 0), TP(1.19, 3.06), UEB(0.5, 2.5), FLUG] },
      { note: 'Die Indiaca schlägt tief im gegnerischen Feld an der Linie auf', dur: 0.8, els: [ZU(4.6), AA(1.0), BL('n_b1', 2.3), BL('n_b2', 1.55), BALL(0.3, 0.05, 5.5), TP(1.19, 3.06), UEB(0.5, 2.5), LAND(0.3, 5.5), FLUG, FLUG2] },
    ]),
    netExample('3D: Mittelangriff', [
      { note: '1. Zuspieler mit der Indiaca – Hauptangreifer läuft in der Mitte an', els: [ZU(4.7), HA(3.1), BL('n_b1', 3.2), BL('n_b2', 4.2), BALL(4.6, 2.3, -0.5)] },
      { note: 'Schnelles, kurzes Zuspiel in die Mitte', dur: 0.8, els: [ZU(4.7, 0.1), HA(3.0, 0.35), BL('n_b1', 3.1, 0.1), BL('n_b2', 3.9), BALL(3.6, 2.95, -0.45)] },
      { note: 'Absprung – Schlag, bevor der Block steht', dur: 0.7, els: [ZU(4.7), HA(3.0, 0.7), BL('n_b1', 3.0, 0.35), BL('n_b2', 3.7, 0.2), BALL(3.19, 3.23, -0.3), TP(3.19, 3.23)] },
      { note: 'Steil über die Netzkante zwischen die Blockhände', dur: 0.4, els: [ZU(4.7), HA(3.0, 0.1), BL('n_b1', 3.0, 0.45), BL('n_b2', 3.7, 0.4), BALL(2.55, 2.48, 0), TP(3.19, 3.23), UEB(2.55, 2.48), FLUG] },
      { note: 'Kurz hinter dem Block im gegnerischen Feld – Punkt', dur: 0.5, els: [ZU(4.7), HA(3.0), BL('n_b1', 3.0), BL('n_b2', 3.7), BALL(2.2, 0.05, 2.6), TP(3.19, 3.23), UEB(2.55, 2.48), LAND(2.2, 2.6), FLUG, FLUG2] },
    ]),
  ];
}

export function exampleTemplates() {
  const srv = [8.4, OPP.o1[1]]; // Aufschläger des Gegners hinter seiner Grundlinie (Pos. 1)
  return [
    example('K1: Annahme → Aufbau → Angriff', [
      { note: 'Grundaufstellung – Gegner schlägt auf', pos: withOpp({ ...OWN, ball: [srv[0] + 0.3, srv[1]] }, { o1: srv }) },
      { note: 'Annahme durch die 2. Mitte (hinten links)', dur: 1.4, pos: withOpp({ ...OWN, p5: [-5.8, -1.3], ball: [-5.5, -1.2] }) },
      { note: 'Pass zum 1. Zuspieler, Hauptangreifer holt Anlauf', pos: withOpp({ ...OWN, p5: [-5.4, -1.3], p3: [-3.6, 0.3], p2: [-1, 1.9], ball: [-0.7, 1.8] }) },
      { note: 'Angriff über die Mitte, Rest sichert ab', pos: withOpp({ ...OWN, p3: [-0.7, 0.2], p2: [-1.4, 1.5], p4: [-2.2, -1.2], p1: [-4.2, 1.3], p5: [-4.4, -1.3], ball: [-0.4, 0.2] }) },
      { note: 'Punkt im gegnerischen Feld', dur: 0.6, pos: withOpp({ ...OWN, p3: [-0.7, 0.2], p2: [-1.4, 1.5], p4: [-2.2, -1.2], p1: [-4.2, 1.3], p5: [-4.4, -1.3], ball: [4.6, -1.6] }) },
    ]),
    example('K2: Grundstellung → Block/Abwehr', [
      { note: 'Grundstellung – Gegner im Aufbau', pos: withOpp({ ...OWN, ball: [OPP.o2[0], OPP.o2[1] + 0.2] }) },
      { note: 'Gegner stellt auf die Mitte – Block orientiert sich', pos: withOpp(
        { ...OWN, p2: [-0.6, 0.9], p3: [-1, -0.4], p4: [-3.4, -2], p5: [-5.4, -1.2], p1: [-5.4, 1.4], ball: [0.8, 0] },
        { o3: [1.3, 0] }) },
      { note: 'Doppelblock (1. Zuspieler + Hauptangreifer), hinten sichern ab', pos: withOpp(
        { ...OWN, p2: [-0.4, 0.5], p3: [-0.4, -0.4], p4: [-3.6, -1.8], p5: [-5.2, -1], p1: [-5, 1.2], ball: [-0.15, 0.1] },
        { o3: [0.5, 0] }) },
      { note: 'Abwehr hinten rechts – Gegenangriff kann starten', pos: withOpp(
        { ...OWN, p2: [-1, 1.6], p3: [-1.6, 0], p4: [-3.4, -1.9], p5: [-5, -1], p1: [-5.1, 1.3], ball: [-5, 1.3] },
        { o3: [1.2, 0] }) },
    ]),
    example('Angabe → Annahme', [
      { note: 'Gegner schlägt auf – Grundaufstellung', pos: withOpp({ ...OWN, ball: [srv[0] + 0.3, srv[1]] }, { o1: srv }) },
      { note: 'Annahme durch den Außenangreifer (hinten rechts)', dur: 1.4, pos: withOpp({ ...OWN, p1: [-6.2, 1.8], ball: [-6, 1.8] }) },
      { note: 'Pass zum 1. Zuspieler', pos: withOpp({ ...OWN, p1: [-5.8, 1.6], p3: [-3.4, 0.2], p2: [-1, 1.9], ball: [-0.7, 1.8] }) },
    ]),
    ...netExamples(),
  ];
}
