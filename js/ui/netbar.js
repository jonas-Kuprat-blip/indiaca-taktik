import { h, colorCss } from '../util.js';
import { on, page, touch, emit } from '../store.js';
import { isNet, netCfg, netHeights, NET_PRESETS, usedColors, legendLabel, fmtM } from '../net.js';
import { promptText } from './dialogs.js';

/*
 * Leiste oben in der Netzansicht: Netzhöhe (Voreinstellung/manuell), Hilfslinien, Einrasten, Legende.
 */
export function initNetBar(wrap) {
  const bar = h('div', { id: 'netbar' });
  wrap.append(bar);
  const save = () => {
    touch();
    emit('page');
    emit('elements');
  };
  const render = () => {
    const p = page();
    const show = !!p && isNet(p);
    bar.classList.toggle('show', show);
    wrap.classList.toggle('net', show);
    if (!show) return bar.replaceChildren();
    const cfg = netCfg(p);
    const hs = netHeights();
    const sel = h('select', { class: 'input select nb-sel', 'aria-label': 'Netzhöhe' },
      NET_PRESETS.map(([k, l]) => h('option', { value: k, selected: cfg.preset === k }, k === 'manuell' ? 'Manuell' : `${l} ${fmtM(hs[k])}`)));
    sel.onchange = () => {
      cfg.preset = sel.value;
      netCfg(p);
      save();
    };
    const man = cfg.preset === 'manuell'
      ? (() => {
          const i = h('input', { class: 'input nb-h', type: 'text', inputmode: 'decimal', value: String(cfg.hoehe).replace('.', ','), 'aria-label': 'Netzhöhe in Metern' });
          i.addEventListener('focus', () => i.select());
          i.onchange = () => {
            const v = parseFloat(i.value.replace(',', '.'));
            if (v > 0.5 && v < 4) cfg.hoehe = Math.round(v * 100) / 100;
            save();
          };
          return h('label', { class: 'nb-man' }, i, 'm');
        })()
      : null;
    const tog = (key, label) =>
      h('button', { class: 'btn text nb-tog' + (cfg[key] ? ' on' : ''), 'aria-pressed': String(cfg[key]), onclick: () => { cfg[key] = !cfg[key]; save(); } }, label);
    const cols = usedColors(p);
    const legend = cols.length
      ? h('div', { class: 'nb-legend', 'aria-label': 'Legende' }, cols.map((c) =>
          h('button', {
            class: 'lg-i', title: 'Bedeutung ändern',
            onclick: async () => {
              const v = await promptText('Bedeutung der Farbe', legendLabel(p, c), { placeholder: 'z. B. Angriff' });
              if (v != null) { cfg.legende[c] = v; save(); }
            },
          }, h('i', { style: { background: colorCss(c) } }), legendLabel(p, c) || 'Bedeutung?')))
      : null;
    const view = h('div', { class: 'seg nb-view', role: 'group', 'aria-label': 'Ansicht' },
      [['2d', '2D frontal'], ['3d', '3D Perspektive']].map(([k, l]) => h('button', { class: 'seg-btn' + (cfg.view === k ? ' active' : ''), onclick: () => { cfg.view = k; save(); } }, l)));
    bar.replaceChildren(...[view, h('span', { class: 'nb-t' }, 'Netz'), sel, man, tog('hilfslinien', 'Hilfslinien'), tog('einrasten', 'Am Netz einrasten'), legend].filter(Boolean));
  };
  on(['page', 'board', 'elements'], render);
  render();
}
