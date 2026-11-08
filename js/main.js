import * as store from './store.js';
import { initStage } from './stage.js';
import { initToolbar } from './ui/toolbar.js';
import { initPalette } from './ui/palette.js';
import { initPagebar } from './ui/pagebar.js';
import { initNotes } from './ui/notes.js';
import { initSelectionBar } from './ui/selection.js';
import { initAnim } from './anim.js';
import { initStatsTab } from './ui/stats.js';

// iOS: Pinch-Zoom & Doppeltipp-Zoom der Seite unterbinden
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

async function start() {
  await store.init();
  const wrap = document.getElementById('stage-wrap');
  initStage(wrap);
  initSelectionBar(wrap);
  initAnim(wrap);
  initToolbar(document.getElementById('toolbar'));
  initPalette(document.getElementById('palette'));
  initNotes(document.getElementById('notes'), wrap);
  initStatsTab(wrap);
  initPagebar(document.getElementById('pagebar'));
  store.emit('board');
  store.emit('page');
  store.emit('elements');
  store.emit('ui');

  // Tastatur (Desktop / iPad mit Tastatur)
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? store.redo() : store.undo();
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && store.state.selectionId) {
      const id = store.state.selectionId;
      store.commit((p) => (p.elements = p.elements.filter((x) => x.id !== id)));
      store.select(null);
    } else if (e.key === 'Escape') store.select(null);
  });

  // Beim Verlassen sofort speichern
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && store.flushNow());
  addEventListener('pagehide', () => store.flushNow());

  // Daten vor automatischem Löschen durch den Browser schützen
  navigator.storage?.persist?.();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW-Registrierung fehlgeschlagen', err));
  }
}

start().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<div class="fatal">Fehler beim Start: ${String(err.message || err)}</div>`);
});
