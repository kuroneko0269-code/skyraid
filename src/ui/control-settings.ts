import './control-settings.css';
import type { ControlSettings } from '../core/control-settings';
import { t } from '../core/i18n';
import { AIM_ASSIST_LEVEL_LABELS, AIM_ASSIST_LEVELS } from '../data/assist';
import { BUTTON_SIZES, CONTROL_LABELS, CONTROL_SETTINGS } from '../data/controls';
import { STEER_LABELS, STICK_CURVES, STICK_POSITIONS, type StickCurve } from '../data/steer';
import type { SaveStore } from '../progression/save-store';
import { el } from './hud-dom';
import { createKeybindSettings } from './keybind-settings';
import { createToggleButton } from './mobile';
import type { SteerMode } from '../data/steer';
import { createSteerModeChoice } from './tilt-settings';
import type { TiltSource } from './tilt-source';

type ToggleKey = 'invertPitch' | 'autoLevel' | 'swapSides' | 'vibration' | 'autoFire';

/**
 * 操作設定（4-11）: ポーズメニューの設定の「操作」。感度・デッドゾーンのスライダー、ピッチ反転・オートレベル・
 * 左右入替・振動の ON/OFF、ボタンの大きさ、スティックの方式（9-4: 傾き・ドラッグ）・感度のカーブ・位置（9-2）、狙いの補助の強さ・自動射撃（9-3）、キー割当。変えるとすぐ apply で効かせ、セーブの settings.controls に保存する
 * （スライダーは離したときだけ保存）。設定の最下部（セーブデータ）より上に置く
 */
export function createControlSettings(
  panel: HTMLElement,
  save: SaveStore,
  vibrationSupported: boolean,
  tilt: TiltSource,
  apply: (c: Readonly<ControlSettings>) => void,
): { syncSteerMode: (mode: SteerMode) => void; sync: () => void } {
  const c = save.settings.controls;
  const changed = (persist: boolean, fn: (c: ControlSettings) => void): void => {
    if (persist) save.updateControls(fn);
    else fn(c);
    apply(c);
  };
  apply(c);

  const box = document.createElement('div');
  box.className = 'control-settings';
  el('div', 'control-settings-heading', box, t('controls.heading'));
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
  const toggle = (key: ToggleKey, label: string, enabled = true): ((on: boolean) => void) => {
    const t = createToggleButton(toggles, label, c[key], () => {
      changed(true, (x) => (x[key] = !x[key]));
      return c[key];
    });
    t.button.disabled = !enabled;
    return t.sync;
  };
  toggle('invertPitch', CONTROL_LABELS.invertPitch);
  toggle('autoLevel', CONTROL_LABELS.autoLevel);
  toggle('swapSides', CONTROL_LABELS.swapSides);
  if (vibrationSupported) toggle('vibration', CONTROL_LABELS.vibration);
  else toggle('vibration', CONTROL_LABELS.vibrationUnsupported, false);

  choice(
    toggles,
    CONTROL_LABELS.buttonSize,
    BUTTON_SIZES.map((v) => [v, CONTROL_LABELS.buttonSizes[v]] as const),
    c.buttonSize,
    (v) => {
      changed(true, (x) => (x.buttonSize = v));
    },
  );
  // 9-2: タッチのスティックの方式・感度のカーブ・位置（9-4: 傾き・ドラッグ。傾きは使えると分かってから保存する）
  const steerChoice = createSteerModeChoice(toggles, c, tilt, (v) => {
    changed(true, (x) => (x.steerMode = v));
  });
  const curve = choice(
    toggles,
    STEER_LABELS.curve,
    STICK_CURVES.map((v) => [v, curveLabel(v)] as const),
    c.stickCurve,
    (v) => {
      changed(true, (x) => (x.stickCurve = v));
    },
  );
  choice(
    toggles,
    STEER_LABELS.position,
    STICK_POSITIONS.map((v) => [v, STEER_LABELS.positions[v]] as const),
    c.stickPosition,
    (v) => {
      changed(true, (x) => (x.stickPosition = v));
    },
  );

  // 9-3: タッチの狙いの補助の強さと自動射撃
  const assist = choice(
    toggles,
    AIM_ASSIST_LEVEL_LABELS.title,
    AIM_ASSIST_LEVELS.map((v) => [v, AIM_ASSIST_LEVEL_LABELS.levels[v]] as const),
    c.aimAssist,
    (v) => {
      changed(true, (x) => (x.aimAssist = v));
    },
  );
  const autoFire = toggle('autoFire', AIM_ASSIST_LEVEL_LABELS.autoFire);

  createKeybindSettings(box, c, (fn) => {
    changed(true, fn);
  });
  panel.insertBefore(box, panel.querySelector(':scope > .save-settings'));
  return {
    syncSteerMode: steerChoice.sync,
    // 9-5: 練習場の設定（方式・補助・自動射撃・カーブ）で変えた値を表示に合わせ直す
    sync: () => {
      steerChoice.sync(c.steerMode);
      curve.value = String(c.stickCurve);
      assist.value = c.aimAssist;
      autoFire(c.autoFire);
    },
  };
}

/** カーブの表示（1.0（直線）/ 1.5 / 2.0） */
export function curveLabel(v: StickCurve): string {
  return v === 1 ? t('controls.steer.curveLinear') : v.toFixed(1);
}

/** 選択肢（select）1 つ。選んだら onChange（保存）。9-5: 練習場の設定でも使う */
export function choice<T extends string | number>(
  parent: HTMLElement,
  label: string,
  options: readonly (readonly [T, string])[],
  initial: T,
  onChange: (v: T) => void,
): HTMLSelectElement {
  const row = el('label', 'ui-toggle settings-item control-size', parent);
  row.textContent = `${label} `;
  const select = el('select', '', row);
  for (const [v, text] of options) {
    const option = el('option', '', select, text);
    option.value = String(v);
  }
  select.value = String(initial);
  select.addEventListener('change', () => {
    const found = options.find(([v]) => String(v) === select.value);
    if (found) onChange(found[0]);
    // フォーカスが残ると矢印キー（ピッチ/ロール）で値が変わってしまうため外す
    select.blur();
  });
  return select;
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
