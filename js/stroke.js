import { clamp } from './util.js';

/**
 * Baut aus Punkten [x, y, druck] eine gefüllte Kontur mit variabler Breite (wie ein echter Stift).
 * pressure=false → konstante Breite (Finger/Maus).
 */
export function strokePath(points, width, pressure) {
  const n = points.length;
  if (!n) return '';
  const f = (v) => Math.round(v * 1000) / 1000;

  const w = points.map((p) => (pressure ? width * clamp(0.25 + 1.3 * (p[2] ?? 0.5), 0.2, 1.6) : width));
  for (let k = 0; k < 2; k++) for (let i = 1; i < n - 1; i++) w[i] = (w[i - 1] + 2 * w[i] + w[i + 1]) / 4;

  let len = 0;
  for (let i = 1; i < n; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  if (n === 1 || len < width * 0.3) {
    const r = w[0] / 2, [x, y] = points[0];
    return `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
  }

  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const r = w[i] / 2, [x, y] = points[i];
    left.push([x - ty * r, y + tx * r]);
    right.push([x + ty * r, y - tx * r]);
  }
  const smooth = (arr) => {
    let d = '';
    for (let i = 1; i < arr.length - 1; i++) {
      const mx = (arr[i][0] + arr[i + 1][0]) / 2, my = (arr[i][1] + arr[i + 1][1]) / 2;
      d += `Q${f(arr[i][0])} ${f(arr[i][1])} ${f(mx)} ${f(my)}`;
    }
    const l = arr[arr.length - 1];
    return d + `L${f(l[0])} ${f(l[1])}`;
  };
  const rEnd = f(w[n - 1] / 2), rStart = f(w[0] / 2);
  right.reverse();
  return (
    `M${f(left[0][0])} ${f(left[0][1])}` + smooth(left) +
    `A${rEnd} ${rEnd} 0 0 0 ${f(right[0][0])} ${f(right[0][1])}` + smooth(right) +
    `A${rStart} ${rStart} 0 0 0 ${f(left[0][0])} ${f(left[0][1])}Z`
  );
}
