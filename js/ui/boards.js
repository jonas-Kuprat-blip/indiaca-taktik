import { h } from '../util.js';
import { I } from '../icons.js';
import { FIELDS } from '../model.js';
import {
  state, on, openBoard, createBoard, renameBoard, duplicateBoard, deleteBoard, setFieldType, exportData, importData, board,
} from '../store.js';
import { modal, promptText, confirmDlg, toast } from './dialogs.js';
import { openNewBoard, openBoardSettings, boardTitle } from '../kader.js';

const fmt = (t) => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

export function openBoardManager() {
  const listEl = h('div', { class: 'board-list' });
  let m;

  const fieldSelect = (b) => {
    const s = h('select', { class: 'input select', 'aria-label': 'Feldtyp' },
      Object.entries(FIELDS).map(([k, f]) => h('option', { value: k, selected: b.fieldType === k }, f.short)));
    s.onchange = () => setFieldType(b.id, s.value);
    return s;
  };

  const render = () => {
    const bs = [...state.boards].sort((a, b) => b.updatedAt - a.updatedAt);
    listEl.replaceChildren(
      ...bs.map((b) =>
        h('div', { class: 'board-row' + (b.id === state.boardId ? ' current' : '') },
          h('button', { class: 'board-open', onclick: () => { openBoard(b.id); m.close(); } },
            h('div', { class: 'tpl-name' }, boardTitle(b)),
            h('div', { class: 'muted small' }, `${b.pages.length} Seite${b.pages.length === 1 ? '' : 'n'} · ${fmt(b.updatedAt)}`)),
          fieldSelect(b),
          h('button', { class: 'btn', title: 'Board-Einstellungen', 'aria-label': 'Board-Einstellungen', html: I.gear, onclick: () => openBoardSettings(b) }),
          h('button', { class: 'btn', title: 'Duplizieren', 'aria-label': 'Duplizieren', html: I.copy, onclick: () => duplicateBoard(b.id) }),
          h('button', { class: 'btn', title: 'Exportieren', 'aria-label': 'Exportieren', html: I.download, onclick: () => exportFile([b.id], b.name) }),
          h('button', {
            class: 'btn danger-ic', title: 'Löschen', 'aria-label': 'Löschen', html: I.trash,
            onclick: async () => { if (await confirmDlg('Board löschen?', `„${b.name}“ mit allen Seiten wird endgültig gelöscht.`, { okLabel: 'Löschen', danger: true })) deleteBoard(b.id); },
          })))
    );
  };

  const fileInput = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const { nb, nt } = await importData(JSON.parse(await file.text()));
      toast(`${nb} Board(s) und ${nt} Vorlage(n) importiert`);
    } catch (err) {
      toast('Import fehlgeschlagen: ' + err.message);
    }
  };

  const newBoardBtn = h('button', {
    class: 'btn text primary',
    onclick: () => openNewBoard(() => m.close()),
  }, '+ Neues Board');

  m = modal({
    title: 'Boards',
    wide: true,
    body: h('div', {},
      h('div', { class: 'board-actions' }, newBoardBtn,
        h('button', { class: 'btn text', html: I.download + 'Alles exportieren', onclick: () => exportFile(null, 'alle-boards') }),
        h('button', { class: 'btn text', html: I.upload + 'Importieren', onclick: () => fileInput.click() }),
        fileInput),
      listEl,
      h('p', { class: 'muted small' }, 'Alles wird lokal auf diesem Gerät gespeichert. Für ein Backup oder zum Übertragen auf ein anderes Gerät: Exportieren.')),
  });
  render();
  const off = () => document.body.contains(m.box) && render();
  on('boards', off);
}

async function exportFile(ids, name) {
  const json = JSON.stringify(exportData(ids), null, 1);
  const safe = name.replace(/[^\wäöüÄÖÜß-]+/g, '_').slice(0, 40);
  const filename = `taktik-${safe}-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], filename, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = h('a', { href: URL.createObjectURL(file), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}
