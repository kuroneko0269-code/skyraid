// 設定 → データの「パイロット名を変更」（8-1 の事前修正）: 初回の入力と同じ検証（8 文字まで・制御文字を除く・空なら既定の名前）。
// オンライン連携中はサーバーの表示名（profiles.display_name）も変える。オンライン連携は動的 import なので、
// 読み込まれたときに setPilotRenameHook でつなぐ（ui/online-app.ts）
import './save.css';
import { t, tn } from '../core/i18n';
import { SAVE_CONFIG } from '../data/save';
import type { SaveStore } from '../progression/save-store';
import { el } from './hud-dom';
import { clipPilotNameInput, isolateKeys } from './pilot-name';

/** パイロット名を変えたときにサーバーの表示名も変える。画面に足す一言を返す（何もしなければ null） */
export type PilotRenameHook = (name: string) => Promise<string | null>;

let renameHook: PilotRenameHook | null = null;

/** オンライン連携から呼ぶ（ui/online-app.ts） */
export function setPilotRenameHook(hook: PilotRenameHook): void {
  renameHook = hook;
}

export function createPilotRename(
  panel: HTMLElement,
  save: SaveStore,
  /** 変えた後（タイトルの表示を直す） */
  onRenamed: (name: string) => void,
): void {
  const box = el('div', 'save-settings pilot-rename', panel);
  el('div', 'save-settings-heading', box, t('pilot.name'));
  const current = el('div', 'pilot-rename-current', box);
  const open = button(box, t('pilot.rename'));
  const form = el('form', 'pilot-rename-form', box);
  form.hidden = true;
  const input = el('input', 'ui-field pilot-name-input', form);
  input.type = 'text';
  input.placeholder = SAVE_CONFIG.defaultPilotName;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', t('pilot.newName'));
  clipPilotNameInput(input);
  isolateKeys(input);
  el(
    'div',
    'save-settings-status',
    form,
    tn('pilot.renameHint', SAVE_CONFIG.pilotNameMaxLength, {
      default: SAVE_CONFIG.defaultPilotName,
    }),
  );
  const row = el('div', 'save-settings-row', form);
  const submit = button(row, t('pilot.confirmRename'));
  submit.type = 'submit';
  const cancel = button(row, t('save.cancel'));
  const status = el('div', 'save-settings-status', box);
  status.hidden = true;

  const say = (text: string): void => {
    status.textContent = text;
    status.hidden = text === '';
  };
  const showCurrent = (): void => {
    current.textContent = t('pilot.current', {
      name: save.pilotName ?? SAVE_CONFIG.defaultPilotName,
    });
  };
  const close = (): void => {
    form.hidden = true;
    open.hidden = false;
  };

  open.addEventListener('click', () => {
    input.value = save.pilotName ?? '';
    form.hidden = false;
    open.hidden = true;
    say('');
    input.focus({ preventScroll: true });
  });
  cancel.addEventListener('click', () => {
    close();
    say('');
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    input.blur();
    const name = save.setPilotName(input.value);
    close();
    showCurrent();
    onRenamed(name);
    const done = t('pilot.renamed', { name });
    say(done);
    const hook = renameHook;
    if (!hook) return;
    submit.disabled = true;
    void hook(name)
      .then((extra) => {
        if (extra !== null) say(t('pilot.renamedWithExtra', { done, extra }));
      })
      .finally(() => {
        submit.disabled = false;
      });
  });
  showCurrent();
}

function button(parent: HTMLElement, label: string): HTMLButtonElement {
  const b = el('button', 'ui-toggle settings-item settings-button', parent, label);
  b.type = 'button';
  return b;
}
