import { h, colorCss } from '../util.js';
import { I } from '../icons.js';
import { board, page, touch, emit } from '../store.js';
import { modal, confirmDlg } from './dialogs.js';

/*
 * Statistik pro Board: Zähler je Spieler (Team + Name) für Fehlangabe, Abwehr, Angriff.
 * board.stats = { "own:Jonas": { fehl: 0, abwehr: 0, angriff: 0, team, name, color } }
 * Die Liste zeigt alle benannten Spieler der aktuellen Seite – und zusätzlich Spieler,
 * die schon Werte haben, aber auf dieser Seite nicht stehen.
 */
const COLS = [
  ['fehl', 'Fehlangabe'],
  ['abwehr', 'Abwehr'],
  ['angriff', 'Angriff'],
];
const keyOf = (team, name) => `${team}:${name.trim().toLowerCase()}`;
const stats = () => (board().stats ||= {});

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
  // eigenes Team zuerst, dann alphabetisch
  return list.sort((a, b) => (a.team === b.team ? a.name.localeCompare(b.name, 'de') : a.team === 'own' ? -1 : 1));
}

export function openStats() {
  const body = h('div', { class: 'stats' });
  const render = () => {
    const st = stats();
    const list = rows();
    if (!list.length) {
      body.replaceChildren(
        h('div', { class: 'st-row st-head' }, h('div', { class: 'st-name' }, 'Spieler'), COLS.map(([, label]) => h('div', { class: 'st-col' }, label))),
        h('p', { class: 'muted', style: { padding: '12px 6px 0' } }, 'Noch keine benannten Spieler – die Liste ist leer.'),
        h('p', { class: 'muted small' }, 'So geht’s: Spieler auf dem Feld antippen → oben in der Leiste einen Namen eingeben. Danach erscheint er hier.')
      );
      return;
    }
    const totals = { fehl: 0, abwehr: 0, angriff: 0 };
    const head = h('div', { class: 'st-row st-head' }, h('div', { class: 'st-name' }, 'Spieler'), COLS.map(([, label]) => h('div', { class: 'st-col' }, label)));
    const lines = list.map((r) => {
      const v = (st[r.key] ||= { fehl: 0, abwehr: 0, angriff: 0 });
      Object.assign(v, { team: r.team, name: r.name, color: r.color });
      COLS.forEach(([c]) => (totals[c] += v[c] || 0));
      const counter = (c) => {
        const num = h('span', { class: 'st-num' }, String(v[c] || 0));
        const change = (d) => {
          v[c] = Math.max(0, (v[c] || 0) + d);
          touch();
          emit('stats');
          render();
        };
        return h('div', { class: 'st-col st-counter' },
          h('button', { class: 'btn st-btn', 'aria-label': 'minus', html: I.minus, onclick: () => change(-1) }),
          num,
          h('button', { class: 'btn st-btn plus', 'aria-label': 'plus', html: I.plus, onclick: () => change(1) }));
      };
      return h('div', { class: 'st-row' + (r.onField ? '' : ' off') },
        h('div', { class: 'st-name' }, h('span', { class: 'dot', style: { background: colorCss(r.color) } }), h('span', { class: 'nm' }, r.name), r.onField ? null : h('span', { class: 'muted small' }, ' (nicht auf dieser Seite)')),
        COLS.map(([c]) => counter(c)));
    });
    const sum = h('div', { class: 'st-row st-sum' }, h('div', { class: 'st-name' }, 'Gesamt'), COLS.map(([c]) => h('div', { class: 'st-col' }, String(totals[c]))));
    body.replaceChildren(head, ...lines, sum);
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
          if (await confirmDlg('Statistik zurücksetzen?', 'Alle Zähler dieses Boards werden auf 0 gesetzt.', { okLabel: 'Zurücksetzen', danger: true })) {
            board().stats = {};
            touch();
            emit('stats');
            render();
          }
          return false;
        },
      },
      { label: 'Fertig', primary: true },
    ],
  });
}

/** Lasche „Statistik“ am rechten Feldrand (unter den Notizen) – immer erreichbar */
export function initStatsTab(wrap) {
  const tab = h('button', { id: 'stats-tab', 'aria-label': 'Statistik öffnen', title: 'Statistik', onclick: openStats },
    h('span', { class: 'ic', html: I.stats }), h('span', { class: 'tx' }, 'Statistik'));
  wrap.append(tab);
}
