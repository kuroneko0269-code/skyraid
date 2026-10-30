import './control-settings.css';
import type { ControlSettings } from '../core/control-settings';
import { BUTTON_SIZES, CONTROL_LABELS, CONTROL_SETTINGS, type ButtonSize } from '../data/controls';
import type { SaveStore } from '../progression/save-store';
import { el } from './hud-dom';
import { createKeybindSettings } from './keybind-settings';
import { createToggleButton } from './mobile';

type ToggleKey = 'invertPitch' | 'autoLevel' | 'swapSides' | 'vibration';

/**
 * 操作設定（4-11）: ポーズメニューの設定の「操作」。感度・デッドゾーンのスライダー、ピッチ反転・オートレベル・
 * 左右入替・振動の ON/OFF、ボタンの大きさ、キー割当。変えるとすぐ apply で効かせ、セーブの settings.controls に保存する
 * （スライダーは離したときだけ保存）。設定の最下部（セーブデータ）より上に置く
 */
export function createControlSettings(
  panel: HTMLElement,
  save: SaveStore,
  vibrationSupported: boolean,
  apply: (c: Readonly<ControlSettings>) => void,
): void {
  const c = save.settings.controls;
  const changed = (persist: boolean, fn: (c: ControlSettings) => void): void => {
    if (persist) save.updateControls(fn);
    else fn(c);
    apply(c);
  };
  apply(c);

  const box = document.createElement('div');
  box.className = 'control-settings';
  el('div', 'control-settings-heading', box, '操作');
  const s = CONTROL_SETTINGS;
  slider(
    box,
    CONTROL_LABELS.sensitivity,
    s.sensitivity,
    c.sensitivity,
    (v) => v.toFixed(1),
    (v, persist) => {
      changed(persist, (x) => (x.sensitivity = v));
    },
  );
  slider(
    box,
    CONTROL_LABELS.deadzone,
    s.deadzone,
    c.deadzone,
    (v) => `${Math.round(v * 100)}%`,
    (v, persist) => {
      changed(persist, (x) => (x.deadzone = v));
    },
  );

  const toggles = el('div', 'control-settings-toggles', box);
  const toggle = (key: ToggleKey, label: string, enabled = true): void => {
    const t = createToggleButton(toggles, label, c[key], () => {
      changed(true, (x) => (x[key] = !x[key]));
      return c[key];
    });
    t.button.disabled = !enabled;
  };
  toggle('invertPitch', CONTROL_LABELS.invertPitch);
  toggle('autoLevel', CONTROL_LABELS.autoLevel);
  toggle('swapSides', CONTROL_LABELS.swapSides);
  if (vibrationSupported) toggle('vibration', CONTROL_LABELS.vibration);
  else toggle('vibration', CONTROL_LABELS.vibrationUnsupported, false);

  const sizeLabel = el('label', 'ui-toggle settings-item control-size', toggles);
  sizeLabel.textContent = `${CONTROL_LABELS.buttonSize} `;
  const select = el('select', '', sizeLabel);
  for (const size of BUTTON_SIZES) {
    const option = el('option', '', select, CONTROL_LABELS.buttonSizes[size]);
    option.value = size;
  }
  select.value = c.buttonSize;
  select.addEventListener('change', () => {
    const v = select.value;
    if ((BUTTON_SIZES as readonly string[]).includes(v))
      changed(true, (x) => (x.buttonSize = v as ButtonSize));
    select.blur();
  });

  createKeybindSettings(box, c, (fn) => {
    changed(true, fn);
  });
  panel.insertBefore(box, panel.querySelector(':scope > .save-settings'));
}

/** スライダー 1 本。動かしている間は onChange(v, false)、離したら onChange(v, true)（保存） */
function slider(
  parent: HTMLElement,
  label: string,
  range: { readonly min: number; readonly max: number; readonly step: number },
  initial: number,
  format: (v: number) => string,
  onChange: (v: number, persist: boolean) => void,
): void {
  const row = el('label', 'ui-toggle settings-item control-slider', parent);
  el('span', 'control-slider-name', row, label);
  const input = el('input', '', row);
  input.type = 'range';
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  input.value = String(initial);
  input.setAttribute('aria-label', label);
  const value = el('span', 'control-slider-value', row, format(initial));
  input.addEventListener('input', () => {
    const v = Number(input.value);
    value.textContent = format(v);
    onChange(v, false);
  });
  input.addEventListener('change', () => {
    onChange(Number(input.value), true);
    // フォーカスが残ると矢印キー（ピッチ/ロール）で値が変わってしまうため外す
    input.blur();
  });
}
