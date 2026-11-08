import { NS, uid, clone, dist, segDist, r3, colorCss, clamp } from './util.js';
import {
  state, board, page, findEl, commit, snapshot, changed, select, on, emit, switchPage, pageIndex, scale, activeServeType, setTool,
} from './store.js';
import { defaultPos } from './model.js';
import { renderField, renderElements, renderSelection, renderOne, viewBox, worldTransform, modelBox } from './render.js';
import { strokePath } from './stroke.js';
import { I } from './icons.js';

function overTrash(cx, cy) {
  const r = trash.getBoundingClientRect();
  const pad = 12;
  return cx >= r.left - pad && cx <= r.right + pad && cy >= r.top - pad && cy <= r.bottom + pad;
}

let svg, gWorld, gField, gEls, gLive, gSel, trash;
let drawnKey = '';
let zoombar;
// ---------- Zoom (Ansicht) ----------
const view = { k: 1, cx: null, cy: null, base: [0, 0, 1, 1] };
const ZMAX = 5;
function applyView() {
  const [x, y, w, h] = view.base;
  const w2 = w / view.k, h2 = h / view.k;
  view.cx = clamp(view.cx ?? x + w / 2, x + w2 / 2, x + w - w2 / 2);
  view.cy = clamp(view.cy ?? y + h / 2, y + h2 / 2, y + h - h2 / 2);
  svg.setAttribute('viewBox', `${view.cx - w2 / 2} ${view.cy - h2 / 2} ${w2} ${h2}`);
  zoombar?.classList.toggle('zoomed', view.k > 1.01);
}
function screenToView(cx, cy) {
  const p = new DOMPoint(cx, cy).matrixTransform(svg.getScreenCTM().inverse());
  return { x: p.x, y: p.y };
}
/** Ansichtspunkt p0 (View-Koordinaten) unter den Bildschirmpunkt (sx, sy) legen */
function pinTo(p0, sx, sy) {
  applyView();
  const pm = screenToView(sx, sy);
  view.cx += p0.x - pm.x;
  view.cy += p0.y - pm.y;
  applyView();
}
function zoomAt(sx, sy, factor) {
  const p0 = screenToView(sx, sy);
  view.k = clamp(view.k * factor, 1, ZMAX);
  pinTo(p0, sx, sy);
}
function zoomCenter(factor) {
  const r = svg.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
}
function resetView() {
  view.k = 1;
  view.cx = view.cy = null;
  applyView();
}
const rot = () => (state.orientation === 'quer' ? 0 : 90);
const gestures = new Map(); // pointerId → Geste

export function initStage(wrap) {
  svg = document.createElementNS(NS, 'svg');
  svg.id = 'stage';
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.innerHTML = '<defs><clipPath id="vclip"><rect id="vclip-r"/></clipPath></defs><g id="g-world" clip-path="url(#vclip)"><g id="g-field"></g><g id="g-els"></g><g id="g-live"></g><g id="g-sel"></g></g>';
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
  zoombar.append(
    zb('Vergrößern', I.plus, () => zoomCenter(1.4)),
    zb('Verkleinern', I.minus, () => zoomCenter(1 / 1.4)),
    zb('Ganzes Feld zeigen', I.fit, resetView)
  );
  wrap.append(svg, trash, zoombar);
  // Trackpad-Pinch / Mausrad (Mac)
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
  }, { passive: false });
  [gWorld, gField, gEls, gLive, gSel] = ['#g-world', '#g-field', '#g-els', '#g-live', '#g-sel'].map((s) => svg.querySelector(s));

  svg.addEventListener('pointerdown', down);
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', cancel);
  svg.addEventListener('contextmenu', (e) => e.preventDefault());
  // iOS: keine Scroll-/Zoom-Gesten auf der Bühne
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
  view.base = viewBox(b.fieldType, page().half, rot()).split(' ').map(Number);
  if (k !== drawnKey) {
    // Neue Seite / anderes Feld → Zoom zurücksetzen
    view.k = 1;
    view.cx = view.cy = null;
  }
  drawnKey = k;
  applyView();
  gWorld.setAttribute('transform', worldTransform(rot()));
  gField.innerHTML = renderField(b, rot());
  // Alles außerhalb des Sichtbereichs (z. B. gegnerische Hälfte) abschneiden
  const mb = modelBox(b.fieldType, page().half);
  const cr = svg.querySelector('#vclip-r');
  cr.setAttribute('x', mb.x0);
  cr.setAttribute('y', mb.y0);
  cr.setAttribute('width', mb.x1 - mb.x0);
  cr.setAttribute('height', mb.y1 - mb.y0);
}
function drawEls() {
  gEls.innerHTML = renderElements(page(), board(), rot());
  drawSel();
}
function drawSel() {
  const el = state.selectionId && findEl(state.selectionId);
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

// ---------- Spieler hinzufügen ----------
function playerEl(team, number, pt) {
  const t = board().teams[team];
  return { id: uid(), type: 'player', team, number: String(number), label: '', color: t.color, x: r3(pt.x), y: r3(pt.y) };
}
export function dropPlayer(team, number, cx, cy) {
  if (!isOverStage(cx, cy)) return false;
  const pt = toW(inv(), cx, cy);
  commit((p) => p.elements.push(playerEl(team, number, pt)));
  return true;
}
export function addPlayerDefault(team, number) {
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

  // Zwei-Finger-Wisch zum Seitenwechsel
  if (e.pointerType === 'touch') {
    const others = [...gestures.entries()].filter(([, g]) => g.ptype === 'touch' && g.kind !== 'swipe');
    if (others.length === 1 && performance.now() - others[0][1].t0 < 400 && !others[0][1].moved) {
      const [oid, og] = others[0];
      abort(oid, og);
      const g = { kind: 'swipe', ptype: 'touch', ids: [oid, e.pointerId], start: {}, pos: {} };
      g.start[oid] = g.pos[oid] = { x: og.cx0, y: og.cy0 };
      g.start[e.pointerId] = g.pos[e.pointerId] = { x: e.clientX, y: e.clientY };
      const a = g.start[oid], c = g.start[e.pointerId];
      g.d0 = Math.hypot(a.x - c.x, a.y - c.y) || 1;
      g.k0 = view.k;
      g.c0 = { cx: view.cx, cy: view.cy };
      g.p0 = screenToView((a.x + c.x) / 2, (a.y + c.y) / 2);
      gestures.set(oid, g);
      gestures.set(e.pointerId, g);
      capture(e);
      return;
    }
  }

  const pt = toW(inv(), e.clientX, e.clientY);
  const handleNode = e.target.closest?.('[data-handle]');
  const elNode = e.target.closest?.('#g-els [data-id]');
  let tool = palmMode ? 'select' : state.tool;
  // Zielmarker/Zonen/Pfeil: Tippen auf ein vorhandenes Element verschiebt es statt etwas Neues zu setzen
  if (elNode && ['marker', 'arrow', 'rect', 'circle', 'free'].includes(tool)) {
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
      g.kind = 'none';
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
    case 'circle':
    case 'free':
      Object.assign(g, { kind: 'zone', shape: tool, end: pt, points: [[pt.x, pt.y]] });
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
  if (g.kind === 'swipe') {
    g.pos[e.pointerId] = { x: e.clientX, y: e.clientY };
    const [a, c] = g.ids.map((i) => g.pos[i]);
    view.k = clamp(g.k0 * (Math.hypot(a.x - c.x, a.y - c.y) / g.d0), 1, ZMAX);
    pinTo(g.p0, (a.x + c.x) / 2, (a.y + c.y) / 2);
    return;
  }
  const m = inv();
  const pt = toW(m, e.clientX, e.clientY);
  if (!g.moved && Math.hypot(e.clientX - g.cx0, e.clientY - g.cy0) > 5) {
    g.moved = true;
    if (g.kind === 'move') snapshot();
  }
  switch (g.kind) {
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
  if (g.kind === 'swipe') return endSwipe(g);
  const s = scale();
  const p = page();
  const pg0 = p;
  switch (g.kind) {
    case 'move':
      trash.classList.remove('show', 'hot');
      if (!g.moved) select(g.id);
      else if (overTrash(e.clientX, e.clientY)) {
        // Snapshot wurde beim Drag-Start angelegt → ein Undo stellt das Element wieder her
        pg0.elements = pg0.elements.filter((x) => x.id !== g.id);
        if (state.selectionId === g.id) state.selectionId = null;
        changed();
        emit('ui');
      }
      break;
    case 'none':
      if (state.selectionId) select(null);
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
      const z = zoneFrom(g);
      if (z) {
        commit((pg) => pg.elements.push(z));
        setTool('select');
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
  if (g.kind === 'swipe') g.ids.forEach((i) => gestures.delete(i));
  else abort(e.pointerId, g);
}

function abort(id, g) {
  gestures.delete(id);
  trash.classList.remove('show', 'hot');
  if (g.kind === 'move' && g.moved) {
    const el = findEl(g.id);
    if (el) {
      Object.assign(el, clone(g.orig));
      changed();
    }
  }
  gLive.innerHTML = '';
}

function endSwipe(g) {
  g.ids.forEach((i) => gestures.delete(i));
  let dx = 0, dy = 0;
  for (const id of g.ids) {
    dx += (g.pos[id].x - g.start[id].x) / 2;
    dy += (g.pos[id].y - g.start[id].y) / 2;
  }
  const zoomChanged = Math.abs(view.k / g.k0 - 1) > 0.1;
  if (g.k0 <= 1.01 && !zoomChanged && Math.abs(dx) > 90 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
    const pages = board().pages;
    const i = pageIndex() + (dx < 0 ? 1 : -1);
    view.k = g.k0;
    view.cx = g.c0.cx;
    view.cy = g.c0.cy;
    applyView();
    if (i >= 0 && i < pages.length) switchPage(pages[i].id);
  }
}

// ---------- Helfer ----------
function addPoint(g, p, pr) {
  const l = g.points[g.points.length - 1];
  const d = Math.hypot(p.x - l[0], p.y - l[1]);
  if (d < 0.012) return;
  const k = 0.75; // leichte Glättung
  g.points.push([l[0] + (p.x - l[0]) * k, l[1] + (p.y - l[1]) * k, l[2] * 0.4 + pr * 0.6]);
}

function translate(el, o, dx, dy) {
  switch (el.type) {
    case 'player':
    case 'marker':
      el.x = r3(o.x + dx);
      el.y = r3(o.y + dy);
      break;
    case 'zone':
      if (el.shape === 'free') el.points = o.points.map((q) => [r3(q[0] + dx), r3(q[1] + dy)]);
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
  switch (g.h) {
    case 'br':
      el.w = r3(Math.max(0.2, pt.x - el.x));
      el.h = r3(Math.max(0.2, pt.y - el.y));
      break;
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

function zoneFrom(g) {
  const base = { id: uid(), type: 'zone', shape: g.shape, color: state.color === 'ink' ? '#f59e0b' : state.color, opacity: 0.3 };
  const a = g.start, b = g.end;
  if (g.shape === 'rect') {
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (w < 0.2 || h < 0.2) return null;
    return { ...base, x: r3(Math.min(a.x, b.x)), y: r3(Math.min(a.y, b.y)), w: r3(w), h: r3(h) };
  }
  if (g.shape === 'circle') {
    const r = dist(a, b);
    if (r < 0.15) return null;
    return { ...base, x: r3(a.x), y: r3(a.y), r: r3(r) };
  }
  if (g.points.length < 4) return null;
  return { ...base, points: g.points.map((q) => [r3(q[0]), r3(q[1])]) };
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
    const z = g.shape === 'free' ? { ...zoneFrom({ ...g, points: [...g.points, [g.end.x, g.end.y]] }) } : zoneFrom(g);
    if (z && z.type) out = renderOne({ ...z, id: 'live' }, p, b, rot());
  } else if (g.kind === 'marker') {
    const st = activeServeType();
    const mk = { id: 'live', type: 'marker', symbol: state.markerSymbol, color: st ? st.color : state.color, x: g.end.x, y: g.end.y };
    if (dist(g.start, g.end) > 0.5 * s) mk.from = g.start;
    out = renderOne(mk, p, b, rot());
  }
  gLive.innerHTML = out;
}
