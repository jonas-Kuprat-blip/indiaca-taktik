import { FIELDS } from './model.js';
import { colorCss, esc } from './util.js';
import { symbolMarkup } from './render.js';
import { netCfg, NET_BAND, ANTENNA, fmtM } from './net.js';
import { figureMarkup } from './figure3d.js';

/*
 * 3D-Perspektive der Netzansicht – eigene, leichte Projektion in SVG (kein WebGL, keine Bibliothek).
 * Welt: X = seitlich ab linker Seitenlinie, Y = Höhe, Z = Tiefe (0 = Netz, + = gegnerische Hälfte, − = eigene).
 * Kamera: frei drehbar (Orbit), Start auf Augenhöhe 1,70 m an der eigenen 3-m-Linie, gerade aufs Netz.
 * Die Daten bleiben 2D (x, Höhe): Marker liegen in der Netzebene, Silhouetten knapp davor bzw. dahinter.
 */
const EYE = 1.7, NEAR = 0.25, FOCAL = 1;
export const VIEWBOX_3D = '-1.25 -0.82 2.5 1.6';
const f = (n) => Math.round(n * 10000) / 10000;

/** Tiefe der Silhouetten: eigene knapp vor dem Netz, Gegner dahinter */
export const SIL_Z = { own: -0.6, opp: 0.9 };
export const silZ = (e) => (typeof e.d === 'number' ? e.d : e.team === 'opp' ? SIL_Z.opp : SIL_Z.own);
/** Tiefe eines Elements (Meter ab Netz: − eigene Hälfte, + gegnerische Hälfte); Marker standardmäßig in der Netzebene */
export const depthOf = (e) => (e.type === 'sil' ? silZ(e) : typeof e.d === 'number' ? e.d : 0);

/**
 * Freie Orbit-Kamera: { az (Drehung, rad), el (Neigung, rad; + = von oben), dist (m), tx, ty, tz (Blickziel) }.
 * Standard: Augenhöhe 1,70 m an der eigenen 3-m-Linie, gerade aufs Netz.
 */
export function defaultCam3(b) {
  const F = FIELDS[b.fieldType] || FIELDS.indiaca;
  return { az: 0, el: 0, dist: F.attack, tx: F.width / 2, ty: EYE, tz: 0 };
}
function camera(b, cam) {
  const F = FIELDS[b.fieldType] || FIELDS.indiaca;
  const ca = Math.cos(cam.az), sa = Math.sin(cam.az), ce = Math.cos(cam.el), se = Math.sin(cam.el);
  // Kamera steht „hinter“ dem Ziel entgegen der Blickrichtung
  const fx = sa * ce, fy = -se, fz = ca * ce;
  return { F, x: cam.tx - fx * cam.dist, y: cam.ty - fy * cam.dist, z: cam.tz - fz * cam.dist, cp: ce, sp: se, c: ca, s: sa };
}
/** Achsen der Kamera (für Verschieben am Bildschirm) */
export function camAxes(cam) {
  const ca = Math.cos(cam.az), sa = Math.sin(cam.az), ce = Math.cos(cam.el), se = Math.sin(cam.el);
  return { right: [ca, 0, -sa], up: [sa * se, ce, ca * se] };
}

/**
 * Bildpunkt (viewBox-Koordinaten) → Schnittpunkt mit einer achsparallelen Ebene (zum Verschieben in 3D).
 * axis 'z': Ebene Z = val (frontal: seitlich + Höhe) · 'x': Ebene X = val (von der Seite: Tiefe + Höhe)
 * axis 'y': Ebene Y = val (von oben/Boden: seitlich + Tiefe)
 */
export function unproject3d(b, cam, sx, sy, axis, val) {
  const { x, y, z, cp, sp, c, s } = camera(b, cam);
  const vx = sx / FOCAL, vy = -sy / FOCAL, vz = 1;
  const dy = vy * cp - vz * sp, z1 = vy * sp + vz * cp;
  const dx = vx * c + z1 * s, dz = -vx * s + z1 * c;
  const o = { x, y, z }, d = { x: dx, y: dy, z: dz };
  if (Math.abs(d[axis]) < 1e-6) return null;
  const t = (val - o[axis]) / d[axis];
  if (t <= 0) return null;
  return { X: x + dx * t, Y: y + dy * t, Z: z + dz * t };
}

export function render3d(pg, b, cam3 = defaultCam3(b)) {
  const { F, x: camX, y: camY, z: camZ, cp, sp, c, s } = camera(b, cam3);
  const W = F.width, L2 = F.length / 2, A = F.attack, H = netCfg(pg).hoehe;
  const cam = { x: camX, y: camY, z: camZ };
  const view = ([X, Y, Z]) => {
    const dx = X - cam.x, dz = Z - cam.z, dy = Y - cam.y;
    const x1 = dx * c - dz * s, z1 = dx * s + dz * c;
    return [x1, dy * cp + z1 * sp, -dy * sp + z1 * cp];
  };
  const proj = ([x, y, z]) => [FOCAL * x / z, -FOCAL * y / z];
  // Polygon an der Nahebene abschneiden (Sutherland-Hodgman, eine Ebene)
  const clip = (pts) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], q = pts[(i + 1) % pts.length];
      const ina = a[2] >= NEAR, inb = q[2] >= NEAR;
      if (ina) out.push(a);
      if (ina !== inb) {
        const t = (NEAR - a[2]) / (q[2] - a[2]);
        out.push([a[0] + (q[0] - a[0]) * t, a[1] + (q[1] - a[1]) * t, NEAR]);
      }
    }
    return out;
  };
  const poly = (world, attrs) => {
    const P = clip(world.map(view));
    if (P.length < 2) return '';
    const d = P.map(proj).map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('') + (P.length > 2 ? 'Z' : '');
    return `<path d="${d}" ${attrs}/>`;
  };
  const line = (p, q, attrs) => poly([p, q], attrs);
  const pt = (X, Y, Z) => {
    const v = view([X, Y, Z]);
    return v[2] < NEAR ? null : { p: proj(v), k: FOCAL / v[2] };
  };

  let s3 = '';
  // Halle: Boden, Rückwand
  s3 += poly([[-6, 0, -L2 - 30], [W + 6, 0, -L2 - 30], [W + 6, 0, L2 + 3], [-6, 0, L2 + 3]], 'class="f-out"');
  s3 += poly([[-6, 0, L2 + 3], [W + 6, 0, L2 + 3], [W + 6, 8, L2 + 3], [-6, 8, L2 + 3]], 'class="nv-wall"');
  // Seitenwände angedeutet
  s3 += poly([[-6, 0, -L2 - 30], [-6, 0, L2 + 3], [-6, 8, L2 + 3], [-6, 8, -L2 - 30]], 'class="nv-wall nv3-side"');
  s3 += poly([[W + 6, 0, -L2 - 30], [W + 6, 0, L2 + 3], [W + 6, 8, L2 + 3], [W + 6, 8, -L2 - 30]], 'class="nv-wall nv3-side"');
  s3 += poly([[-4, 2.2, L2 + 2.99], [W + 4, 2.2, L2 + 2.99]], 'class="nv-wall-band" style="stroke-width:0.004"');
  // Spielfeld beide Hälften
  s3 += poly([[0, 0, -L2], [W, 0, -L2], [W, 0, 0], [0, 0, 0]], 'class="f-court"');
  s3 += poly([[0, 0, 0], [W, 0, 0], [W, 0, L2], [0, 0, L2]], 'class="f-court nv-far"');
  const LW = 'class="f-line" style="stroke-width:0.006;fill:none"';
  for (const z of [-L2, -A, 0, A, L2]) s3 += line([0, 0, z], [W, 0, z], LW);
  s3 += line([0, 0, -L2], [0, 0, L2], LW) + line([W, 0, -L2], [W, 0, L2], LW);

  // Netz: Maschen, Band, Pfosten, Antennen (wird zwischen den Objekten eingefügt)
  let NET = '';
  NET += poly([[-0.5, H - NET_BAND, 0], [W + 0.5, H - NET_BAND, 0], [W + 0.5, H, 0], [-0.5, H, 0]], 'class="nv3-mesh"');
  for (let x = -0.5; x <= W + 0.5; x += 0.25) NET += line([x, H - NET_BAND, 0], [x, H, 0], 'class="nv3-ml"');
  for (let y = H - NET_BAND; y <= H; y += 0.15) NET += line([-0.5, y, 0], [W + 0.5, y, 0], 'class="nv3-ml"');
  NET += line([-0.5, H, 0], [W + 0.5, H, 0], 'class="nv3-band"');
  NET += line([-0.5, 0, 0], [-0.5, H + 0.12, 0], 'class="nv3-post"') + line([W + 0.5, 0, 0], [W + 0.5, H + 0.12, 0], 'class="nv3-post"');
  for (const ax of [0, W]) for (let y = H - NET_BAND, i = 0; y < H + ANTENNA - 0.001; y += 0.1, i++)
    NET += line([ax, y, 0], [ax, Math.min(H + ANTENNA, y + 0.1), 0], `class="nv3-ant ${i % 2 ? 'w' : 'r'}"`);

  // Objekte (Silhouetten, Marker, Linien) mit Tiefe: auf der kameraabgewandten Netzseite vor dem Netz zeichnen,
  // sonst danach – jeweils von hinten nach vorn
  const camSide = camZ < 0 ? -1 : 1;
  const objs = [];
  // Figuren als echte 3D-Gliederpuppen (aus jedem Blickwinkel richtig)
  const proj3 = (X, Y, Z) => {
    const v = view([X, Y, Z]);
    return v[2] < NEAR ? null : { p: proj(v), k: FOCAL / v[2], dz: v[2] };
  };
  const silAt = (el) => `<g class="el sil" data-id="${esc(el.id)}">${figureMarkup(el, silZ(el), proj3)}</g>`;
  const markerAt = (e) => {
    const Z = depthOf(e);
    const m = pt(e.x, -e.y, Z);
    if (!m) return '';
    const r = Math.max(0.012, 0.14 * m.k * (e.size || 1)), col = colorCss(e.color);
    const [x, y] = m.p;
    let o = '';
    // berechnete Flugkurve (Physik) gestrichelt
    if (Array.isArray(e.trail) && e.trail.length > 1)
      for (let i = 1; i < e.trail.length; i++) o += line(e.trail[i - 1], e.trail[i], `style="stroke:${col};stroke-width:0.005;stroke-dasharray:0.014 0.01;fill:none;opacity:.85"`);
    o += `<g class="el mk3" data-id="${esc(e.id)}"><circle class="hit-a" cx="${f(x)}" cy="${f(y)}" r="${f(Math.max(0.035, r * 1.8))}"/>`;
    // Lot zum Boden + Bodenpunkt als Höhen-/Tiefenhilfe
    const g = pt(e.x, 0, Z);
    if (g) o += `<line x1="${f(x)}" y1="${f(y)}" x2="${f(g.p[0])}" y2="${f(g.p[1])}" style="stroke:${col};stroke-width:0.003;stroke-dasharray:0.01 0.01;opacity:.7"/><ellipse cx="${f(g.p[0])}" cy="${f(g.p[1])}" rx="${f(r * 0.9)}" ry="${f(r * 0.35)}" style="fill:rgba(0,0,0,.3)"/>`;
    if (e.symbol === 'indiaca') o += `<g transform="translate(${f(x)} ${f(y)}) scale(${f(r * 2.2)})">${symbolMarkup('indiaca', e.color, 1)}</g>`;
    else if (e.symbol === 'ring') o += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" style="fill:none;stroke:${col};stroke-width:${f(r * 0.4)}"/>`;
    else if (e.symbol === 'dot') o += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" style="fill:${col}"/>`;
    else o += `<path d="M${f(x - r)} ${f(y - r)}L${f(x + r)} ${f(y + r)}M${f(x - r)} ${f(y + r)}L${f(x + r)} ${f(y - r)}" style="stroke:${col};stroke-width:${f(r * 0.45)};stroke-linecap:round"/>`;
    const t = `${e.label ? esc(e.label) + ' · ' : ''}${fmtM(-e.y)}`;
    return o + `<text class="nv3-lbl" x="${f(x + r * 1.4)}" y="${f(y - r * 1.2)}">${t}</text></g>`;
  };
  const byId = Object.fromEntries(pg.elements.map((e) => [e.id, e]));
  for (const e of pg.elements) {
    if (e.type === 'sil') objs.push({ Z: silZ(e), X: e.x, Y: 1, near: true, html: () => silAt(e) });
    else if (e.type === 'marker') objs.push({ Z: depthOf(e), X: e.x, Y: -e.y, html: () => markerAt(e) });
    else if (e.type === 'link' && byId[e.a] && byId[e.b]) {
      const a = byId[e.a], q = byId[e.b];
      const za = depthOf(a), zq = depthOf(q);
      objs.push({ Z: (za + zq) / 2, X: (a.x + q.x) / 2, Y: (-a.y - q.y) / 2, html: () => line([a.x, -a.y, za], [q.x, -q.y, zq], `style="stroke:${colorCss(e.color || a.color)};stroke-width:0.006;stroke-dasharray:0.018 0.014;fill:none"`) });
    }
  }
  const dist = (o) => Math.hypot(o.X - camX, o.Y - camY, o.Z - camZ);
  objs.sort((a, q) => dist(q) - dist(a));
  const behind = objs.filter((o) => o.Z * camSide < -0.05);
  const front = objs.filter((o) => o.Z * camSide >= -0.05);
  s3 += behind.map((o) => o.html()).join('');
  s3 += NET;
  // nahe Silhouetten halbtransparent, damit Marker dahinter sichtbar bleiben
  s3 += front.map((o) => (o.near && Math.abs(o.Z - camZ) < 4 ? `<g style="opacity:.6">${o.html()}</g>` : o.html())).join('');
  return s3;
}

