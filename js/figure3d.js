import { colorCss, esc } from './util.js';

/*
 * Anatomisch proportionierte Gliederpuppe für die Netzansicht (2D frontal und 3D).
 *
 * Proportionen relativ zur Körpergröße H (anthropometrische Standardwerte nach Drillis & Contini):
 *   Knöchelhöhe 0,039 · Unterschenkel 0,246 · Oberschenkel 0,245 (→ Hüfte 0,53) · Schulterhöhe 0,818
 *   Oberarm 0,186 · Unterarm 0,146 · Hand 0,108 · Schulterbreite 0,259 · Hüftbreite 0,191 · Fußlänge 0,152 · Kopf 0,13
 * Gelenkwinkel in Grad, mit anatomischen Grenzen (Knie/Ellbogen 0–150° usw.).
 * Haltung: Beine L/R { hf Hüftbeugung, ha Abspreizen, kn Knie, fp Fußspitze (+ = Zehenstand) }
 *          Arme L/R  { sf Schulter vorheben (0 = hängend, 180 = gestreckt oben), sa seitlich, el Ellbogen, wr Handgelenk }
 *          Rumpf { lean Vorneigung, twist Drehung (+ = nach links), side Seitneigung, head Kopfneigung (+ = nach unten) }
 * Lokale Achsen: x = rechts der Figur, y = oben, z = Blickrichtung. Schlagarm = rechts.
 * Die Figur wird so angehoben, dass der tiefste Fußpunkt den Boden berührt (+ Sprunghöhe) – keine Füße im Boden.
 */

const P = {
  ankle: 0.039, shank: 0.246, thigh: 0.245, hipW: 0.0955, torso: 0.288, shW: 0.1295, shDrop: 0.012,
  upper: 0.186, fore: 0.146, hand: 0.108, neck: 0.05, head: 0.065, footLen: 0.152, heel: 0.04,
  r: { thigh: 0.058, shank: 0.04, foot: 0.024, upper: 0.034, fore: 0.027, hand: 0.02, neck: 0.03, waist: 0.075, chest: 0.09 },
};

const leg = (hf = 0, ha = 4, kn = 4, fp = 0) => ({ hf, ha, kn, fp });
const arm = (sf = 8, sa = 8, el = 12, wr = 0) => ({ sf, sa, el, wr });
const pose = (o) => ({ lean: 3, twist: 0, side: 0, head: 0, L: leg(), R: leg(), aL: arm(), aR: arm(), ...o });

/** Haltungs-Bibliothek (rechtshändiger Angreifer) */
export const POSES = {
  stand: pose({}),
  reach: pose({ aR: arm(178, 6, 0, 0), aL: arm(30, 25, 80) }), // Reichhöhe (früheres Standardbild)
  ready: pose({ lean: 18, L: leg(25, 10, 40, 0), R: leg(25, 10, 40, 0), aL: arm(45, 15, 70), aR: arm(45, 15, 70) }),
  run1: pose({ lean: 16, L: leg(42, 4, 35, 0), R: leg(-22, 4, 30, 25), aL: arm(-25, 8, 35), aR: arm(35, 8, 45) }),
  run2: pose({ lean: 18, L: leg(-18, 4, 40, 25), R: leg(45, 4, 35, 0), aL: arm(30, 8, 45), aR: arm(-30, 8, 30) }),
  plant: pose({ lean: 32, head: -10, L: leg(55, 6, 72, -12), R: leg(30, 8, 85, 8), aL: arm(-62, 12, 12, 0), aR: arm(-62, 12, 12, 0) }),
  takeoff: pose({ lean: 8, head: -20, L: leg(8, 4, 12, 35), R: leg(8, 4, 12, 35), aL: arm(125, 12, 18), aR: arm(130, 12, 18) }),
  cock: pose({ lean: -12, twist: -28, head: -25, L: leg(32, 6, 62, 30), R: leg(28, 6, 70, 30), aL: arm(150, 12, 10, 0), aR: arm(158, 42, 118, 25) }),
  hitLine: pose({ lean: 14, twist: 0, head: -18, L: leg(22, 6, 38, 30), R: leg(18, 6, 42, 30), aL: arm(70, 10, 70), aR: arm(176, 8, 2, -35) }),
  hitCross: pose({ lean: 14, twist: -30, side: 6, head: -18, L: leg(22, 6, 38, 30), R: leg(18, 6, 42, 30), aL: arm(60, 20, 75), aR: arm(172, 26, 4, -40) }),
  follow: pose({ lean: 34, twist: 8, L: leg(18, 6, 28, 20), R: leg(16, 6, 30, 20), aL: arm(25, 12, 45), aR: arm(55, 10, 12, -20) }),
  land: pose({ lean: 26, L: leg(48, 8, 72, 0), R: leg(44, 8, 70, 0), aL: arm(55, 22, 45), aR: arm(50, 22, 45) }),
  setReady: pose({ lean: 4, head: -22, L: leg(14, 8, 22, 0), R: leg(10, 8, 18, 0), aL: arm(162, 22, 105, 40), aR: arm(162, 22, 105, 40) }),
  set: pose({ lean: 0, head: -25, L: leg(6, 6, 8, 12), R: leg(6, 6, 8, 12), aL: arm(172, 16, 18, 20), aR: arm(172, 16, 18, 20) }),
  cover: pose({ lean: 28, L: leg(40, 14, 62, 0), R: leg(40, 14, 62, 0), aL: arm(48, 18, 55), aR: arm(48, 18, 55) }),
  blockReady: pose({ lean: 6, head: -8, L: leg(22, 10, 42, 0), R: leg(22, 10, 42, 0), aL: arm(95, 22, 85, 10), aR: arm(95, 22, 85, 10) }),
  blockStep: pose({ lean: 8, L: leg(18, 22, 38, 0), R: leg(14, 4, 34, 10), aL: arm(95, 25, 85, 10), aR: arm(95, 25, 85, 10) }),
  blockJump: pose({ lean: 6, head: -12, L: leg(6, 5, 16, 32), R: leg(6, 5, 16, 32), aL: arm(162, 9, 4, 15), aR: arm(162, 9, 4, 15) }),
};
export const POSE_LABELS = [
  ['reach', 'Arm gestreckt'], ['stand', 'Stand'], ['ready', 'Bereit'], ['run1', 'Anlauf 1'], ['run2', 'Anlauf 2'],
  ['plant', 'Stemmschritt'], ['takeoff', 'Absprung'], ['cock', 'Ausholen'], ['hitLine', 'Schlag Line'], ['hitCross', 'Schlag Cross'],
  ['follow', 'Nachschwung'], ['land', 'Landung'], ['setReady', 'Zuspiel bereit'], ['set', 'Zuspiel'], ['cover', 'Absichern'],
  ['blockReady', 'Block bereit'], ['blockStep', 'Block-Seitschritt'], ['blockJump', 'Block-Sprung'],
];

// ---------- Gelenkgrenzen ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function limit(p) {
  const L = (l) => ({ hf: clamp(l.hf, -30, 120), ha: clamp(l.ha, -10, 45), kn: clamp(l.kn, 0, 150), fp: clamp(l.fp, -25, 45) });
  const A = (a) => ({ sf: clamp(a.sf, -70, 185), sa: clamp(a.sa, -10, 120), el: clamp(a.el, 0, 150), wr: clamp(a.wr, -60, 60) });
  return { lean: clamp(p.lean, -25, 60), twist: clamp(p.twist, -45, 45), side: clamp(p.side, -20, 20), head: clamp(p.head, -40, 40), L: L(p.L), R: L(p.R), aL: A(p.aL), aR: A(p.aR) };
}

/** Haltung einer Figur – auch zwischen zwei Haltungen überblendet (Animation: poseA → poseB, poseT) */
export function poseOf(el) {
  const get = (n) => POSES[n] || POSES.reach;
  if (el.poseA && el.poseB) {
    const a = get(el.poseA), b = get(el.poseB), t = el.poseT ?? 0;
    const mix = (x, y) => x + (y - x) * t;
    const mixObj = (o, q) => Object.fromEntries(Object.keys(o).map((k) => [k, mix(o[k], q[k])]));
    return limit({ lean: mix(a.lean, b.lean), twist: mix(a.twist, b.twist), side: mix(a.side, b.side), head: mix(a.head, b.head),
      L: mixObj(a.L, b.L), R: mixObj(a.R, b.R), aL: mixObj(a.aL, b.aL), aR: mixObj(a.aR, b.aR) });
  }
  return limit(get(el.pose));
}

// ---------- Rotationen (3×3, zeilenweise) ----------
const rad = (d) => (d * Math.PI) / 180;
const Rx = (d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const Ry = (d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const Rz = (d) => { const c = Math.cos(rad(d)), s = Math.sin(rad(d)); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const mul = (A, B) => [
  A[0] * B[0] + A[1] * B[3] + A[2] * B[6], A[0] * B[1] + A[1] * B[4] + A[2] * B[7], A[0] * B[2] + A[1] * B[5] + A[2] * B[8],
  A[3] * B[0] + A[4] * B[3] + A[5] * B[6], A[3] * B[1] + A[4] * B[4] + A[5] * B[7], A[3] * B[2] + A[4] * B[5] + A[5] * B[8],
  A[6] * B[0] + A[7] * B[3] + A[8] * B[6], A[6] * B[1] + A[7] * B[4] + A[8] * B[7], A[6] * B[2] + A[7] * B[5] + A[8] * B[8],
];
const ap = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/**
 * Gelenkpunkte in Weltkoordinaten (X seitlich ab linker Seitenlinie, Y Höhe, Z Tiefe ab Netz).
 * el: { x, d (Tiefe), sprung, groesse, team, face (Blickrichtung in Grad; 0 = zum Netz für eigenes Team) }
 */
export function figurePoints(el, depth) {
  const H = el.groesse || 1.8, k = (n) => n * H;
  const p = poseOf(el);
  // --- lokal (Becken im Ursprung) ---
  const pts = {};
  const hip = (side) => [side * k(P.hipW), 0, 0];
  const legPts = (side, l) => {
    const ab = side * l.ha;
    const Rt = mul(Rz(ab), Rx(-l.hf));
    const h0 = hip(side);
    const knee = add(h0, ap(Rt, [0, -k(P.thigh), 0]));
    const Rs = mul(Rt, Rx(l.kn));
    const ank = add(knee, ap(Rs, [0, -k(P.shank), 0]));
    // Fuß: unabhängig ausgerichtet (flach, Fußspitze nach unten bei fp > 0), zeigt in Gehrichtung
    const Rf = mul(Rz(ab * 0.3), Rx(-l.fp));
    const heel = add(ank, ap(Rf, [0, -k(P.ankle), -k(P.heel)]));
    const toe = add(ank, ap(Rf, [0, -k(P.ankle), k(P.footLen - P.heel)]));
    return { hip: h0, knee, ank, heel, toe };
  };
  const Lg = legPts(-1, p.L), Rg = legPts(1, p.R);
  const Rt = mul(mul(Ry(p.twist * 0.7), Rx(p.lean)), Rz(-p.side)); // Rumpf
  const waist = ap(mul(Ry(p.twist * 0.3), Rx(p.lean * 0.5)), [0, k(0.1), 0]);
  const chest = ap(Rt, [0, k(P.torso), 0]);
  const shL = add(chest, ap(Rt, [-k(P.shW), -k(P.shDrop), 0])), shR = add(chest, ap(Rt, [k(P.shW), -k(P.shDrop), 0]));
  const neck = add(chest, ap(Rt, [0, k(P.neck), 0]));
  const headC = add(neck, ap(mul(Rt, Rx(p.head)), [0, k(P.head) * 0.95, k(0.01)]));
  const armPts = (side, a, sh) => {
    const Ra = mul(Rt, mul(Rz(side * a.sa), Rx(-a.sf)));
    const elb = add(sh, ap(Ra, [0, -k(P.upper), 0]));
    const Rf = mul(Ra, Rx(-a.el));
    const wri = add(elb, ap(Rf, [0, -k(P.fore), 0]));
    const Rh = mul(Rf, Rx(-a.wr));
    const tip = add(wri, ap(Rh, [0, -k(P.hand), 0]));
    return { sh, elb, wri, tip };
  };
  const AL = armPts(-1, p.aL, shL), AR = armPts(1, p.aR, shR);
  Object.assign(pts, { hipL: Lg.hip, kneeL: Lg.knee, ankL: Lg.ank, heelL: Lg.heel, toeL: Lg.toe, hipR: Rg.hip, kneeR: Rg.knee, ankR: Rg.ank, heelR: Rg.heel, toeR: Rg.toe,
    waist, chest, neck, head: headC, shL, elbL: AL.elb, wriL: AL.wri, tipL: AL.tip, shR, elbR: AR.elb, wriR: AR.wri, tipR: AR.tip });
  // --- auf den Boden stellen (+ Sprung), drehen und an die Position setzen ---
  const minY = Math.min(Lg.heel[1], Lg.toe[1], Rg.heel[1], Rg.toe[1]);
  const lift = -minY + (el.sprung || 0);
  const face = el.face ?? (el.team === 'opp' ? 180 : 0);
  const Rw = Ry(face);
  const root = [el.x, lift, depth];
  const out = {};
  for (const [n, v] of Object.entries(pts)) {
    const w = ap(Rw, v);
    out[n] = [root[0] + w[0], root[1] + w[1], root[2] + w[2]];
  }
  return out;
}

/** Höchster Handpunkt (z. B. Treffpunkt beim Schlag) */
export function handTop(el, depth) {
  const q = figurePoints(el, depth);
  return q.tipR[1] >= q.tipL[1] ? q.tipR : q.tipL;
}

const SEGS = [
  ['thigh', 'hipL', 'kneeL'], ['shank', 'kneeL', 'ankL'], ['foot', 'heelL', 'toeL'],
  ['thigh', 'hipR', 'kneeR'], ['shank', 'kneeR', 'ankR'], ['foot', 'heelR', 'toeR'],
  ['waist', 'mid', 'waist'], ['chest', 'waist', 'chest'], ['neck', 'chest', 'neck'],
  ['upper', 'shL', 'elbL'], ['fore', 'elbL', 'wriL'], ['hand', 'wriL', 'tipL'],
  ['upper', 'shR', 'elbR'], ['fore', 'elbR', 'wriR'], ['hand', 'wriR', 'tipR'],
];
const f4 = (n) => Math.round(n * 10000) / 10000;
const shade = (hex, amt) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * (1 + amt))));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
};

/**
 * Figur zeichnen. project(X,Y,Z) → { p:[sx,sy], k (Bildeinheiten pro Meter), dz (Abstand zur Kamera) } | null
 * Gliedmaßen als runde „Röhren“ mit Umriss, Grundfarbe und Glanzlicht, von hinten nach vorn sortiert.
 */
export function figureMarkup(el, depth, project, { hit = true, label = true } = {}) {
  const H = el.groesse || 1.8;
  const q = figurePoints(el, depth);
  q.mid = [(q.hipL[0] + q.hipR[0]) / 2, (q.hipL[1] + q.hipR[1]) / 2, (q.hipL[2] + q.hipR[2]) / 2];
  const base = /^#/.test(el.color || '') ? el.color : el.team === 'opp' ? '#dc2626' : '#2563eb';
  const col = colorCss(base), dark = shade(base, -0.45), light = shade(base, 0.55);
  const items = [];
  const P2 = (n) => project(...q[n]);
  // Rumpf als Fläche (Schultern → Hüften)
  const torso = ['shL', 'shR', 'hipR', 'hipL'].map(P2);
  if (torso.every(Boolean)) {
    const dz = torso.reduce((a, t) => a + t.dz, 0) / 4;
    const d = torso.map((t, i) => `${i ? 'L' : 'M'}${f4(t.p[0])} ${f4(t.p[1])}`).join('') + 'Z';
    const w = P.r.waist * H * torso[0].k;
    items.push({ dz, s: `<path d="${d}" style="fill:${col};stroke:${dark};stroke-width:${f4(w * 0.5)};stroke-linejoin:round"/><path d="${d}" style="fill:none;stroke:${col};stroke-width:${f4(w * 0.35)};stroke-linejoin:round"/>` });
  }
  for (const [kind, a, b] of SEGS) {
    const A = P2(a), B = P2(b);
    if (!A || !B) continue;
    const k = (A.k + B.k) / 2, r = P.r[kind] * H * k;
    const d = `M${f4(A.p[0])} ${f4(A.p[1])}L${f4(B.p[0])} ${f4(B.p[1])}`;
    items.push({
      dz: (A.dz + B.dz) / 2,
      s: `<path d="${d}" style="stroke:${dark};stroke-width:${f4(r * 2 + Math.max(0.0015, r * 0.35))};stroke-linecap:round;fill:none"/>` +
        `<path d="${d}" style="stroke:${col};stroke-width:${f4(r * 2)};stroke-linecap:round;fill:none"/>` +
        `<path d="${d}" style="stroke:${light};stroke-opacity:.45;stroke-width:${f4(r * 0.6)};stroke-linecap:round;fill:none;transform:translate(${f4(-r * 0.35)}px,${f4(-r * 0.35)}px)"/>`,
    });
  }
  const Hd = P2('head');
  if (Hd) {
    const r = P.head * H * Hd.k;
    items.push({ dz: Hd.dz, s: `<circle cx="${f4(Hd.p[0])}" cy="${f4(Hd.p[1])}" r="${f4(r)}" style="fill:${col};stroke:${dark};stroke-width:${f4(r * 0.18)}"/><circle cx="${f4(Hd.p[0] - r * 0.3)}" cy="${f4(Hd.p[1] - r * 0.3)}" r="${f4(r * 0.35)}" style="fill:${light};opacity:.45"/>` });
  }
  items.sort((a, b) => b.dz - a.dz);
  // Schatten am Boden (wird mit der Sprunghöhe kleiner)
  const g = project(q.mid[0], 0, q.mid[2]);
  let out = '';
  if (g) {
    const rr = 0.22 * H * g.k / (1 + (el.sprung || 0));
    out += `<ellipse cx="${f4(g.p[0])}" cy="${f4(g.p[1])}" rx="${f4(rr)}" ry="${f4(rr * 0.3)}" style="fill:rgba(0,0,0,.28)"/>`;
  }
  out += items.map((i) => i.s).join('');
  // Trefferfläche (Bounding-Box) und Beschriftung über der höchsten Hand
  const all = Object.keys(q).map(P2).filter(Boolean);
  if (all.length) {
    const xs = all.map((t) => t.p[0]), ys = all.map((t) => t.p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pad = (x1 - x0) * 0.15 + 0.005;
    if (hit) out = `<rect class="hit-a" x="${f4(x0 - pad)}" y="${f4(y0 - pad)}" width="${f4(x1 - x0 + 2 * pad)}" height="${f4(y1 - y0 + 2 * pad)}"/>` + out;
    if (label) {
      const top = q.tipR[1] >= q.tipL[1] ? q.tipR : q.tipL;
      const T = project(...top);
      const nm = el.short || (el.label || '').split(/\s+/)[0] || '';
      const raised = top[1] > q.head[1];
      const txt = `${nm ? `<tspan class="sil-nm">${esc(nm)}</tspan>` : ''}${raised ? ` ${(Math.round(top[1] * 100) / 100).toFixed(2).replace('.', ',')} m` : ''}`;
      if (T && txt) {
        const fs = Math.max(0.02, 0.13 * T.k);
        out += `<text class="sil-lbl" x="${f4(T.p[0])}" y="${f4(T.p[1] - fs * 0.6)}" text-anchor="middle" style="font-size:${f4(fs)}px;stroke-width:${f4(fs * 0.25)}px">${txt}</text>`;
      }
    }
  }
  return out;
}
