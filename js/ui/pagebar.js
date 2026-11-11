import { h, debounce } from '../util.js';
import { I } from '../icons.js';
import { FIELDS } from '../model.js';
import {
  state, on, board, page, pageIndex, switchPage, addPage, makePage, copyCurrentPage, renamePage, deletePage,
  movePage, commit, setHalf, setOrientation, pageOrientation, saveTemplate, pageFromTemplate, renameTemplate, deleteTemplate,
} from '../store.js';
import { thumbSVG } from '../render.js';
import { makeAnimPage, exampleTemplates } from '../anim.js';
import { menu, modal, promptText, confirmDlg, toast } from './dialogs.js';

let list;

export function initPagebar(root) {
  list = h('div', { class: 'pages' });
  const addBtn = h('button', { class: 'btn add-page', 'aria-label': 'Neue Seite', title: 'Neue Seite', html: I.plus, onclick: newPageDialog });
  root.append(list, addBtn);
  bindPointer();

  on(['page', 'board'], renderAll);
  const updActive = debounce(() => {
    const t = list.querySelector('.thumb.active .thumb-svg');
    if (t) t.innerHTML = thumbSVG(page(), board());
  }, 250);
  on('elements', updActive);
}

function renderAll() {
  const b = board();
  list.replaceChildren(
    ...b.pages.map((p) =>
      h('div', { class: 'thumb' + (p.id === state.pageId ? ' active' : ''), 'data-id': p.id },
        h('div', { class: 'thumb-svg', html: thumbSVG(p, b) }),
        h('div', { class: 'thumb-name' }, p.kind === 'angabe' ? h('span', { class: 'badge' }, 'A') : null, p.kind === 'anim' ? h('span', { class: 'badge anim' }, '▶') : null, p.half ? h('span', { class: 'badge half' }, '½') : null, p.name)))
  );
  list.querySelector('.thumb.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** Eigene Pointer-Logik: Wischen = scrollen, Tippen = wechseln, lange halten + ziehen = sortieren */
function bindPointer() {
  let g = null;
  list.addEventListener('pointerdown', (e) => {
    if (g) return;
    const thumb = e.target.closest('.thumb');
    list.setPointerCapture(e.pointerId);
    const vert = getComputedStyle(list).flexDirection === 'column'; // Handy-Panel: senkrechte Liste
    g = { id: e.pointerId, thumb, x0: e.clientX, y0: e.clientY, vert, scroll0: vert ? list.scrollTop : list.scrollLeft, mode: 'pending' };
    if (thumb)
      g.timer = setTimeout(() => {
        if (g && g.mode === 'pending') {
          g.mode = 'reorder';
          g.from = [...list.children].indexOf(thumb);
          g.to = g.from;
          thumb.classList.add('lifted');
          navigator.vibrate?.(10);
        }
      }, 380);
  });
  list.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    const d = g.vert ? dy : dx;
    if (g.mode === 'pending' && Math.hypot(dx, dy) > 8) {
      g.mode = 'scroll';
      clearTimeout(g.timer);
    }
    if (g.mode === 'scroll') {
      if (g.vert) list.scrollTop = g.scroll0 - d;
      else list.scrollLeft = g.scroll0 - d;
    }
    if (g.mode === 'reorder') {
      g.thumb.style.transform = g.vert ? `translateY(${d}px)` : `translateX(${d}px)`;
      const others = [...list.children].filter((c) => c !== g.thumb);
      let to = 0;
      for (const c of others) {
        const r = c.getBoundingClientRect();
        if (g.vert ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2) to++;
      }
      g.to = to;
      others.forEach((c, i) => {
        c.classList.toggle('drop-before', i === to);
        c.classList.toggle('drop-after', to === others.length && i === others.length - 1);
      });
    }
  });
  const end = (e, cancelled) => {
    if (!g || e.pointerId !== g.id) return;
    clearTimeout(g.timer);
    const cur = g;
    g = null;
    [...list.children].forEach((c) => {
      c.classList.remove('drop-before', 'drop-after', 'lifted');
      c.style.transform = '';
    });
    if (cancelled) return;
    if (cur.mode === 'pending' && cur.thumb) {
      const id = cur.thumb.dataset.id;
      if (id === state.pageId) pageMenu(cur.thumb);
      else switchPage(id);
    } else if (cur.mode === 'reorder') movePage(cur.from, cur.to);
  };
  list.addEventListener('pointerup', (e) => end(e, false));
  list.addEventListener('pointercancel', (e) => end(e, true));
  list.addEventListener('contextmenu', (e) => e.preventDefault());
}

function pageMenu(anchor) {
  const p = page();
  const i = pageIndex();
  const n = board().pages.length;
  menu(anchor, [
    { label: 'Umbenennen', icon: I.edit, onClick: async () => { const v = await promptText('Seite umbenennen', p.name); if (v) renamePage(p.id, v); } },
    { label: 'Duplizieren', icon: I.copy, onClick: copyCurrentPage },
    { label: 'Als Vorlage speichern', icon: I.star, onClick: async () => { const v = await promptText('Name der Vorlage', p.name); if (v) { await saveTemplate(v); toast('Vorlage gespeichert'); } } },
    { label: pageOrientation(p) === 'quer' ? 'Feld hochkant stellen' : 'Feld quer kippen', icon: I.rotate, onClick: () => setOrientation(pageOrientation(p) === 'quer' ? 'hoch' : 'quer') },
    { label: p.half ? 'Ganzes Feld zeigen' : 'Nur eigene Feldhälfte', icon: I.half, onClick: () => setHalf(!p.half) },
    { label: 'Nach links', icon: I.left, disabled: i === 0, onClick: () => movePage(i, i - 1) },
    { label: 'Nach rechts', icon: I.right, disabled: i === n - 1, onClick: () => movePage(i, i + 1) },
    { label: 'Seite leeren', icon: I.clear, onClick: () => commit((pg) => (pg.elements = [])) },
    {
      label: 'Löschen', icon: I.trash, danger: true, disabled: n === 1,
      onClick: async () => { if (await confirmDlg('Seite löschen?', `„${p.name}“ wird gelöscht.`, { okLabel: 'Löschen', danger: true })) deletePage(p.id); },
    },
  ]);
}

export function newPageDialog() {
  const tplBox = h('div', { class: 'tpl-list' });
  let m;
  const pick = (fn) => () => {
    fn();
    m.close();
  };
  const renderTpl = () => {
    const ts = [...state.templates].sort((a, b) => a.name.localeCompare(b.name));
    tplBox.replaceChildren(
      ...(ts.length
        ? ts.map((t) =>
            h('div', { class: 'tpl-row' },
              h('button', { class: 'tpl-open', onclick: pick(() => addPage(pageFromTemplate(t))) },
                h('div', { class: 'tpl-thumb', html: thumbSVG(t.page, { ...board(), fieldType: t.fieldType || board().fieldType }) }),
                h('div', {}, h('div', { class: 'tpl-name' }, t.name), h('div', { class: 'muted small' }, (FIELDS[t.fieldType]?.short || '') + (t.page.kind === 'angabe' ? ' · Angabe' : t.page.kind === 'anim' ? ` · Animation (${t.page.anim?.steps?.length || 1} Schritte)` : '')))),
              h('button', { class: 'btn', 'aria-label': 'Umbenennen', html: I.edit, onclick: async () => { const v = await promptText('Vorlage umbenennen', t.name); if (v) { await renameTemplate(t.id, v); renderTpl(); } } }),
              h('button', { class: 'btn', 'aria-label': 'Löschen', html: I.trash, onclick: async () => { if (await confirmDlg('Vorlage löschen?', `„${t.name}“ wird gelöscht.`, { okLabel: 'Löschen', danger: true })) { await deleteTemplate(t.id); renderTpl(); } } })))
        : [h('p', { class: 'muted' }, 'Noch keine Vorlagen. Öffne das Menü einer Seite (aktive Seite antippen) → „Als Vorlage speichern“.')])
    );
  };
  renderTpl();
  const opt = (icon, title, sub, fn) =>
    h('button', { class: 'big-opt', onclick: pick(fn) }, h('span', { class: 'big-ic', html: icon }), h('span', {}, h('b', {}, title), h('span', { class: 'muted small' }, sub)));
  m = modal({
    title: 'Neue Seite',
    wide: true,
    body: h('div', {},
      h('div', { class: 'big-opts' },
        opt(I.rect, 'Leeres Feld', 'Hochkant', () => addPage(makePage('taktik', false, 'hoch'))),
        opt(I.rotate, 'Querfeld', 'Feld quer, Netz senkrecht', () => addPage(makePage('taktik', false, 'quer'))),
        opt(I.half, 'Eigene Feldhälfte', 'Nur unsere Hälfte, größer', () => addPage(makePage('taktik', true))),
        opt(I.serve, 'Angabe-Seite', 'Ziele mit Kreuzen', () => addPage(makePage('angabe'))),
        opt(I.anim, 'Animation', 'Spielzug Schritt für Schritt', () => addPage(makeAnimPage())),
        opt(I.copy, 'Kopie dieser Seite', page().name, copyCurrentPage)),
      h('h3', {}, 'Beispiel-Animationen'),
      h('div', { class: 'tpl-list' }, exampleTemplates().map((t) =>
        h('div', { class: 'tpl-row' },
          h('button', { class: 'tpl-open', onclick: pick(() => addPage(pageFromTemplate(t))) },
            h('div', { class: 'tpl-thumb', html: thumbSVG(t.page, board()) }),
            h('div', {}, h('div', { class: 'tpl-name' }, t.name), h('div', { class: 'muted small' }, `Animation · ${t.page.anim.steps.length} Schritte`)))))),
      h('h3', {}, 'Eigene Vorlagen'),
      tplBox),
  });
}
