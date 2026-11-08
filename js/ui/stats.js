import { h, colorCss } from '../util.js';
import { I } from '../icons.js';
import { board, page, touch, emit } from '../store.js';
import { modal, confirmDlg } from './dialogs.js';

/*
 * Statistik pro Board.
 *  board.stats     = { "own:jonas": { fehl, block, abwehr, angriff, blockout, team, name, color } }
 *  board.statsTeam = { geschenke }   // Punkte durch Fehler des Gegners – unabhängig von Spielern
 *
 * Schulnote (1,0 … 6,0), live berechnet. Angelehnt an die übliche Volleyball-Effizienz
 * (Punkte − Fehler) / Versuche:
 *   Wert   = 1·Angriff + 1·Block + 1·Blockout + 0,5·Abwehr − 1·Fehlangabe
 *   Effiz. = Wert / (Aktionen + 2)      → −1 … +1; „+2“ dämpft Ausreißer bei wenigen Aktionen
 *   Note   = 3,5 − 2,5 · Effizienz      → +1 = 1,0 · 0 = 3,5 · −1 = 6,0
 * Geschenke fließen nicht in die Noten ein.
 */
const COLS = [
  ['fehl', 'Fehlangabe', -1],
  ['block', 'Block', 1],
  ['abwehr', 'Abwehr', 0.5],
  ['angriff', 'Angriff', 1],
  ['blockout', 'Blockout', 1],
];
const PRIOR = 2;
const keyOf = (team, name) => `${team}:${name.trim().toLowerCase()}`;
const stats = () => (board().stats ||= {});
const team = () => (board().statsTeam ||= { geschenke: 0 });

export function grade(v) {
  const n = COLS.reduce((a, [c]) => a + (v[c] || 0), 0);
  if (!n) return null;
  const val = COLS.reduce((a, [c, , w]) => a + w * (v[c] || 0), 0);
  const eff = val / (n + PRIOR);
  return Math.min(6, Math.max(1, 3.5 - 2.5 * eff));
}
const gradeText = (g) => (g == null ? '–' : g.toFixed(1).replace('.', ','));
const gradeClass = (g) => (g == null ? 'g-none' : g <= 1.75 ? 'g1' : g <= 2.75 ? 'g2' : g <= 3.75 ? 'g3' : g <= 4.75 ? 'g4' : 'g5');

function rows() {
  const st = stats();
  const list = [];
  const seen = new Set();
  for (const e of page().elements) {
    if (e.type !== 'player' || !e.label?.trim()) continue;
    const k = keyOf(e.team, e.label);
    if (seen.has(k)) continue;
    seen.add(k);
    list.push({ key: k, team: e.team, name: e.label.trim(), color: e.color, onField: true });
  }
  for (const [k, v] of Object.entries(st)) {
    if (seen.has(k) || !COLS.some(([c]) => v[c] > 0)) continue;
    list.push({ key: k, team: v.team, name: v.name, color: v.color, onField: false });
  }
  return list.sort((a, b) => (a.team === b.team ? a.name.localeCompare(b.name, 'de') : a.team === 'own' ? -1 : 1));
}

function counter(value, onChange, label) {
  return h('div', { class: 'st-col st-counter' },
    h('button', { class: 'btn st-btn', 'aria-label': `${label} minus`, html: I.minus, onclick: () => onChange(-1) }),
    h('span', { class: 'st-num' }, String(value || 0)),
    h('button', { class: 'btn st-btn plus', 'aria-label': `${label} plus`, html: I.plus, onclick: () => onChange(1) }));
}
const gradeCell = (g) => h('div', { class: 'st-col st-grade' }, h('span', { class: 'grade ' + gradeClass(g) }, gradeText(g)));

export function openStats() {
  const body = h('div', { class: 'stats' });
  const changed = (fn) => {
    fn();
    touch();
    emit('stats');
    render();
  };
  const render = () => {
    const st = stats();
    const list = rows();
    const head = h('div', { class: 'st-row st-head' }, h('div', { class: 'st-name' }, 'Spieler'), COLS.map(([, label]) => h('div', { class: 'st-col' }, label)), h('div', { class: 'st-col' }, 'Note'));
    const totals = Object.fromEntries(COLS.map(([c]) => [c, 0]));
    const lines = list.map((r) => {
      const v = (st[r.key] ||= {});
      Object.assign(v, { team: r.team, name: r.name, color: r.color });
      COLS.forEach(([c]) => (totals[c] += v[c] || 0));
      return h('div', { class: 'st-row' + (r.onField ? '' : ' off') },
        h('div', { class: 'st-name' }, h('span', { class: 'dot', style: { background: colorCss(r.color) } }), h('span', { class: 'nm' }, r.name),
          r.onField ? null : h('span', { class: 'muted small' }, ' (nicht auf Seite)')),
        COLS.map(([c, label]) => counter(v[c], (d) => changed(() => (v[c] = Math.max(0, (v[c] || 0) + d))), `${r.name} ${label}`)),
        gradeCell(grade(v)));
    });
    const empty = list.length
      ? []
      : [h('p', { class: 'muted', style: { padding: '10px 6px 0' } }, 'Noch keine benannten Spieler – die Liste ist leer.'),
         h('p', { class: 'muted small' }, 'So geht’s: Spieler auf dem Feld antippen → oben in der Leiste einen Namen eingeben.')];
    const sum = h('div', { class: 'st-row st-sum' }, h('div', { class: 'st-name' }, 'Gesamt'),
      COLS.map(([c]) => h('div', { class: 'st-col' }, String(totals[c]))), gradeCell(grade(totals)));

    // Geschenke: Punkte durch Fehler des Gegners (Team, ohne Spieler, nicht in der Note)
    const t = team();
    const own = (totals.angriff || 0) + (totals.block || 0) + (totals.blockout || 0);
    const gifts = h('div', { class: 'st-gifts' },
      h('div', { class: 'gift-lbl' }, h('b', {}, 'Geschenke'), h('span', { class: 'muted small' }, 'Punkte durch Fehler des Gegners')),
      counter(t.geschenke, (d) => changed(() => (t.geschenke = Math.max(0, (t.geschenke || 0) + d))), 'Geschenke'),
      h('div', { class: 'gift-sum' }, h('span', { class: 'muted small' }, 'Punkte gesamt'), h('b', {}, String(own + (t.geschenke || 0))),
        h('span', { class: 'muted small' }, `(${own} eigene + ${t.geschenke || 0} geschenkt)`)));
    const info = h('details', { class: 'st-info' },
      h('summary', {}, 'Wie wird die Note berechnet?'),
      h('p', { class: 'small' }, 'Angriff, Block und Blockout zählen je +1, Abwehr +0,5, Fehlangabe −1. Die Summe wird durch die Zahl der Aktionen (+2 zum Ausgleich bei wenigen Aktionen) geteilt und auf 1,0 (sehr gut) bis 6,0 umgerechnet. Geschenke zählen nicht zur Note.'));
    body.replaceChildren(h('div', { class: 'st-table' }, head, ...lines, ...empty, sum), gifts, info);
  };
  render();
  modal({
    title: 'Statistik',
    wide: true,
    body,
    actions: [
      {
        label: 'Zurücksetzen', danger: true,
        onClick: async () => {
          if (await confirmDlg('Statistik zurücksetzen?', 'Alle Zähler und Geschenke dieses Boards werden auf 0 gesetzt.', { okLabel: 'Zurücksetzen', danger: true })) {
            board().stats = {};
            board().statsTeam = { geschenke: 0 };
            touch();
            emit('stats');
            render();
          }
          return false;
        },
      },
      { label: 'Fertig', primary: true },
    ],
  }).box.classList.add('stats-modal');
}

/** Lasche „Statistik“ am rechten Feldrand (unter den Notizen) – immer erreichbar */
export function initStatsTab(wrap) {
  const tab = h('button', { id: 'stats-tab', 'aria-label': 'Statistik öffnen', title: 'Statistik', onclick: openStats },
    h('span', { class: 'ic', html: I.stats }), h('span', { class: 'tx' }, 'Statistik'));
  wrap.append(tab);
}
