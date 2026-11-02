// リザルトの「リプレイを保存」（7-B）: 押すと名前の欄が出て、保存すると永久保存（上限 30 本）にする。
// 3 つのリザルト（ミッション・レース・防衛戦）にそれぞれ置き、中身は ui/replay-link.ts が入れる
import { t } from '../core/i18n';
import { REPLAY_CONFIG } from '../data/replay';
import { el } from './hud-dom';
import { createButton } from './screen';

export class ReplaySaveBox {
  readonly root: HTMLDivElement;
  private readonly open: HTMLButtonElement;
  private readonly form: HTMLDivElement;
  private readonly name: HTMLInputElement;
  private readonly note: HTMLSpanElement;

  constructor(parent: HTMLElement, onSave: (name: string) => Promise<string>) {
    const root = el('div', 'replay-save', parent);
    this.open = createButton(root, 'ui-button replay-save-open', t('replay.save.open'), () => {
      this.form.hidden = false;
      this.open.hidden = true;
      this.name.focus();
      this.name.select();
    });
    this.form = el('div', 'replay-save-form', root);
    this.name = el('input', 'ui-field replay-name', this.form);
    this.name.type = 'text';
    this.name.maxLength = REPLAY_CONFIG.nameMax;
    this.name.setAttribute('aria-label', t('replay.save.nameLabel'));
    stopKeys(this.name);
    const save = createButton(this.form, 'ui-button is-primary', t('replay.save.save'), () => {
      save.disabled = true;
      void onSave(this.name.value).then((text) => {
        this.note.textContent = text;
        this.form.hidden = true;
        save.disabled = false;
      });
    });
    this.note = el('span', 'replay-save-note', root);
    this.root = root;
    this.reset('', false);
  }

  /** リザルトを出すたび: 既定の名前と、保存できるか（記録がなければ隠す） */
  reset(defaultName: string, available: boolean): void {
    this.root.hidden = !available;
    this.open.hidden = false;
    this.form.hidden = true;
    this.name.value = defaultName;
    this.note.textContent = '';
  }
}

/** 文字の入力欄のキーを飛行・メニューの操作（H・P など）に渡さない（Esc は戻るに使う） */
export function stopKeys(input: HTMLInputElement): void {
  input.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') e.stopPropagation();
  });
}
