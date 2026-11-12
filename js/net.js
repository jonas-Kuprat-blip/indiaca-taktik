import { FIELDS } from './model.js';
import { lib } from './library.js';
import { esc, colorCss, uid } from './util.js';
import { state } from './store.js';

/*
 * Seitentyp „Netzansicht“: frontale Sicht eines Spielers aufs Netz (2D, maßstabsgetreu).
 * Koordinaten: x = Meter ab linker Seitenlinie (0 … Feldbreite), y = −Höhe in Metern (Boden = 0, nach oben negativ).
 *   page.kind = 'netz' (oder Animationsseite mit page.net)
 *   page.net  = { preset, hoehe, hilfslinien, einrasten, legende: { farbe: Bedeutung } }
 * Netzhöhen nach CVJM-/IIA-Regeln (in den Einstellungen änderbar): lib.netHeights
 */
export const NET_PRESETS = [['herren', 'Herren'], ['damen', 'Damen'], ['mixed', 'Mixed'], ['jugend', 'Jugend'], ['manuell', 'Manuell']];
export const DEFAULT_NET_HEIGHTS = { herren: 2.35, damen: 2.2, mixed: 2.3, jugend: 2.25 };
export const DEFAULT_LEGEND = { '#ef4444': 'Angriff', '#3b82f6': 'Block', '#22c55e': 'Zuspiel', '#f59e0b': 'Angabe' };
export const NET_BAND = 0.9; // Höhe des Netzes (Maschen) unterhalb der Oberkante
export const ANTENNA = 1.0; // Antenne über der Netzoberkante

export const isNet = (p) => !!p && (p.kind === 'netz' || (p.kind === 'anim' && !!p.net));
export const netHeights = () => ({ ...DEFAULT_NET_HEIGHTS, ...(lib.netHeights || {}) });

export function netCfg(p) {
  const n = (p.net ||= {});
  if (!NET_PRESETS.some(([k]) => k === n.preset)) n.preset = 'herren';
  if (n.preset !== 'manuell') n.hoehe = netHeights()[n.preset];
  if (!(n.hoehe > 0.5 && n.hoehe < 4)) n.hoehe = DEFAULT_NET_HEIGHTS.herren;
  n.hilfslinien = !!n.hilfslinien;
  n.einrasten = !!n.einrasten;
  if (!n.legende || typeof n.legende !== 'object') n.legende = { ...DEFAULT_LEGEND };
  return n;
}
/** Netzhöhe der Seite in Metern */
export const netH = (p) => netCfg(p).hoehe;

/** Sichtbereich in Seitenkoordinaten */
export function netBox(ft, p) {
  const W = (FIELDS[ft] || FIELDS.indiaca).width;
  const top = Math.max(3.9, netH(p) + ANTENNA + 0.6);
  return { x0: -1.35, x1: W + 1.1, y0: -top, y1: 0.75 };
}
export function netViewBox(ft, p) {
  const b = netBox(ft, p);
  return `${b.x0} ${b.y0} ${b.x1 - b.x0} ${b.y1 - b.y0}`;
}

const f = (n) => Math.round(n * 1000) / 1000;
export const fmtM = (v) => (Math.round(v * 100) / 100).toFixed(2).replace('.', ',') + ' m';

/** Hintergrund: Boden, gegnerische Hälfte (angedeutet), Hallenwand, Netz, Antennen, Höhenskala */
export function renderNetField(b, p) {
  const F = FIELDS[b.fieldType] || FIELDS.indiaca;
  const W = F.width, H = netH(p), cfg = netCfg(p);
  const { x0, x1, y0, y1 } = netBox(b.fieldType, p);
  // gegnerische Hälfte perspektivisch: hintere Grundlinie höher und schmaler
  const far = -1.15, shrink = 0.26, depth = F.length / 2;
  const at = (d) => { // Bodenlinie in Tiefe d (0 = Netz, depth = Grundlinie)
    const t = d / depth, k = 1 - (1 - shrink) * t;
    return { y: far * t, xl: (W / 2) * (1 - k), xr: W - (W / 2) * (1 - k) };
  };
  const bl = at(depth), al = at(F.attack);
  let s = `<rect class="nv-wall" x="${x0}" y="${y0}" width="${x1 - x0}" height="${f(far - y0 + 0.01)}"/>`;
  s += `<path class="nv-wall-band" d="M${x0} ${f(far - 0.35)}H${x1}"/>`;
  s += `<rect class="f-out" x="${x0}" y="${far}" width="${x1 - x0}" height="${f(y1 - far)}"/>`;
  s += `<path class="f-court nv-far" d="M0 0L${f(bl.xl)} ${f(bl.y)}L${f(bl.xr)} ${f(bl.y)}L${W} 0Z"/>`;
  s += `<path class="f-line nv-fl" d="M0 0L${f(bl.xl)} ${f(bl.y)}L${f(bl.xr)} ${f(bl.y)}L${W} 0M${f(al.xl)} ${f(al.y)}L${f(al.xr)} ${f(al.y)}"/>`;
  s += `<rect class="f-court" x="0" y="0" width="${W}" height="${f(y1)}"/>`;
  s += `<path class="f-line" d="M0 ${y1}V0H${W}V${y1}" style="stroke-width:0.05"/>`;
  // Hilfslinien
  if (cfg.hilfslinien) for (let h = 0.5; h <= -y0 - 0.2; h += 0.5) s += `<line class="nv-guide" x1="0" x2="${W}" y1="${f(-h)}" y2="${f(-h)}"/>`;
  // Netz: Pfosten, Maschen, Band, Antennen
  const px = 0.5;
  s += `<line class="nv-post" x1="${-px}" y1="0" x2="${-px}" y2="${f(-H - 0.12)}"/><line class="nv-post" x1="${W + px}" y1="0" x2="${W + px}" y2="${f(-H - 0.12)}"/>`;
 s += `<defs><pattern id="nv-mesh-p" width="0.1" height="0.1" patternUnits="userSpaceOnUse"><path class="nv-mesh-l" d="M0 0H0.1M0 0V0.1"/></pattern></defs>`;
  s += `<rect class="nv-mesh" x="${-px}" y="${f(-H)}" width="${W + 2 * px}" height="${NET_BAND}"/>`;
  s += `<line class="nv-band" x1="${-px}" x2="${W + px}" y1="${f(-H + 0.025)}" y2="${f(-H + 0.025)}"/>`;
  s += `<line class="nv-band nv-band-b" x1="${-px}" x2="${W + px}" y1="${f(-H + NET_BAND)}" y2="${f(-H + NET_BAND)}"/>`;
  for (const ax of [0, W]) {
    const yb = -H + NET_BAND, yt = -H - ANTENNA;
    for (let y = yb, i = 0; y > yt + 0.001; y -= 0.1, i++)
      s += `<line class="nv-ant ${i % 2 ? 'w' : 'r'}" x1="${ax}" x2="${ax}" y1="${f(y)}" y2="${f(Math.max(yt, y - 0.1))}"/>`;
  }
  s += `<text class="nv-lbl" x="${f(W - 0.08)}" y="${f(-H - 0.14)}" text-anchor="end">Netz ${fmtM(H)}</text>`;
  // Höhenskala links: 10-cm-Striche, alle 50 cm beschriftet
  const sx = -0.62;
  s += `<line class="nv-scale" x1="${sx}" x2="${sx}" y1="0" y2="${f(y0 + 0.15)}"/>`;
  for (let i = 0; i <= Math.floor((-y0 - 0.15) * 10); i++) {
    const y = -i / 10, big = i % 5 === 0;
    s += `<line class="nv-tick${big ? ' big' : ''}" x1="${sx}" x2="${f(sx - (big ? 0.2 : i % 5 ? 0.09 : 0.14))}" y1="${f(y)}" y2="${f(y)}"/>`;
    if (big) s += `<text class="nv-num" x="${f(sx - 0.25)}" y="${f(y)}" text-anchor="end" dominant-baseline="central">${(i / 10).toFixed(1).replace('.', ',')}</text>`;
  }
  // Netzoberkante auf der Skala markieren
  s += `<path class="nv-mark" d="M${sx + 0.02} ${f(-H)}l0.16 -0.08v0.16Z"/>`;
  // Seitliche Skala am Boden (Meter ab links)
  for (let m = 0; m <= Math.floor(W); m++) s += `<line class="nv-tick" x1="${m}" x2="${m}" y1="0.02" y2="0.14"/><text class="nv-num" x="${m}" y="0.3" text-anchor="middle" dominant-baseline="central">${m}</text>`;
  s += `<text class="nv-num" x="${f(W + 0.15)}" y="0.3" dominant-baseline="central">m</text>`;
  return s;
}

/** Marker auf die Netzoberkante einrasten (±15 cm), wenn eingeschaltet */
export function snapToNet(p, el) {
  const cfg = netCfg(p);
  if (!cfg.einrasten) return false;
  if (Math.abs(-el.y - cfg.hoehe) <= 0.15) {
    el.y = -cfg.hoehe;
    return true;
  }
  return false;
}

/** Text für die Live-Anzeige */
export function readoutText(p, b, x, y) {
  const W = (FIELDS[b.fieldType] || FIELDS.indiaca).width;
  const hgt = Math.max(0, -y);
  const onNet = Math.abs(hgt - netH(p)) < 0.005;
  const side = x < 0 ? `${fmtM(-x)} links außerhalb` : x > W ? `${fmtM(x - W)} rechts außerhalb` : `${fmtM(x)} von links`;
  return `${onNet ? 'Netzkante · ' : ''}${fmtM(hgt)} hoch · ${side}`;
}

/** Legende der verwendeten Marker-Farben */
export function usedColors(p) {
  const set = new Set();
  for (const e of p.elements) if (e.type === 'marker' && e.color) set.add(e.color);
  return [...set];
}
export const legendLabel = (p, c) => netCfg(p).legende[c] || '';
export const legendHtml = (p) => usedColors(p).map((c) => `<span class="lg-i"><i style="background:${esc(colorCss(c))}"></i>${esc(legendLabel(p, c) || 'ohne Bedeutung')}</span>`).join('');

/** Neue Netzansicht-Seite */
export function makeNetPage(name) {
  const n = state.boards.find((b) => b.id === state.boardId)?.pages.filter((p) => p.kind === 'netz').length || 0;
  const p = { id: uid(), kind: 'netz', name: name || `Netz ${n + 1}`, elements: [], notes: '', net: {} };
  netCfg(p);
  return p;
}
