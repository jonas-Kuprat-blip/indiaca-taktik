import { FIELDS } from './model.js';
import { strokePath } from './stroke.js';
import { esc, colorCss } from './util.js';

const f = (n) => Math.round(n * 1000) / 1000;

export function viewBox(ft) {
  const F = FIELDS[ft], m = F.margin;
  return `${-F.length / 2 - m} ${-F.width / 2 - m} ${F.length + 2 * m} ${F.width + 2 * m}`;
}

// ---------- Feld ----------
export function renderField(b) {
  const F = FIELDS[b.fieldType];
  const L = F.length, W = F.width, a = F.attack, m = F.margin, s = F.s;
  const x0 = -L / 2 - m, y0 = -W / 2 - m;
  const ly = -W / 2 - m * 0.42;
  return `
  <rect class="f-out" x="${x0}" y="${y0}" width="${L + 2 * m}" height="${W + 2 * m}"/>
  <rect class="f-court" x="${-L / 2}" y="${-W / 2}" width="${L}" height="${W}"/>
  <line class="f-line f-att" x1="${-a}" y1="${-W / 2}" x2="${-a}" y2="${W / 2}"/>
  <line class="f-line f-att" x1="${a}" y1="${-W / 2}" x2="${a}" y2="${W / 2}"/>
  <rect class="f-line" x="${-L / 2}" y="${-W / 2}" width="${L}" height="${W}"/>
  <line class="f-net" x1="0" y1="${-W / 2 - 0.45}" x2="0" y2="${W / 2 + 0.45}"/>
  <circle class="f-post" cx="0" cy="${-W / 2 - 0.45}" r="0.1"/>
  <circle class="f-post" cx="0" cy="${W / 2 + 0.45}" r="0.1"/>
  <text class="f-label" x="${-L / 4}" y="${ly}" font-size="${0.42 * s}" text-anchor="middle" dominant-baseline="central">${esc(b.teams.own.name)}</text>
  <text class="f-label" x="${L / 4}" y="${ly}" font-size="${0.42 * s}" text-anchor="middle" dominant-baseline="central">${esc(b.teams.opp.name)}</text>`;
}

// ---------- Elemente ----------
const strokeCache = new Map();
function strokeD(el) {
  const key = `${el.id}:${el.points.length}:${el.width}:${el.pressure ? 1 : 0}`;
  let d = strokeCache.get(key);
  if (!d) {
    d = strokePath(el.points, el.width, el.pressure);
    if (strokeCache.size > 3000) strokeCache.clear();
    strokeCache.set(key, d);
  }
  return d;
}

export function markerColor(el, page) {
  if (el.serveType && page?.serveTypes) {
    const t = page.serveTypes.find((t) => t.id === el.serveType);
    if (t) return t.color;
  }
  return el.color;
}

function arrowMarkup(x1, y1, x2, y2, color, w, dashed, cls = 'ar-l') {
  const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1;
  const ux = dx / l, uy = dy / l;
  const hl = Math.max(0.32, w * 3.8), hw = hl * 0.55;
  const bx = x2 - ux * hl, by = y2 - uy * hl;
  const lx = x2 - ux * hl * 0.6, ly = y2 - uy * hl * 0.6;
  const c = colorCss(color);
  return `<path class="${cls}" d="M${f(x1)} ${f(y1)}L${f(lx)} ${f(ly)}" style="stroke:${c};stroke-width:${w}${
    dashed ? `;stroke-dasharray:${f(w * 2.5)} ${f(w * 2.2)}` : ''
  }"/><path d="M${f(x2)} ${f(y2)}L${f(bx - uy * hw)} ${f(by + ux * hw)}L${f(bx + uy * hw)} ${f(by - ux * hw)}Z" style="fill:${c}"/>`;
}

export function symbolMarkup(symbol, color, s) {
  const c = colorCss(color);
  if (symbol === 'dot') return `<circle r="${f(0.22 * s)}" class="mk-dot" style="fill:${c}"/>`;
  const a = f(0.24 * s);
  const d = `M${-a} ${-a}L${a} ${a}M${-a} ${a}L${a} ${-a}`;
  return `<path d="${d}" class="mk-halo" style="stroke-width:${f(0.2 * s)}"/><path d="${d}" style="stroke:${c};stroke-width:${f(0.11 * s)};stroke-linecap:round"/>`;
}

export function renderOne(el, page, b) {
  const s = FIELDS[b.fieldType].s;
  switch (el.type) {
    case 'player': {
      const R = 0.4 * s;
      return `<g class="el pl" data-id="${el.id}" transform="translate(${f(el.x)} ${f(el.y)})">
        <circle r="${R}" class="pl-c" style="fill:${colorCss(el.color)}"/>
        <text class="pl-n" font-size="${f(R * (String(el.number).length > 2 ? 0.7 : 0.95))}" text-anchor="middle" dominant-baseline="central">${esc(el.number)}</text>
        ${el.label ? `<text class="lbl" y="${f(R + 0.32 * s)}" font-size="${f(0.32 * s)}" text-anchor="middle" dominant-baseline="central">${esc(el.label)}</text>` : ''}
      </g>`;
    }
    case 'zone': {
      const c = colorCss(el.color);
      const st = `style="fill:${c};fill-opacity:${el.opacity};stroke:${c};stroke-opacity:.85;stroke-width:${f(0.05 * s)}"`;
      if (el.shape === 'rect')
        return `<rect class="el zn" data-id="${el.id}" x="${f(el.x)}" y="${f(el.y)}" width="${f(el.w)}" height="${f(el.h)}" rx="0.06" ${st}/>`;
      if (el.shape === 'circle')
        return `<circle class="el zn" data-id="${el.id}" cx="${f(el.x)}" cy="${f(el.y)}" r="${f(el.r)}" ${st}/>`;
      return `<path class="el zn" data-id="${el.id}" d="M${el.points.map((p) => `${f(p[0])} ${f(p[1])}`).join('L')}Z" ${st}/>`;
    }
    case 'stroke':
      return `<path class="st" d="${strokeD(el)}" style="fill:${colorCss(el.color)}"/>`;
    case 'arrow':
      return `<g class="el ar" data-id="${el.id}"><path class="hit" d="M${f(el.x1)} ${f(el.y1)}L${f(el.x2)} ${f(el.y2)}" style="stroke-width:${0.6 * s}"/>${arrowMarkup(
        el.x1, el.y1, el.x2, el.y2, el.color, el.width, el.dashed
      )}</g>`;
    case 'marker': {
      const c = markerColor(el, page);
      let from = '';
      if (el.from) {
        const dx = el.x - el.from.x, dy = el.y - el.from.y, l = Math.hypot(dx, dy) || 1;
        const gap = 0.32 * s;
        from = `<circle cx="${f(el.from.x)}" cy="${f(el.from.y)}" r="${f(0.12 * s)}" style="fill:${colorCss(c)}"/>` +
          arrowMarkup(el.from.x, el.from.y, el.x - (dx / l) * gap, el.y - (dy / l) * gap, c, 0.06 * s, true);
      }
      return `<g class="el mk" data-id="${el.id}">${from}<g transform="translate(${f(el.x)} ${f(el.y)})"><circle class="hit-a" r="${f(0.45 * s)}"/>${symbolMarkup(el.symbol, c, s)}</g>${
        el.label
          ? `<text class="lbl" x="${f(el.x + 0.34 * s)}" y="${f(el.y - 0.34 * s)}" font-size="${f(0.32 * s)}" dominant-baseline="central">${esc(el.label)}</text>`
          : ''
      }</g>`;
    }
  }
  return '';
}

const ORDER = { zone: 0, stroke: 1, arrow: 2, marker: 3, player: 4 };
export function renderElements(page, b) {
  if (!page) return '';
  const els = [...page.elements].sort((a, c) => (ORDER[a.type] ?? 9) - (ORDER[c.type] ?? 9));
  let out = els.map((e) => renderOne(e, page, b)).join('');
  if (page.kind === 'angabe') out += renderLegend(page, b);
  return out;
}

function renderLegend(page, b) {
  const F = FIELDS[b.fieldType], s = F.s;
  const y = F.width / 2 + F.margin * 0.5;
  const fs = 0.36 * s;
  let x = -F.length / 2 + 0.25;
  const parts = (page.serveTypes || []).map((t) => {
    const n = page.elements.filter((e) => e.type === 'marker' && e.serveType === t.id).length;
    const label = `${t.name}${n ? ` (${n})` : ''}`;
    const g = `<g transform="translate(${f(x)} ${f(y)})">${symbolMarkup('x', t.color, s * 0.85)}<text class="lg-t" x="${f(0.42 * s)}" font-size="${fs}" dominant-baseline="central">${esc(label)}</text></g>`;
    x += 0.42 * s + fs * 0.58 * label.length + 0.7 * s;
    return g;
  });
  return `<g class="legend">${parts.join('')}</g>`;
}

// ---------- Auswahl-Overlay ----------
const handle = (name, x, y, s) =>
  `<g data-handle="${name}" transform="translate(${f(x)} ${f(y)})"><circle class="hd-hit" r="${f(0.5 * s)}"/><circle class="hd" r="${f(0.17 * s)}"/></g>`;

export function renderSelection(el, page, b) {
  const s = FIELDS[b.fieldType].s;
  const pad = 0.12 * s;
  switch (el.type) {
    case 'player':
      return `<circle class="sel" cx="${f(el.x)}" cy="${f(el.y)}" r="${f(0.4 * s + pad)}"/>`;
    case 'marker':
      return `<circle class="sel" cx="${f(el.x)}" cy="${f(el.y)}" r="${f(0.36 * s)}"/>` + (el.from ? handle('from', el.from.x, el.from.y, s) : '');
    case 'arrow':
      return handle('a1', el.x1, el.y1, s) + handle('a2', el.x2, el.y2, s);
    case 'zone':
      if (el.shape === 'rect')
        return `<rect class="sel" x="${f(el.x - pad)}" y="${f(el.y - pad)}" width="${f(el.w + 2 * pad)}" height="${f(el.h + 2 * pad)}"/>` + handle('br', el.x + el.w, el.y + el.h, s);
      if (el.shape === 'circle')
        return `<circle class="sel" cx="${f(el.x)}" cy="${f(el.y)}" r="${f(el.r + pad)}"/>` + handle('r', el.x + el.r, el.y, s);
      {
        const xs = el.points.map((p) => p[0]), ys = el.points.map((p) => p[1]);
        const x = Math.min(...xs), y = Math.min(...ys);
        return `<rect class="sel" x="${f(x - pad)}" y="${f(y - pad)}" width="${f(Math.max(...xs) - x + 2 * pad)}" height="${f(Math.max(...ys) - y + 2 * pad)}"/>`;
      }
  }
  return '';
}

export function thumbSVG(page, b) {
  return `<svg viewBox="${viewBox(b.fieldType)}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${renderField(b)}${renderElements(page, b)}</svg>`;
}
