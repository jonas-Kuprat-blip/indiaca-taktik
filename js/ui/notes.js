import { h } from '../util.js';
import { I } from '../icons.js';
import { on, page, setNotes, set } from '../store.js';

export function initNotes(root) {
  const title = h('div', { class: 'notes-title' });
  const ta = h('textarea', { class: 'notes-ta', placeholder: 'Notizen zu dieser Seite …' });
  ta.addEventListener('input', () => setNotes(ta.value));
  root.append(
    h('div', { class: 'notes-head' }, title,
      h('button', { class: 'btn', 'aria-label': 'Notizen einklappen', html: I.right, onclick: () => set({ notesOpen: false }) })),
    ta
  );
  let lastId = null;
  on('page', () => {
    const p = page();
    title.textContent = `Notizen · ${p.name}`;
    if (p.id !== lastId || document.activeElement !== ta) ta.value = p.notes || '';
    lastId = p.id;
  });
}
