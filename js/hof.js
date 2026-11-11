import { uid, clone } from './util.js';
import { lib, libChanged, anyPlayer, playerById, actionById } from './library.js';
import { allPlayers, attackStats, pct, fmtDate } from './alltime.js';

/*
 * Hall of Fame (app-weit, in der Bibliothek gespeichert):
 *  lib.hof = { cats: [{ id, emoji, title, type, action?, shame, active, builtin, sayings: [] }], shame, minGames, minAttempts }
 *  type: sum (Summe einer Aktion) · avg (Schnitt pro Spiel) · games (Einsätze) · winrate (Siegquote, min. Spiele)
 *        · atteff (Angriffseffizienz, min. Versuche) · record (Bestwert je Aktion in einem Spiel)
 */
export const HOF_TYPES = [
  ['sum', 'Summe einer Aktion'], ['avg', 'Schnitt pro Spiel'], ['games', 'Meiste Einsätze'],
  ['winrate', 'Beste Siegquote'], ['atteff', 'Beste Angriffseffizienz'], ['record', 'Rekord in einem Spiel'],
];

export const DEFAULT_CATS = [
  { id: 'ass', emoji: '🎯', title: 'Ass-König', type: 'sum', action: 'ass', sayings: [
    'Die Annahme hat ihn nur im Fernsehen gesehen.', 'Angabe, Punkt, nächste Angabe. Langweilig für den Gegner.', 'Wer braucht schon einen Spielzug, wenn es Asse gibt?', 'Der Gegner fragt schon nach der Wiederholung in Zeitlupe.'] },
  { id: 'mauer', emoji: '🧱', title: 'Die Mauer', type: 'sum', action: 'blockpunkt', sayings: [
    'Hier kommt nix durch, nicht mal WLAN.', 'Baugenehmigung erteilt: Mauer am Netz.', 'Angreifer bitte draußen bleiben.', 'Zwei Hände, null Durchkommen.'] },
  { id: 'hammer', emoji: '💥', title: 'Hammer-Hand', type: 'sum', action: 'angriffspunkt', sayings: [
    'Die Indiaca hat Angst vor ihm.', 'Kurzer Prozess am Netz.', 'Die Federn fliegen noch, der Punkt ist schon da.', 'Abwehr? Theoretisch möglich.'] },
  { id: 'sauger', emoji: '🛡️', title: 'Staubsauger', type: 'sum', action: 'abwehr_gut', sayings: [
    'Saugt alles weg, was in die Nähe kommt.', 'Kein Ball ist verloren, solange hier jemand steht.', 'Der Hallenboden hat diese Saison wenig Indiaca gesehen.', 'Hechtet schneller, als der Gegner schlagen kann.'] },
  { id: 'netz', emoji: '🕸️', title: 'Netz-Magnet', type: 'sum', action: 'netzfehler', shame: true, sayings: [
    'Das Netz und er: eine komplizierte Beziehung.', 'Wenn das Netz wackelt, wissen alle Bescheid.', 'Hat das Netz öfter berührt als die Indiaca.', 'Das Netz hat schon einen Fanclub gegründet.'] },
  { id: 'rakete', emoji: '🚀', title: 'Raketenstart', type: 'sum', action: 'angabefehler', shame: true, sayings: [
    'Ziel: Hallendecke. Erreicht.', 'Houston, wir haben eine Angabe.', 'Die Hallenbeleuchtung bittet um Schonung.', 'Volle Kraft voraus, Richtung irgendwohin.'] },
  { id: 'dauer', emoji: '🔁', title: 'Dauerbrenner', type: 'games', sayings: [
    'Ohne diese Person fängt kein Spiel an.', 'Hat die Halle öfter gesehen als das eigene Sofa.', 'Stammplatz? Dauerplatz!', 'Urlaub ist was für andere.'] },
  { id: 'sieger', emoji: '🏆', title: 'Siegertyp', type: 'winrate', sayings: [
    'Verlieren steht nicht im Vokabular.', 'Glücksbringer mit Turnschuhen.', 'Wo diese Person spielt, wird gewonnen.', 'Siegen ist Gewohnheitssache.'] },
  { id: 'effizienz', emoji: '📈', title: 'Effizienzmaschine', type: 'atteff', sayings: [
    'Jeder Schlag ein Treffer, fast.', 'Excel wäre stolz auf diese Quote.', 'Wenig Aufwand, viel Ertrag.', 'Präzision mit Federn.'] },
  { id: 'rekord', emoji: '🎲', title: 'Rekord in einem Spiel', type: 'record', sayings: [
    'An diesem Tag lief einfach alles.', 'Sternstunde in der Sporthalle.', 'Das Spiel, über das man noch lange redet.', 'Einmal alles richtig gemacht.'] },
];

const normCat = (c, builtin) => ({
  id: c.id || uid(), emoji: c.emoji || '⭐', title: String(c.title || 'Kategorie').trim() || 'Kategorie',
  type: HOF_TYPES.some(([t]) => t === c.type) ? c.type : 'sum', action: c.action || null,
  shame: !!c.shame, active: c.active !== false, builtin: !!builtin,
  sayings: Array.isArray(c.sayings) ? c.sayings.map((x) => String(x).trim()).filter(Boolean) : [],
});

/** Hall-of-Fame-Einstellungen (mit Standardwerten ergänzt) */
const DONE = new WeakSet(); // einmal normalisiert → Objekte bleiben stabil (Editor hält Referenzen)
export function hof() {
  const h = (lib.hof ||= {});
  if (DONE.has(h)) return h;
  DONE.add(h);
  const src = Array.isArray(h.cats) ? h.cats.filter((c) => c?.id) : [];
  const cats = DEFAULT_CATS.map((d) => normCat({ ...clone(d), ...(src.find((c) => c.id === d.id) || {}), id: d.id, type: d.type, action: d.action }, true));
  for (const c of src) if (!DEFAULT_CATS.some((d) => d.id === c.id)) cats.push(normCat(c, false));
  h.cats = cats;
  h.shame = h.shame !== false;
  h.minGames = Number.isFinite(+h.minGames) && +h.minGames > 0 ? +h.minGames : 5;
  h.minAttempts = Number.isFinite(+h.minAttempts) && +h.minAttempts > 0 ? +h.minAttempts : 10;
  return h;
}
export function hofChanged() {
  libChanged();
}
export function resetCat(id) {
  const h = hof();
  const d = DEFAULT_CATS.find((x) => x.id === id);
  if (!d) return;
  h.cats = h.cats.map((c) => (c.id === id ? normCat(clone(d), true) : c));
  hofChanged();
}
export function addCat(data) {
  const h = hof();
  const c = normCat({ ...data, id: 'c_' + uid() }, false);
  h.cats.push(c);
  hofChanged();
  return c;
}
export function deleteCat(id) {
  const h = hof();
  h.cats = h.cats.filter((c) => c.builtin || c.id !== id);
  hofChanged();
}

export const playerName = (pid) => {
  const p = anyPlayer(pid);
  return p ? p.name + (playerById(pid) ? '' : ' (archiviert)') : '?';
};
export const randomSaying = (c) => (c.sayings.length ? c.sayings[Math.floor(Math.random() * c.sayings.length)] : '');

/** Kurzbeschreibung einer Kategorie */
export function catRule(c, h = hof()) {
  const a = actionById(c.action);
  switch (c.type) {
    case 'sum': return `Meiste: ${a?.label || '–'}`;
    case 'avg': return `Bester Schnitt pro Spiel: ${a?.label || '–'} (min. ${h.minGames} Spiele)`;
    case 'games': return 'Meiste Einsätze';
    case 'winrate': return `Beste Siegquote (min. ${h.minGames} Spiele)`;
    case 'atteff': return `Beste Angriffseffizienz (min. ${h.minAttempts} Angriffe)`;
    case 'record': return 'Bestwert je Aktion in einem einzigen Spiel';
  }
  return '';
}

/**
 * Ranglisten berechnen.
 * Rückgabe pro Kategorie: { cat, rows: [{ rank, pid, name, value, text, sub }] } (Top 3, Gleichstand = gleicher Platz)
 * Für 'record': rows = je Aktion der Bestwert (Platz 1), sortiert nach Aktion.
 */
export function computeHof(f) {
  const h = hof();
  const players = allPlayers(f);
  const out = [];
  for (const c of h.cats) {
    if (!c.active || (c.shame && !h.shame)) continue;
    let list = [];
    if (c.type === 'record') {
      const rows = [];
      for (const a of lib.actions.filter((x) => x.active && x.sign > 0)) {
        let best = null;
        for (const p of players) {
          const r = p.records[a.id];
          if (r && r.n > 0 && (!best || r.n > best.r.n || (r.n === best.r.n && r.g.date < best.r.g.date))) best = { p, r };
        }
        if (best) rows.push({ rank: 1, pid: best.p.pid, name: playerName(best.p.pid), value: best.r.n, label: a.label, text: String(best.r.n), sub: `${a.label} · ${fmtDate(best.r.g.date)}${best.r.g.opp ? ' vs ' + best.r.g.opp : ''}` });
      }
      out.push({ cat: c, rows, record: true });
      continue;
    }
    for (const p of players) {
      let v = null, text = '', sub = '';
      if (c.type === 'sum') { v = p.totals[c.action] || 0; text = String(v); sub = `${p.n} Spiele`; }
      else if (c.type === 'avg') { if (p.n >= h.minGames) { v = (p.totals[c.action] || 0) / p.n; text = (Math.round(v * 10) / 10).toString().replace('.', ','); sub = `pro Spiel · ${p.n} Spiele`; } }
      else if (c.type === 'games') { v = p.n; text = String(v); sub = 'Einsätze'; }
      else if (c.type === 'winrate') { if (p.n >= h.minGames && p.winRate != null) { v = p.winRate; text = pct(v); sub = `${p.wins} Siege · ${p.n} Spiele`; } }
      else if (c.type === 'atteff') { const s = attackStats(p.totals); if (s.att >= h.minAttempts) { v = s.eff; text = pct(v); sub = `${s.att} Angriffe`; } }
      if (v == null || (c.type !== 'atteff' && c.type !== 'winrate' && v <= 0)) continue;
      list.push({ pid: p.pid, name: playerName(p.pid), value: v, text, sub });
    }
    list.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'de'));
    list.forEach((r, i) => (r.rank = i && list[i - 1].value === r.value ? list[i - 1].rank : i + 1));
    list = list.filter((r) => r.rank <= 3).slice(0, 5);
    out.push({ cat: c, rows: list });
  }
  return out;
}
