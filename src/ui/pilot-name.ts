import './campaign.css';
import './save.css';
import { SAVE_CONFIG } from '../data/save';
import { truncateChars } from '../progression/save';
import { el } from './hud-dom';
import { createButton, createScreen, setScreenShown } from './screen';

/**
 * パイロット名の入力（3-1。初回起動だけ、タイトルの後）。8 文字まで、表示用。空のまま決定すると既定の名前。
 * 入力中のキーはゲームの操作（H で HUD など）に渡さない
 */
export class PilotNameScreen {
  readonly root: HTMLDivElement;
  private readonly input: HTMLInputElement;

  constructor(parent: HTMLElement, handlers: { onSubmit: (name: string) => void }) {
    const root = createScreen(parent, 'campaign-screen pilot-name-screen');
    const panel = el('div', 'ui-panel campaign-panel', root);
    el('div', 'ui-kicker campaign-kicker', panel, 'PILOT REGISTRATION');
    el('h2', 'ui-title campaign-title', panel, 'パイロット名');
    el(
      'p',
      'briefing-text',
      panel,
      `${SAVE_CONFIG.pilotNameMaxLength} 文字まで。リザルトとタイトルに表示します（空なら ${SAVE_CONFIG.defaultPilotName}）`,
    );
    const form = el('form', 'pilot-name-form', panel);
    this.input = el('input', 'ui-field pilot-name-input', form);
    this.input.type = 'text';
    this.input.placeholder = SAVE_CONFIG.defaultPilotName;
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.setAttribute('aria-label', 'パイロット名');
    // maxLength は UTF-16 単位なので、絵文字などで数え方がずれないよう input で切る。
    // 日本語の変換中に切ると変換が壊れるので、変換中は確定（compositionend）を待つ
    const clip = (): void => {
      const cut = truncateChars(this.input.value, SAVE_CONFIG.pilotNameMaxLength);
      if (cut !== this.input.value) this.input.value = cut;
    };
    this.input.addEventListener('input', (e) => {
      if (!(e instanceof InputEvent && e.isComposing)) clip();
    });
    this.input.addEventListener('compositionend', clip);
    isolateKeys(this.input);
    const buttons = el('div', 'campaign-buttons', form);
    const submit = createButton(
      buttons,
      'ui-button is-primary campaign-go',
      '決定',
      () => undefined,
    );
    submit.type = 'submit';
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.input.blur();
      handlers.onSubmit(this.input.value);
    });
    this.root = root;
  }

  setShown(shown: boolean): void {
    setScreenShown(this.root, shown);
    if (shown) this.input.focus({ preventScroll: true });
  }
}

/**
 * 文字入力のキーを window（ゲームの入力・タイトルの Enter）に届けない。
 * Esc だけは届けて、メニューを閉じる・戻る操作に使えるようにする
 */
export function isolateKeys(field: HTMLElement): void {
  const stop = (e: KeyboardEvent): void => {
    if (e.code !== 'Escape') e.stopPropagation();
  };
  field.addEventListener('keydown', stop);
  field.addEventListener('keyup', stop);
}
