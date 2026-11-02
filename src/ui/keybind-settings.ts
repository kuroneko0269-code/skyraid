// キー割当の変更（4-11。操作設定の一部）: 主要 12 アクションの主キー。ボタンを押してから割り当てたいキーを押す。
// Esc で取り消し。ほかのアクションと重なったら警告を出す（割り当てはする。重なったキーは両方のアクションが効く）
import {
  buildKeyBindings,
  conflictsOf,
  isAssignableCode,
  keyLabel,
  type ControlSettings,
} from '../core/control-settings';
import { t } from '../core/i18n';
import { CONTROL_LABELS, REMAPPABLE_ACTIONS, type RemappableAction } from '../data/controls';
import type { Action } from '../data/keybinds';
import { el } from './hud-dom';

/** 警告に出すアクション名（割り当てを変えられないもの）の文言のキー */
const OTHER_ACTION_KEYS: Partial<Record<Action, string>> = {
  targetNext: 'controls.otherActions.targetNext',
  cameraToggle: 'controls.otherActions.cameraToggle',
  rocket: 'controls.otherActions.rocket',
  bomb: 'controls.otherActions.bomb',
  debugToggle: 'controls.otherActions.debugToggle',
  hudToggle: 'controls.otherActions.hudToggle',
};

function actionName(a: Action): string {
  const remappable = (CONTROL_LABELS.actions as Partial<Record<Action, string>>)[a];
  if (remappable !== undefined) return remappable;
  const key = OTHER_ACTION_KEYS[a];
  return key ? t(key) : a;
}

export function createKeybindSettings(
  parent: HTMLElement,
  controls: Readonly<ControlSettings>,
  change: (fn: (c: ControlSettings) => void) => void,
): void {
  const box = el('div', 'keybind-settings', parent);
  // 一覧は長いので「キー割当 ▼」で開閉する（初めは閉じる）
  const toggle = el('button', 'ui-toggle settings-item settings-button keybind-toggle', box);
  toggle.type = 'button';
  const list = el('div', 'keybind-list', box);
  let listOpen = false;
  const setOpen = (open: boolean): void => {
    listOpen = open;
    list.hidden = !open;
    toggle.textContent = `${CONTROL_LABELS.keys} ${open ? '▲' : '▼'}`;
    toggle.setAttribute('aria-expanded', String(open));
  };
  setOpen(false);
  toggle.addEventListener('click', () => {
    toggle.blur();
    setOpen(!listOpen);
  });
  const rows = new Map<RemappableAction, { key: HTMLButtonElement; warn: HTMLDivElement }>();
  let waiting: RemappableAction | null = null;

  const refresh = (): void => {
    const bindings = buildKeyBindings(controls.keys);
    for (const [action, row] of rows) {
      // 主キーと、残っている初期のキー（矢印など）
      const codes = bindings[action];
      row.key.textContent =
        waiting === action
          ? t('controls.pressKey')
          : codes.length > 0
            ? codes.map(keyLabel).join(' / ')
            : '—';
      row.key.classList.toggle('is-waiting', waiting === action);
      const others = conflictsOf(bindings, action);
      row.warn.hidden = others.length === 0;
      row.warn.textContent = others.length
        ? t('controls.conflict', {
            names: others.map(actionName).join(t('controls.listSeparator')),
          })
        : '';
    }
  };

  // 割り当て待ちの間は、押したキーをゲームの操作に渡さない（window の capture で先に受ける）
  const onKey = (e: KeyboardEvent): void => {
    if (waiting === null) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const action = waiting;
    stopWaiting();
    if (e.code !== 'Escape' && isAssignableCode(e.code)) {
      change((c) => {
        c.keys[action] = e.code;
      });
    }
    refresh();
  };
  const stopWaiting = (): void => {
    waiting = null;
    window.removeEventListener('keydown', onKey, true);
  };

  for (const action of REMAPPABLE_ACTIONS) {
    const row = el('div', 'keybind-row', list);
    el('span', 'keybind-name', row, CONTROL_LABELS.actions[action]);
    const key = el('button', 'ui-button keybind-key', row);
    key.type = 'button';
    const warn = el('div', 'keybind-warn', row);
    key.addEventListener('click', () => {
      key.blur();
      if (waiting === action) stopWaiting();
      else {
        if (waiting === null) window.addEventListener('keydown', onKey, true);
        waiting = action;
      }
      refresh();
    });
    rows.set(action, { key, warn });
  }
  const reset = el('button', 'ui-button is-ghost keybind-reset', list, t('controls.resetKeys'));
  reset.type = 'button';
  reset.addEventListener('click', () => {
    reset.blur();
    stopWaiting();
    change((c) => {
      c.keys = {};
    });
    refresh();
  });
  refresh();
}
