import { NS, uid, clone, dist, segDist, r3, colorCss } from './util.js';
const locked = () => state.viewLocked;
import {
  state, board, page, findEl, commit, snapshot, changed, select, on, emit, set, switchPage, pageIndex, scale, activeServeType, setTool, pageOrientation,
} from './store.js';
import { defaultPos, clampPlayer } from './model.js';
import { renderField, renderElements, renderSelection, renderOne, viewBox, worldTransform, modelBox } from './render.js';
import { strokePath } from './stroke.js';
import { I } from './icons.js';

/*
 * Aufbau der Bühne:
 *   <svg viewBox=…>            feste Basis-Ansicht des Feldes
 *     <g #g-cam>               Kamera: Zoom + Drehung + Verschiebung (Ähnlichkeitsabbildung)
 *       <g #g-world>           Ausrichtung hoch/quer, Koordinaten = Meter ab Feldmitte
 *         Feld, Elemente, Live-Zeichnung, Auswahl
 * Alle Eingaben werden über gWorld.getScreenCTM() zurückgerechnet – dadurch zeichnet der Stift
 * auch gezoomt/gedreht exakt an der richtigen Stelle, und alles bewegt sich gemeinsam mit dem Feld.
 */

let gGhost;
let svg, gCam, gWorld, gField, gEls, gLive, gSel, trash, zoombar, rotpanel, rotInput, rotLabel, rotBtn;
let drawnKey = '';
const gestures = new Map(); // pointerId → Geste
const rot = () => (pageOrientation() === 'quer' ? 0 : 90);
const ONE_SHOT = ['marker', 'arrow', 'rect', 'tri', 'cone', 'circle', 'free'];

// ---------- Kamera (komplexe Zahl m = Zoom·e^(i·Winkel), b = Verschiebung) ----------
const cam = { mr: 1, mi: 0, bx: 0, by: 0 };
const K_MIN = 0.5, K_MAX = 6;
const camK = () => Math.hypot(cam.mr, cam.mi);
const camAngle = () => Math.atan2(cam.mi, cam.mr);
const isIdentity = (c = cam) => Math.abs(c.mr - 1) < 0.01 && Math.abs(c.mi) < 0.01 && Math.abs(c.bx) < 0.01 && Math.abs(c.by) < 0.01;

function applyCam() {
  gCam.setAttribute('transform', `matrix(${cam.mr} ${cam.mi} ${-cam.mi} ${cam.mr} ${cam.bx} ${cam.by})`);
  zoombar?.classList.toggle('zoomed', !isIdentity());
  if (rotInput && document.activeElement !== rotInput) {
    const deg = Math.round((camAngle() * 180) / Math.PI);
    rotInput.value = deg;
    rotLabel.textContent = deg + '°';
  }
}
/** Feld auf einen bestimmten Winkel drehen (um die Bildschirmmitte) */
function setAngle(deg) {
  rotateAbout(viewCenter(), (deg * Math.PI) / 180 - camAngle());
  rotLabel.textContent = Math.round(deg) + '°';
}
/** Ähnlichkeitsabbildung S(z) = M·z + B auf die Kamera anwenden (C ← S ∘ C) */
function composeCam(Mr, Mi, Bx, By, base = cam) {
  const mr = Mr * base.mr - Mi * base.mi;
  const mi = Mr * base.mi + Mi * base.mr;
  const bx = Mr * base.bx - Mi * base.by + Bx;
  const by = Mr * base.by + Mi * base.bx + By;
  Object.assign(cam, { mr, mi, bx, by });
}
/** Zoom/Drehung um einen festen Ansichtspunkt p */
function transformAbout(p, Mr, Mi, base = cam) {
  // B = p − M·p
  composeCam(Mr, Mi, p.x - (Mr * p.x - Mi * p.y), p.y - (Mr * p.y + Mi * p.x), base);
}
function clampZoomAbout(p) {
  const k = camK();
  const kc = Math.min(K_MAX, Math.max(K_MIN, k));
  if (kc !== k) transformAbout(p, kc / k, 0);
}
function screenToView(cx, cy) {
  const q = new DOMPoint(cx, cy).matrixTransform(svg.getScreenCTM().inverse());
  return { x: q.x, y: q.y };
}
function viewCenter() {
  const r = svg.getBoundingClientRect();
  return screenToView(r.left + r.width / 2, r.top + r.height / 2);
}
function zoomAt(p, factor) {
  transformAbout(p, factor, 0);
  clampZoomAbout(p);
  applyCam();
}
function rotateAbout(p, rad) {
  transformAbout(p, Math.cos(rad), Math.sin(rad));
  applyCam();
}
export function resetView() {
  Object.assign(cam, { mr: 1, mi: 0, bx: 0, by: 0 });
  applyCam();
}
// ---------- Aufbau ----------
export function initStage(wrap) {
  svg = document.createElementNS(NS, 'svg');
  svg.id = 'stage';
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.innerHTML =
    '<defs><clipPath id="vclip"><rect id="vclip-r"/></clipPath></defs>' +
    '<g id="g-cam"><g id="g-world" clip-path="url(#vclip)"><g id="g-field"></g><g id="g-ghost"></g><g id="g-els"></g><g id="g-live"></g><g id="g-sel"></g></g></g>';
  trash = document.createElement('div');
  trash.id = 'trash';
  trash.setAttribute('aria-label', 'Zum Löschen hierher ziehen');
  trash.innerHTML = I.trash;
  zoombar = document.createElement('div');
  zoombar.id = 'zoombar';
  const zb = (label, html, fn) => {
    const b = document.createElement('button');
    b.className = 'btn';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.innerHTML = html;
    b.onclick = fn;
    return b;
  };
  rotBtn = zb('Feld drehen', I.turn, () => {
    rotpanel.classList.toggle('show');
    rotBtn.classList.toggle('active', rotpanel.classList.contains('show'));
  });
  const resetBtn = zb('Ansicht zurücksetzen (gerade, 100 %)', I.reset, resetView);
  resetBtn.classList.add('reset-btn');
  const lockBtn = zb('Ansicht sperren', I.unlock, () => set({ viewLocked: !state.viewLocked }));
  lockBtn.classList.add('lock-btn');
  const syncLock = () => {
    lockBtn.innerHTML = state.viewLocked ? I.lock : I.unlock;
    lockBtn.title = state.viewLocked ? 'Ansicht ist gesperrt – tippen zum Entsperren' : 'Ansicht sperren (Zoom/Verschieben/Drehen einfrieren)';
    lockBtn.classList.toggle('active', state.viewLocked);
    zoombar.classList.toggle('locked', state.viewLocked);
    [...zoombar.querySelectorAll('button')].forEach((b) => b !== lockBtn && (b.disabled = state.viewLocked));
    if (state.viewLocked) {
      rotpanel?.classList.remove('show');
      rotBtn.classList.remove('active');
    }
  };
  on('ui', syncLock);
  zoombar.append(
    lockBtn,
    rotBtn,
    resetBtn,
    zb('Vergrößern', I.plus, () => zoomAt(viewCenter(), 1.4)),
    zb('Verkleinern', I.minus, () => zoomAt(viewCenter(), 1 / 1.4))
  );
  // Dreh-Regler
  rotpanel = document.createElement('div');
  rotpanel.id = 'rotpanel';
  rotInput = document.createElement('input');
  Object.assign(rotInput, { type: 'range', min: -180, max: 180, step: 1, value: 0 });
  rotInput.setAttribute('aria-label', 'Drehwinkel');
  rotLabel = document.createElement('span');
  rotLabel.className = 'deg';
  rotLabel.textContent = '0°';
  rotInput.addEventListener('input', () => {
    // Bei 0°/±90°/180° leicht einrasten
    let d = +rotInput.value;
    const snap = Math.round(d / 90) * 90;
    if (Math.abs(d - snap) <= 3) d = snap;
    setAngle(d);
  });
  const zero = zb('Auf 0° stellen', '0°', () => setAngle(0));
  zero.classList.add('small');
  rotpanel.append(rotInput, rotLabel, zero);
  // Vereinslogo fest oben rechts in der Ecke (außerhalb des Feldes)
  const logo = document.createElement('img');
  logo.id = 'club-logo';
  logo.src = 'img/logo.jpg';
  logo.alt = 'Indiaca im CVJM Kamen e.V.';
  logo.draggable = false;
  wrap.append(svg, trash, zoombar, rotpanel, logo);
  [gCam, gWorld, gField, gEls, gLive, gSel, gGhost] = ['#g-cam', '#g-world', '#g-field', '#g-els', '#g-live', '#g-sel', '#g-ghost'].map((s) => svg.querySelector(s));

  // Mac: Trackpad-Pinch/Mausrad = Zoom (Drehen nur über den Regler)
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (locked()) return;
    zoomAt(screenToView(e.clientX, e.clientY), Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
  }, { passive: false });

  svg.addEventListener('pointerdown', down);
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', cancel);
  svg.addEventListener('contextmenu', (e) => e.preventDefault());
  // iOS: keine Scroll-/Zoom-Gesten der Webseite selbst
  wrap.addEventListener('touchstart', (e) => e.target.closest('#stage') && e.preventDefault(), { passive: false });
  wrap.addEventListener('touchmove', (e) => e.target.closest('#stage') && e.preventDefault(), { passive: false });

  on(['board', 'page'], drawField);
  on('elements', drawEls);
  on('ui', () => {
    if (drawnKey !== key()) {
      drawField();
      drawEls();
    } else drawSel();
  });
}

const key = () => `${board().fieldType}|${!!page().half}|${rot()}|${page().id}`;
function drawField() {
  const b = board();
  const k = key();
  if (k !== drawnKey) resetView(); // neue Seite / anderes Feld → Ansicht zurücksetzen
  drawnKey = k;
  svg.setAttribute('viewBox', viewBox(b.fieldType, page().half, rot()));
  gWorld.setAttribute('transform', worldTransform(rot()));
  gField.innerHTML = renderField(b, page().half);
  // Alles außerhalb des Feldbereichs (z. B. gegnerische Hälfte) abschneiden
  const mb = modelBox(b.fieldType, page().half);
  const cr = svg.querySelector('#vclip-r');
  cr.setAttribute('x', mb.x0);
  cr.setAttribute('y', mb.y0);
  cr.setAttribute('width', mb.x1 - mb.x0);
  cr.setAttribute('height', mb.y1 - mb.y0);
}
// ---------- Hooks für Animationen ----------
let frameOverride = null; // () => Seite mit interpolierten Spielern (während der Wiedergabe)
let ghostRenderer = null; // (rot) => SVG-Markup für Geister/Laufwege
let editLock = () => false; // true → keine Bearbeitung (Wiedergabe läuft)
export function setFrameOverride(fn) {
  frameOverride = fn;
  drawEls();
}
export function setGhostRenderer(fn) {
  ghostRenderer = fn;
}
export function setEditLock(fn) {
  editLock = fn;
}
export function redraw() {
  drawEls();
}

function drawEls() {
  const pg = frameOverride ? frameOverride() : page();
  gEls.innerHTML = renderElements(pg, board(), rot());
  gGhost.innerHTML = ghostRenderer ? ghostRenderer(rot()) : '';
  drawSel();
}
function drawSel() {
  const el = !frameOverride && state.selectionId && findEl(state.selectionId);
  gSel.innerHTML = el ? renderSelection(el, page(), board()) : '';
}

// ---------- Koordinaten ----------
function inv() {
  return gWorld.getScreenCTM().inverse();
}
function toW(m, cx, cy) {
  const p = new DOMPoint(cx, cy).matrixTransform(m);
  return { x: p.x, y: p.y };
}
export function isOverStage(cx, cy) {
  const r = svg.getBoundingClientRect();
  return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
}
function overTrash(cx, cy) {
  const r = trash.getBoundingClientRect();
  const pad = 12;
  return cx >= r.left - pad && cx <= r.right + pad && cy >= r.top - pad && cy <= r.bottom + pad;
}

// ---------- Spieler hinzufügen ----------
function playerEl(team, number, pt) {
  const t = board().teams[team];
  return clampPlayer({ id: uid(), type: 'player', team, number: number == null ? '' : String(number), label: '', color: t.color, x: pt.x, y: pt.y }, board().fieldType);
}
export function dropPlayer(team, number, cx, cy) {
  if (!isOverStage(cx, cy)) return false;
  const pt = toW(inv(), cx, cy);
  commit((p) => p.elements.push(playerEl(team, number, pt)));
  return true;
}
export function addPlayerDefault(team, number) {
  // nächste freie Grundposition 1–5 für dieses Team
  if (number == null) number = (page().elements.filter((e) => e.type === 'player' && e.team === team).length % 5) + 1;
  const pt = defaultPos(board().fieldType, team, number);
  const taken = (q) => page().elements.some((e) => e.type === 'player' && dist(e, q) < 0.4);
  for (let i = 0; i < 6 && taken(pt); i++) pt.y += 0.9 * (pt.y > 0 ? -1 : 1);
  commit((p) => p.elements.push(playerEl(team, number, pt)));
}

// ---------- Pointer-Logik ----------
function capture(e) {
  try {
    svg.setPointerCapture(e.pointerId);
  } catch {}
}
const pressureOf = (e) => (e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5);

function down(e) {
  if (e.pointerType === 'pen') {
    if (!state.penSeen) {
      state.penSeen = true;
      emit('ui');
    }
    // Handballen, der schon vor dem Stift auflag: Gesten verwerfen
    for (const [id, g] of gestures) if (g.ptype === 'touch') abort(id, g);
  }
  const palmMode = e.pointerType === 'touch' && state.penSeen && state.palmRejection;
  if (palmMode && [...gestures.values()].some((g) => g.ptype === 'pen')) return; // Stift aktiv → Finger ignorieren
  e.preventDefault();

  // Zweiter Finger → Kamera-Geste (Pinch-Zoom + Drehen + Verschieben)
  if (e.pointerType === 'touch') {
    const others = [...gestures.entries()].filter(([, g]) => g.ptype === 'touch' && g.kind !== 'cam2');
    // Ansicht gesperrt: zweiter Finger wird ignoriert (kein Zoom/Verschieben)
    if (locked() && others.length >= 1) return;
    if (others.length === 1 && (!others[0][1].moved || others[0][1].kind === 'none' || others[0][1].kind === 'pan')) {
      const [oid, og] = others[0];
      abort(oid, og);
      const g = { kind: 'cam2', ptype: 'touch', ids: [oid, e.pointerId], start: {}, pos: {} };
      g.start[oid] = g.pos[oid] = { x: og.cx0, y: og.cy0 };
      g.start[e.pointerId] = g.pos[e.pointerId] = { x: e.clientX, y: e.clientY };
      g.v0 = g.ids.map((i) => screenToView(g.start[i].x, g.start[i].y));
      g.cam0 = { ...cam };
      gestures.set(oid, g);
      gestures.set(e.pointerId, g);
      capture(e);
      return;
    }
  }

  const pt = toW(inv(), e.clientX, e.clientY);
  const locked = editLock();
  const handleNode = locked ? null : e.target.closest?.('[data-handle]');
  const elNode = locked ? null : e.target.closest?.('#g-els [data-id]');
  let tool = palmMode || locked ? 'select' : state.tool;
  // Einmal-Werkzeuge: Tippen auf ein vorhandenes Element verschiebt es, statt etwas Neues zu setzen
  if (elNode && ONE_SHOT.includes(tool)) {
    tool = 'select';
    setTool('select');
  }
  capture(e);
  const g = { ptype: e.pointerType, t0: performance.now(), cx0: e.clientX, cy0: e.clientY, start: pt, moved: false };
  gestures.set(e.pointerId, g);
  const s = scale();

  if (tool === 'select') {
    if (handleNode && state.selectionId) {
      snapshot();
      Object.assign(g, { kind: 'handle', h: handleNode.dataset.handle, id: state.selectionId, moved: true });
    } else if (elNode) {
      const id = elNode.dataset.id;
      Object.assign(g, { kind: 'move', id, orig: clone(findEl(id)) });
    } else {
      // Leere Fläche: Feld verschieben
      Object.assign(g, { kind: 'none', v0: screenToView(e.clientX, e.clientY), cam0: { ...cam } });
    }
    return;
  }
  switch (tool) {
    case 'pen':
      Object.assign(g, { kind: 'stroke', pressure: e.pointerType === 'pen', points: [[pt.x, pt.y, pressureOf(e)]], width: state.width * s, color: state.color });
      live(g);
      break;
    case 'arrow':
      Object.assign(g, { kind: 'arrow', end: pt });
      break;
    case 'eraser':
      g.kind = 'erase';
      eraseAt(g, pt);
      break;
    case 'rect':
    case 'tri':
    case 'cone':
    case 'circle':
    case 'free':
      Object.assign(g, { kind: 'zone', shape: tool, end: pt, cx1: e.clientX, cy1: e.clientY, points: [[pt.x, pt.y]] });
      break;
    case 'marker':
      Object.assign(g, { kind: 'marker', end: pt });
      live(g);
      break;
    default:
      g.kind = 'none';
  }
}

function move(e) {
  const g = gestures.get(e.pointerId);
  if (!g) return;
  if (g.kind === 'cam2') {
    g.pos[e.pointerId] = { x: e.clientX, y: e.clientY };
    const [p1, p2] = g.v0;
    const [q1, q2] = g.ids.map((i) => screenToView(g.pos[i].x, g.pos[i].y));
    // M = (q2 − q1) / (p2 − p1) als komplexe Division
    const ax = p2.x - p1.x, ay = p2.y - p1.y, bx = q2.x - q1.x, by = q2.y - q1.y;
    // nur Zoomfaktor (Abstandsverhältnis), keine Drehung
    const Mr = Math.hypot(bx, by) / (Math.hypot(ax, ay) || 1e-9), Mi = 0;
    // Mittelpunkt der Finger bleibt unter den Fingern
    const pm = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, qm = { x: (q1.x + q2.x) / 2, y: (q1.y + q2.y) / 2 };
    composeCam(Mr, Mi, qm.x - (Mr * pm.x - Mi * pm.y), qm.y - (Mr * pm.y + Mi * pm.x), g.cam0);
    clampZoomAbout(qm);
    applyCam();
    g.qm = qm;
    return;
  }
  const m = inv();
  const pt = toW(m, e.clientX, e.clientY);
  if (!g.moved && Math.hypot(e.clientX - g.cx0, e.clientY - g.cy0) > 5) {
    g.moved = true;
    if (g.kind === 'move') snapshot();
  }
  switch (g.kind) {
    case 'none': {
      if (!g.moved || locked()) return;
      const q = screenToView(e.clientX, e.clientY);
      Object.assign(cam, { ...g.cam0, bx: g.cam0.bx + q.x - g.v0.x, by: g.cam0.by + q.y - g.v0.y });
      applyCam();
      svg.classList.add('panning');
      break;
    }
    case 'move': {
      if (!g.moved) return;
      const el = findEl(g.id);
      if (!el) return;
      translate(el, g.orig, pt.x - g.start.x, pt.y - g.start.y);
      trash.classList.add('show');
      trash.classList.toggle('hot', overTrash(e.clientX, e.clientY));
      changed();
      break;
    }
    case 'handle':
      applyHandle(g, pt);
      changed();
      break;
    case 'stroke': {
      const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
      for (const ce of evs.length ? evs : [e]) addPoint(g, toW(m, ce.clientX, ce.clientY), pressureOf(ce));
      live(g);
      break;
    }
    case 'erase':
      eraseAt(g, pt);
      break;
    case 'zone':
      g.end = pt;
      g.cx1 = e.clientX;
      g.cy1 = e.clientY;
      if (g.shape === 'free') {
        const l = g.points[g.points.length - 1];
        if (Math.hypot(pt.x - l[0], pt.y - l[1]) > 0.06) g.points.push([pt.x, pt.y]);
      }
      live(g);
      break;
    case 'arrow':
    case 'marker':
      g.end = pt;
      live(g);
      break;
  }
}

function up(e) {
  const g = gestures.get(e.pointerId);
  if (!g) return;
  gestures.delete(e.pointerId);
  if (g.kind === 'cam2') return endCam2(g);
  const s = scale();
  const p = page();
  switch (g.kind) {
    case 'move':
      trash.classList.remove('show', 'hot');
      if (!g.moved) select(g.id);
      else if (overTrash(e.clientX, e.clientY)) {
        // Snapshot wurde beim Drag-Start angelegt → ein Undo stellt das Element wieder her
        p.elements = p.elements.filter((x) => x.id !== g.id);
        if (state.selectionId === g.id) state.selectionId = null;
        changed();
        emit('ui');
      }
      break;
    case 'none':
      svg.classList.remove('panning');
      if (!g.moved && state.selectionId) select(null);
      break;
    case 'stroke':
      commit((pg) =>
        pg.elements.push({
          id: uid(), type: 'stroke', color: g.color, width: g.width, pressure: g.pressure,
          points: g.points.map((q) => [r3(q[0]), r3(q[1]), Math.round(q[2] * 100) / 100]),
        })
      );
      break;
    case 'arrow':
      if (dist(g.start, g.end) >= 0.3 * s)
        commit((pg) =>
          pg.elements.push({
            id: uid(), type: 'arrow', color: state.color, width: state.width * s, dashed: state.arrowDashed,
            x1: r3(g.start.x), y1: r3(g.start.y), x2: r3(g.end.x), y2: r3(g.end.y),
          })
        );
      setTool('select');
      break;
    case 'zone': {
      const z = zoneFrom(g, inv());
      if (z) {
        commit((pg) => pg.elements.push(z));
        setTool('select');
        // Polygon direkt auswählen, damit die Ecken sofort angepasst werden können
        if (z.shape === 'poly') select(z.id);
      }
      break;
    }
    case 'marker': {
      const st = activeServeType();
      const withArrow = dist(g.start, g.end) > 0.5 * s;
      const mk = {
        id: uid(), type: 'marker', symbol: state.markerSymbol, label: '',
        color: st ? st.color : state.color, x: r3(g.end.x), y: r3(g.end.y),
      };
      if (st) mk.serveType = st.id;
      if (withArrow) mk.from = { x: r3(g.start.x), y: r3(g.start.y) };
      if (p) commit((pg) => pg.elements.push(mk));
      setTool('select');
      break;
    }
  }
  gLive.innerHTML = '';
}

function cancel(e) {
  const g = gestures.get(e.pointerId);
  if (!g) return;
  if (g.kind === 'cam2') g.ids.forEach((i) => gestures.delete(i));
  else abort(e.pointerId, g);
}

function abort(id, g) {
  gestures.delete(id);
  trash.classList.remove('show', 'hot');
  svg.classList.remove('panning');
  if (g.kind === 'move' && g.moved) {
    const el = findEl(g.id);
    if (el) {
      Object.assign(el, clone(g.orig));
      changed();
    }
  }
  gLive.innerHTML = '';
}

function endCam2(g) {
  g.ids.forEach((i) => gestures.delete(i));
  let dx = 0, dy = 0;
  for (const id of g.ids) {
    dx += (g.pos[id].x - g.start[id].x) / 2;
    dy += (g.pos[id].y - g.start[id].y) / 2;
  }
  // Reiner Zwei-Finger-Wisch (ohne Zoom/Drehung, aus der Grundansicht) → Seite wechseln
  const zoomed = Math.abs(camK() - 1) > 0.1;
  if (isIdentity(g.cam0) && !zoomed && Math.abs(dx) > 90 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
    resetView();
    const pages = board().pages;
    const i = pageIndex() + (dx < 0 ? 1 : -1);
    if (i >= 0 && i < pages.length) switchPage(pages[i].id);
    return;
  }
}

// ---------- Helfer ----------
function addPoint(g, p, pr) {
  const l = g.points[g.points.length - 1];
  const d = Math.hypot(p.x - l[0], p.y - l[1]);
  if (d < 0.012 / Math.max(1, camK())) return;
  const k = 0.75; // leichte Glättung
  g.points.push([l[0] + (p.x - l[0]) * k, l[1] + (p.y - l[1]) * k, l[2] * 0.4 + pr * 0.6]);
}

function translate(el, o, dx, dy) {
  switch (el.type) {
    case 'player':
      el.x = o.x + dx;
      el.y = o.y + dy;
      clampPlayer(el, board().fieldType);
      break;
    case 'marker':
      el.x = r3(o.x + dx);
      el.y = r3(o.y + dy);
      break;
    case 'zone':
      if (o.points) el.points = o.points.map((q) => [r3(q[0] + dx), r3(q[1] + dy)]);
      else {
        el.x = r3(o.x + dx);
        el.y = r3(o.y + dy);
      }
      break;
    case 'arrow':
      el.x1 = r3(o.x1 + dx); el.y1 = r3(o.y1 + dy);
      el.x2 = r3(o.x2 + dx); el.y2 = r3(o.y2 + dy);
      break;
  }
}

function applyHandle(g, pt) {
  const el = findEl(g.id);
  if (!el) return;
  if (g.h === 'vrot' && el.points) {
    // Blick um die Spitze drehen und Länge anpassen, Öffnungswinkel bleibt
    const [l, a, r] = el.points;
    const half = Math.abs(Math.atan2(r[1] - a[1], r[0] - a[0]) - Math.atan2(l[1] - a[1], l[0] - a[0]));
    const sp = (half > Math.PI ? 2 * Math.PI - half : half) / 2;
    const th = Math.atan2(pt.y - a[1], pt.x - a[0]);
    const len = Math.max(0.4, Math.hypot(pt.x - a[0], pt.y - a[1]) / Math.cos(sp));
    const arm = (d) => [r3(a[0] + Math.cos(th + d) * len), r3(a[1] + Math.sin(th + d) * len)];
    el.points = [arm(-sp), a, arm(sp)];
    return;
  }
  if (g.h[0] === 'v' && el.points) {
    const i = +g.h.slice(1);
    if (el.points[i]) el.points[i] = [r3(pt.x), r3(pt.y)];
    return;
  }
  switch (g.h) {
    case 'r':
      el.r = r3(Math.max(0.15, dist(pt, el)));
      break;
    case 'from':
      el.from = { x: r3(pt.x), y: r3(pt.y) };
      break;
    case 'a1':
      el.x1 = r3(pt.x); el.y1 = r3(pt.y);
      break;
    case 'a2':
      el.x2 = r3(pt.x); el.y2 = r3(pt.y);
      break;
  }
}

/** Neue Zone aus der Geste. Rechteck/Dreieck werden am Bildschirm ausgerichtet und als Polygon gespeichert. */
function zoneFrom(g, m) {
  const base = { id: uid(), type: 'zone', color: state.color === 'ink' ? '#f59e0b' : state.color, opacity: 0.3 };
  if (g.shape === 'rect' || g.shape === 'tri') {
    const x0 = Math.min(g.cx0, g.cx1), x1 = Math.max(g.cx0, g.cx1);
    const y0 = Math.min(g.cy0, g.cy1), y1 = Math.max(g.cy0, g.cy1);
    if (x1 - x0 < 14 || y1 - y0 < 14) return null;
    const corners = g.shape === 'rect'
      ? [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
      : [[(x0 + x1) / 2, y0], [x1, y1], [x0, y1]];
    return { ...base, shape: 'poly', points: corners.map(([cx, cy]) => { const p = toW(m, cx, cy); return [r3(p.x), r3(p.y)]; }) };
  }
  const a = g.start, b = g.end;
  if (g.shape === 'cone') {
    // Blickrichtung: Spitze am Startpunkt, Öffnung (±25°) Richtung Endpunkt
    const len = dist(a, b);
    if (len < 0.4) return null;
    const ang = Math.atan2(b.y - a.y, b.x - a.x), sp = (25 * Math.PI) / 180;
    const arm = (d) => [r3(a.x + Math.cos(ang + d) * len), r3(a.y + Math.sin(ang + d) * len)];
    return { ...base, color: state.color === 'ink' ? '#facc15' : state.color, opacity: 0.2, shape: 'poly', vee: true, points: [arm(-sp), [r3(a.x), r3(a.y)], arm(sp)] };
  }
  if (g.shape === 'circle') {
    const r = dist(a, b);
    if (r < 0.15) return null;
    return { ...base, shape: 'circle', x: r3(a.x), y: r3(a.y), r: r3(r) };
  }
  if (g.points.length < 4) return null;
  return { ...base, shape: 'free', points: g.points.map((q) => [r3(q[0]), r3(q[1])]) };
}

function eraseAt(g, pt) {
  const s = scale();
  const r = 0.2 * s;
  const p = page();
  const hit = (el) => {
    if (el.type === 'stroke') {
      const P = el.points;
      if (P.length === 1) return Math.hypot(P[0][0] - pt.x, P[0][1] - pt.y) < r + el.width;
      for (let i = 1; i < P.length; i++)
        if (segDist(pt, { x: P[i - 1][0], y: P[i - 1][1] }, { x: P[i][0], y: P[i][1] }) < r + el.width / 2) return true;
      return false;
    }
    if (el.type === 'arrow') return segDist(pt, { x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }) < r + el.width;
    if (el.type === 'marker') return dist(pt, el) < r + 0.3 * s || (el.from && segDist(pt, el.from, el) < r);
    return false;
  };
  const keep = p.elements.filter((el) => !hit(el));
  if (keep.length !== p.elements.length) {
    if (!g.snap) {
      snapshot();
      g.snap = true;
    }
    p.elements = keep;
    changed();
  }
  gLive.innerHTML = `<circle class="eraser" cx="${pt.x}" cy="${pt.y}" r="${r}"/>`;
}

function live(g) {
  const s = scale();
  const b = board(), p = page();
  let out = '';
  if (g.kind === 'stroke') out = `<path d="${strokePath(g.points, g.width, g.pressure)}" style="fill:${colorCss(g.color)}"/>`;
  else if (g.kind === 'arrow' && dist(g.start, g.end) > 0.05)
    out = renderOne({ id: 'live', type: 'arrow', x1: g.start.x, y1: g.start.y, x2: g.end.x, y2: g.end.y, color: state.color, width: state.width * s, dashed: state.arrowDashed }, p, b, rot());
  else if (g.kind === 'zone') {
    const z = zoneFrom(g.shape === 'free' ? { ...g, points: [...g.points, [g.end.x, g.end.y]] } : g, inv());
    if (z) out = renderOne({ ...z, id: 'live' }, p, b, rot());
  } else if (g.kind === 'marker') {
    const st = activeServeType();
    const mk = { id: 'live', type: 'marker', symbol: state.markerSymbol, color: st ? st.color : state.color, x: g.end.x, y: g.end.y };
    if (dist(g.start, g.end) > 0.5 * s) mk.from = g.start;
    out = renderOne(mk, p, b, rot());
  }
  gLive.innerHTML = out;
}
