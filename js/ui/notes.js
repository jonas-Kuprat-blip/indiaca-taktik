import { h } from '../util.js';
import { I } from '../icons.js';
import { on, page, setNotes, set, state } from '../store.js';

/** Notizzettel pro Seite: gelber Zettel, der von rechts über das Feld aufklappt */
export function initNotes(root, wrap) {
  wrap.append(root); // Zettel liegt über dem Feld statt eine eigene Spalte zu belegen
  const title = h('div', { class: 'notes-title' });
  const ta = h('textarea', { class: 'notes-ta', placeholder: 'Notizen zu dieser Seite …' });
  ta.addEventListener('input', () => setNotes(ta.value));
  root.append(
    h('div', { class: 'notes-head' }, title,
      h('button', { class: 'btn', 'aria-label': 'Notizzettel zuklappen', title: 'Zuklappen', html: I.right, onclick: () => set({ notesOpen: false }) })),
    ta
  );
  // Lasche am rechten Rand
  const tab = h('button', { id: 'notes-tab', 'aria-label': 'Notizzettel aufklappen', title: 'Notizen', onclick: () => set({ notesOpen: true }) },
    h('span', { class: 'ic', html: I.notes }), h('span', { class: 'tx' }, 'Notizen'));
  wrap.append(tab);

  let lastId = null;
  on('page', () => {
    const p = page();
    title.textContent = p.name;
    if (p.id !== lastId || document.activeElement !== ta) ta.value = p.notes || '';
    lastId = p.id;
  });
  const upd = () => tab.classList.toggle('has-notes', !!page()?.notes?.trim());
  on(['page', 'notes'], upd);
  on('ui', () => {
    upd();
    if (!state.notesOpen && document.activeElement === ta) ta.blur();
  });
}
