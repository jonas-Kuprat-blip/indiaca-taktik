import { h, colorCss } from '../util.js';
import { I } from '../icons.js';
import { COLORS } from '../model.js';

/** Modaler Dialog. actions: [{label, primary, danger, onClick}] – onClick darf false liefern, um offen zu bleiben. */
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const back = h('div', { class: 'modal-back' });
  const close = () => {
    back.remove();
    onClose && onClose();
  };
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-label': title },
    h('header', {},
      h('h2', {}, title),
      h('button', { class: 'btn', 'aria-label': 'Schließen', html: I.close, onclick: close })),
    h('section', { class: 'modal-body' }, body),
    actions.length
      ? h('footer', {}, actions.map((a) =>
          h('button', {
            class: 'btn text' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''),
            onclick: async () => {
              const r = a.onClick ? await a.onClick() : undefined;
              if (r !== false) close();
            },
          }, a.label)))
      : null);
  back.addEventListener('pointerdown', (e) => e.target === back && close());
  back.append(box);
  document.body.append(back);
  return { close, box };
}

export function promptText(title, value = '', { okLabel = 'OK', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input', { class: 'input', type: 'text', value, placeholder, enterkeyhint: 'done' });
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const m = modal({
      title,
      body: input,
      actions: [
        { label: 'Abbrechen', onClick: () => finish(null) },
        { label: okLabel, primary: true, onClick: () => finish(input.value.trim() || null) },
      ],
      onClose: () => finish(null),
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        finish(input.value.trim() || null);
        m.close();
      }
    });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  });
}

export function confirmDlg(title, text, { okLabel = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    modal({
      title,
      body: h('p', {}, text),
      actions: [
        { label: 'Abbrechen', onClick: () => finish(false) },
        { label: okLabel, primary: !danger, danger, onClick: () => finish(true) },
      ],
      onClose: () => finish(false),
    });
  });
}

/** Popover-Menü an einem Element. items: [{label, icon, danger, disabled, onClick}] */
export function menu(anchor, items) {
  const back = h('div', { class: 'pop-back' });
  const list = h('div', { class: 'pop' },
    items.filter(Boolean).map((it) =>
      h('button', {
        class: 'pop-item' + (it.danger ? ' danger' : ''),
        disabled: it.disabled,
        onclick: () => {
          back.remove();
          it.onClick();
        },
      }, it.icon ? h('span', { class: 'pop-ic', html: it.icon }) : null, it.label)));
  back.addEventListener('pointerdown', (e) => e.target === back && back.remove());
  back.append(list);
  document.body.append(back);
  place(list, anchor);
  return () => back.remove();
}

/** Farbauswahl als Popover */
export function colorPicker(anchor, current, onPick, { allowInk = true } = {}) {
  const back = h('div', { class: 'pop-back' });
  const close = () => back.remove();
  const sw = (c) =>
    h('button', {
      class: 'swatch-btn' + (c === current ? ' active' : ''),
      'aria-label': c === 'ink' ? 'Schwarz/Weiß' : c,
      onclick: () => {
        onPick(c);
        close();
      },
    }, h('span', { class: 'swatch', style: { background: colorCss(c) } }));
  const custom = h('input', { type: 'color', class: 'color-input', value: current?.startsWith('#') ? current : '#3b82f6' });
  custom.addEventListener('change', () => {
    onPick(custom.value);
    close();
  });
  const pop = h('div', { class: 'pop pop-colors' },
    h('div', { class: 'swatch-row' }, COLORS.filter((c) => allowInk || c !== 'ink').map(sw)),
    h('label', { class: 'custom-color' }, 'Eigene Farbe', custom));
  back.addEventListener('pointerdown', (e) => e.target === back && close());
  back.append(pop);
  document.body.append(back);
  place(pop, anchor);
}

function place(pop, anchor) {
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let x = r.left;
  let y = r.bottom + 6;
  if (x + pr.width > innerWidth - 8) x = innerWidth - pr.width - 8;
  if (y + pr.height > innerHeight - 8) y = r.top - pr.height - 6;
  pop.style.left = Math.max(8, x) + 'px';
  pop.style.top = Math.max(8, y) + 'px';
}

let toastT;
export function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = h('div', { class: 'toast' });
    document.body.append(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2200);
}
