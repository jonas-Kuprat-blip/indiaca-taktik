import { FIELDS } from './model.js';
import { colorCss, esc } from './util.js';
import { netCfg, NET_BAND, ANTENNA, silMarkup, fmtM } from './net.js';

/*
 * 3D-Perspektive der Netzansicht – eigene, leichte Projektion in SVG (kein WebGL, keine Bibliothek).
 * Welt: X = seitlich ab linker Seitenlinie, Y = Höhe, Z = Tiefe (0 = Netz, + = gegnerische Hälfte, − = eigene).
 * Kamera: Augenhöhe 1,70 m an der eigenen 3-m-Linie, schaut aufs Netz; Schwenk (yaw) per Wischen.
 * Die Daten bleiben 2D (x, Höhe): Marker liegen in der Netzebene, Silhouetten knapp davor bzw. dahinter.
 */
const EYE = 1.7, NEAR = 0.25, FOCAL = 1;
export const VIEWBOX_3D = '-1.25 -0.82 2.5 1.6';
const f = (n) => Math.round(n * 10000) / 10000;

export function render3d(pg, b, yaw = 0) {
  const F = FIELDS[b.fieldType] || FIELDS.indiaca;
  const W = F.width, L2 = F.length / 2, A = F.attack, H = netCfg(pg).hoehe;
  const cam = { x: W / 2, y: EYE, z: -A };
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const view = ([X, Y, Z]) => {
    const dx = X - cam.x, dz = Z - cam.z;
    return [dx * c - dz * s, Y - cam.y, dx * s + dz * c];
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
  s3 += poly([[-4, 0, -L2 - 3], [W + 4, 0, -L2 - 3], [W + 4, 0, L2 + 3], [-4, 0, L2 + 3]], 'class="f-out"');
  s3 += poly([[-4, 0, L2 + 3], [W + 4, 0, L2 + 3], [W + 4, 7, L2 + 3], [-4, 7, L2 + 3]], 'class="nv-wall"');
  s3 += poly([[-4, 2.2, L2 + 2.99], [W + 4, 2.2, L2 + 2.99]], 'class="nv-wall-band" style="stroke-width:0.004"');
  // Spielfeld beide Hälften
  s3 += poly([[0, 0, -L2], [W, 0, -L2], [W, 0, 0], [0, 0, 0]], 'class="f-court"');
  s3 += poly([[0, 0, 0], [W, 0, 0], [W, 0, L2], [0, 0, L2]], 'class="f-court nv-far"');
  const LW = 'class="f-line" style="stroke-width:0.006;fill:none"';
  for (const z of [-L2, -A, 0, A, L2]) s3 += line([0, 0, z], [W, 0, z], LW);
  s3 += line([0, 0, -L2], [0, 0, L2], LW) + line([W, 0, -L2], [W, 0, L2], LW);

  // Silhouetten als Billboards (Gegner hinter dem Netz, eigene davor)
  const sils = pg.elements.filter((e) => e.type === 'sil');
  const silAt = (el, Z) => {
    const g = pt(el.x, 0, Z);
    if (!g) return '';
    return `<g transform="translate(${f(g.p[0] - el.x * g.k)} ${f(g.p[1])}) scale(${f(g.k)})">${silMarkup(el)}</g>`;
  };
  s3 += sils.filter((e) => e.team === 'opp').map((e) => silAt(e, 0.9)).join('');

  // Netz: Maschen, Band, Pfosten, Antennen
  s3 += poly([[-0.5, H - NET_BAND, 0], [W + 0.5, H - NET_BAND, 0], [W + 0.5, H, 0], [-0.5, H, 0]], 'class="nv3-mesh"');
  for (let x = -0.5; x <= W + 0.5; x += 0.25) s3 += line([x, H - NET_BAND, 0], [x, H, 0], 'class="nv3-ml"');
  for (let y = H - NET_BAND; y <= H; y += 0.15) s3 += line([-0.5, y, 0], [W + 0.5, y, 0], 'class="nv3-ml"');
  s3 += line([-0.5, H, 0], [W + 0.5, H, 0], 'class="nv3-band"');
  s3 += line([-0.5, 0, 0], [-0.5, H + 0.12, 0], 'class="nv3-post"') + line([W + 0.5, 0, 0], [W + 0.5, H + 0.12, 0], 'class="nv3-post"');
  for (const ax of [0, W]) for (let y = H - NET_BAND, i = 0; y < H + ANTENNA - 0.001; y += 0.1, i++)
    s3 += line([ax, y, 0], [ax, Math.min(H + ANTENNA, y + 0.1), 0], `class="nv3-ant ${i % 2 ? 'w' : 'r'}"`);

  // Linien zwischen Markern, Marker in der Netzebene
  const byId = Object.fromEntries(pg.elements.map((e) => [e.id, e]));
  for (const e of pg.elements) if (e.type === 'link' && byId[e.a] && byId[e.b]) {
    const a = byId[e.a], q = byId[e.b];
    s3 += line([a.x, -a.y, 0], [q.x, -q.y, 0], `style="stroke:${colorCss(e.color || a.color)};stroke-width:0.006;stroke-dasharray:0.018 0.014;fill:none"`);
  }
  for (const e of pg.elements) {
    if (e.type !== 'marker') continue;
    const m = pt(e.x, -e.y, 0);
    if (!m) continue;
    const r = Math.max(0.012, 0.14 * m.k * (e.size || 1)), col = colorCss(e.color);
    const [x, y] = m.p;
    // Fußpunkt-Lot zum Boden als Höhenhilfe
    const g = pt(e.x, 0, 0);
    if (g) s3 += `<line x1="${f(x)}" y1="${f(y)}" x2="${f(g.p[0])}" y2="${f(g.p[1])}" style="stroke:${col};stroke-width:0.003;stroke-dasharray:0.01 0.01;opacity:.7"/>`;
    if (e.symbol === 'ring') s3 += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" style="fill:none;stroke:${col};stroke-width:${f(r * 0.4)}"/>`;
    else if (e.symbol === 'dot') s3 += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" style="fill:${col}"/>`;
    else s3 += `<path d="M${f(x - r)} ${f(y - r)}L${f(x + r)} ${f(y + r)}M${f(x - r)} ${f(y + r)}L${f(x + r)} ${f(y - r)}" style="stroke:${col};stroke-width:${f(r * 0.45)};stroke-linecap:round"/>`;
    const t = `${e.label ? esc(e.label) + ' · ' : ''}${fmtM(-e.y)}`;
    s3 += `<text class="nv3-lbl" x="${f(x + r * 1.4)}" y="${f(y - r * 1.2)}">${t}</text>`;
  }
  // eigene Spieler stehen nah vor der Kamera → halbtransparent, damit Marker sichtbar bleiben
  s3 += `<g style="opacity:.6">${sils.filter((e) => e.team !== 'opp').map((e) => silAt(e, -0.6)).join('')}</g>`;
  return s3;
}

