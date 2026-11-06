// 補助の組（9-5d）の画面の部品: 組を選ぶセグメント（かんたん / ふつう / むずかしい）と今の値の一行（違えば「カスタム」）、
// 初めての人・今の利用者に一度だけ出す「補助の組を選んでください」のダイアログ。値は src/core/assist-preset.ts
import { noteScreenSwitch } from './screen-switch';
import './assist-preset.css';
import { assistPresetOf, isAssistPreset, type AssistPresetState } from '../core/assist-preset';
import type { ControlSettings } from '../core/control-settings';
import { t } from '../core/i18n';
import {
  AIM_ASSIST_LEVEL_LABELS,
  ASSIST_PRESETS,
  type AssistPreset,
  type AssistPresetValues,
} from '../data/assist';
import { el } from './hud-dom';
import { createButton } from './screen';
import { Segmented } from './segmented';

export function assistPresetName(p: AssistPresetState): string {
  return t(`controls.preset.${p}`);
}

/** 「狙いの補助 標準・自動射撃 ON・速度合わせ ON」 */
export function assistPresetSummary(v: Readonly<AssistPresetValues>): string {
  const onOff = (b: boolean): string => t(b ? 'controls.preset.on' : 'controls.preset.off');
  return t('controls.preset.summary', {
    aim: AIM_ASSIST_LEVEL_LABELS.levels[v.aimAssist],
    fire: onOff(v.autoFire),
    speed: onOff(v.speedMatch),
  });
}

/** 組を選ぶ欄（設定の「操作」・練習場の設定の欄・チュートリアルの補助の章） */
export class AssistPresetChoice {
  readonly root: HTMLDivElement;
  private readonly seg: Segmented;
  private readonly status: HTMLDivElement;

  constructor(
    parent: HTMLElement,
    private readonly controls: () => Readonly<ControlSettings>,
    onPick: (p: AssistPreset) => void,
    /** short: 今の値の一行は「カスタム」のときだけ名前を出す（練習場の欄。下に個別の値が並ぶので） */
    private readonly opts: {
      readonly note?: boolean;
      readonly className?: string;
      readonly short?: boolean;
    } = {},
  ) {
    this.root = el('div', `assist-preset ${opts.className ?? ''}`.trim(), parent);
    this.seg = new Segmented(
      this.root,
      t('controls.preset.title'),
      ASSIST_PRESETS.map((p) => ({ value: p, label: assistPresetName(p) })),
      '',
      (v) => {
        if (isAssistPreset(v)) onPick(v);
        this.sync();
      },
      'assist-preset-seg',
    );
    this.status = el('div', 'assist-preset-status', this.root);
    if (opts.note) el('div', 'assist-preset-note', this.root, t('controls.preset.note'));
    this.sync();
  }

  /** 今の値に合わせる（カスタムなら選択なし） */
  sync(): void {
    const c = this.controls();
    const state = assistPresetOf(c);
    this.seg.value = state === 'custom' ? '' : state;
    this.root.classList.toggle('is-custom', state === 'custom');
    if (this.opts.short) {
      this.status.textContent = state === 'custom' ? assistPresetName(state) : '';
      this.status.hidden = state !== 'custom';
      return;
    }
    this.status.textContent = t('controls.preset.status', {
      name: assistPresetName(state),
      summary: assistPresetSummary(c),
    });
  }
}

/**
 * 一度だけの「補助の組を選んでください」（モード選択の上に重ねる）。keep（今の利用者）なら「今の設定のまま」も出す。
 * 選んだ・閉じた後に done
 */
export class AssistPresetPrompt {
  private readonly wrap: HTMLDivElement;
  private readonly buttons: HTMLDivElement;
  private readonly keepButton: HTMLButtonElement;
  private readonly choices = new Map<AssistPreset, HTMLButtonElement>();
  private done: (() => void) | null = null;

  constructor(
    root: HTMLElement,
    private readonly controls: () => Readonly<ControlSettings>,
    private readonly onPick: (p: AssistPreset) => void,
  ) {
    this.wrap = el('div', 'mode-prompt assist-preset-prompt', root);
    this.wrap.hidden = true;
    const box = el('div', 'ui-dialog mode-prompt-box mode-prompt-wide', this.wrap);
    el('h3', 'ui-heading mode-prompt-title', box, t('controls.preset.prompt.title'));
    el('p', 'mode-prompt-text', box, t('controls.preset.prompt.body'));
    this.buttons = el('div', 'assist-preset-choices', box);
    for (const p of ASSIST_PRESETS) {
      const b = createButton(this.buttons, 'ui-button ui-item assist-preset-card', '', () => {
        this.onPick(p);
        this.finish();
      });
      b.dataset.preset = p;
      el('span', 'assist-preset-card-name', b, assistPresetName(p));
      el('span', 'assist-preset-card-desc', b, t(`controls.preset.desc.${p}`));
      this.choices.set(p, b);
    }
    const row = el('div', 'campaign-buttons', box);
    this.keepButton = createButton(row, 'ui-button is-ghost campaign-back', '', () => {
      this.finish();
    });
    el('p', 'mode-prompt-text assist-preset-note', box, t('controls.preset.note'));
  }

  get open(): boolean {
    return !this.wrap.hidden;
  }

  show(keep: boolean, done: () => void): void {
    this.done = done;
    const state = assistPresetOf(this.controls());
    this.keepButton.textContent = t('controls.preset.prompt.keep', {
      name: assistPresetName(state),
    });
    this.keepButton.hidden = !keep;
    // 9-11a: 出したタップが選択のボタンへ押し抜けない（9-9b）
    noteScreenSwitch();
    this.wrap.hidden = false;
    this.wrap.scrollTop = 0;
    // 初期値（かんたん）にフォーカス（Enter で決められる）
    this.choices.get(state === 'custom' ? 'easy' : state)?.focus({ preventScroll: true });
  }

  /** 開いていれば閉じて true（Esc = 今のまま） */
  close(): boolean {
    if (this.wrap.hidden) return false;
    this.finish();
    return true;
  }

  private finish(): void {
    this.wrap.hidden = true;
    // 9-11a: 閉じて出た下の画面のボタンへ押し抜けない
    noteScreenSwitch();
    const d = this.done;
    this.done = null;
    d?.();
  }
}
