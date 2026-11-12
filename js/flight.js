/*
 * Flugbahn der Indiaca mit Luftwiderstand (quadratisch, wie beim Federball):
 *   a = g + (−k · |v| · v),  k = g / v_t²
 * Die Federn bremsen stark: Grenzgeschwindigkeit v_t ≈ 9 m/s (Federball ≈ 6,8 m/s; Indiaca ist schwerer).
 * Koordinaten wie in der Netzansicht: [X seitlich, Y Höhe, Z Tiefe ab Netz].
 */
const G = 9.81, VT = 9, K = G / (VT * VT), DT = 0.004;

/** Flug simulieren bis zur Zeit T (oder Bodenkontakt); liefert Stützpunkte mit Zeit */
export function simulate(p0, v0, T = 5) {
  let p = [...p0], v = [...v0], t = 0;
  const out = [[...p, 0]];
  while (t < T - 1e-9) {
    const dt = Math.min(DT, T - t);
    const s = Math.hypot(v[0], v[1], v[2]);
    const a = [-K * s * v[0], -G - K * s * v[1], -K * s * v[2]];
    v = [v[0] + a[0] * dt, v[1] + a[1] * dt, v[2] + a[2] * dt];
    p = [p[0] + v[0] * dt, p[1] + v[1] * dt, p[2] + v[2] * dt];
    t += dt;
    out.push([...p, t]);
    if (p[1] <= 0 && v[1] < 0) break;
  }
  return out;
}

/** Anfangsgeschwindigkeit, damit die Indiaca nach genau T Sekunden bei p1 ist (Schießverfahren) */
export function aimAt(p0, p1, T) {
  let v = [(p1[0] - p0[0]) / T, (p1[1] - p0[1]) / T + 0.5 * G * T, (p1[2] - p0[2]) / T];
  for (let i = 0; i < 60; i++) {
    const s = simulate(p0, v, T);
    const e = s[s.length - 1];
    const err = [p1[0] - e[0], p1[1] - e[1], p1[2] - e[2]];
    if (Math.hypot(...err) < 0.002) break;
    v = [v[0] + err[0] / T, v[1] + err[1] / T, v[2] + err[2] / T];
  }
  return v;
}

/**
 * Angriffsschlag: vom Treffpunkt zum Aufprallpunkt. Die Flugzeit wird so gewählt, dass die Indiaca
 * mit Sicherheitsabstand über die Netzkante geht – schnellster gültiger Schlag bis maxKmh (Indiaca ≈ 60–80 km/h).
 * Rückgabe: { samples, T, tNet, net: [X, Y, 0], speed (km/h) }
 */
export function attackFlight(p0, land, netH, clearance = 0.08, maxKmh = 80) {
  const fallback = null;
  for (let T = 0.28; T <= 2; T += 0.02) {
    const v = aimAt(p0, land, T);
    if (Math.hypot(...v) * 3.6 > maxKmh) continue; // realistische Schlaggeschwindigkeit
    const s = simulate(p0, v, T);
    const i = s.findIndex((q) => q[2] >= 0);
    if (i <= 0) continue;
    const a = s[i - 1], b = s[i], t = (0 - a[2]) / (b[2] - a[2] || 1);
    const y = a[1] + (b[1] - a[1]) * t;
    if (y < netH + clearance) continue;
    return { samples: s, T, tNet: a[3] + (b[3] - a[3]) * t, net: [a[0] + (b[0] - a[0]) * t, y, 0], speed: Math.round(Math.hypot(...v) * 3.6) };
  }
  return fallback;
}

/** Stützpunkte zwischen zwei Zeiten (für die Animation einer Teilstrecke) */
export function between(samples, t0, t1, n = 14) {
  const at = (t) => {
    const i = samples.findIndex((q) => q[3] >= t);
    if (i <= 0) return samples[Math.max(0, i)];
    const a = samples[i - 1], b = samples[i], u = (t - a[3]) / (b[3] - a[3] || 1);
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, t];
  };
  const out = [];
  for (let i = 0; i <= n; i++) {
    const q = at(t0 + ((t1 - t0) * i) / n);
    out.push([Math.round(q[0] * 1000) / 1000, Math.round(q[1] * 1000) / 1000, Math.round(q[2] * 1000) / 1000]);
  }
  return out;
}
