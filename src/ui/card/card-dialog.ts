// 記録カード（8-5）の画面: 結果画面の「記録カード」で開く。プレビュー・パイロット名を載せるか（既定は載せる）・共有の文面と、
// ファイル付きの Web Share API が使えれば「共有」、使えなければ「画像を保存」「文面をコピー」。
// 8-2 と同じく別のチャンク（card-entry.ts が初めて開くときに読む）。生成と保存は通信なしでできる
import type { CardSource } from '../../core/card-source';
import { t } from '../../core/i18n';
import { photoFileName } from '../../core/photo-capture';
import { CARD_CONFIG, CARD_SIZE, CARD_SIZES } from '../../data/card';
import { el } from '../hud-dom';
import { createButton } from '../screen';
import { canvasToPng, drawCard, waitForCardFonts } from './card-canvas';
import { buildCardModel, cardShareText } from './card-model';
import './card.css';

/** お知らせを出しておく時間（ms） */
const STATUS_MS = 4000;

/** 遊べる URL（今開いているアプリの入口。クエリ・パスは付けない） */
export function playUrl(): string {
  return `${window.location.origin}/`;
}

export class CardDialog {
  readonly root: HTMLDivElement;
  private readonly preview: HTMLImageElement;
  private readonly pilot: HTMLInputElement;
  private readonly pilotRow: HTMLLabelElement;
  private readonly text: HTMLTextAreaElement;
  private readonly status: HTMLDivElement;
  private readonly shareButton: HTMLButtonElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly copyButton: HTMLButtonElement;
  private source: CardSource | null = null;
  private scene: HTMLCanvasElement | null = null;
  private file: File | null = null;
  private previewUrl = '';
  private statusTimer = 0;
  /** 作り直しの番号（古い生成の結果を捨てる） */
  private generation = 0;

  constructor(parent: HTMLElement) {
    const root = el('div', 'card-overlay', parent);
    root.hidden = true;
    const box = el('div', 'ui-dialog card-dialog', root);
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', t('card.title'));
    const view = el('div', 'card-view', box);
    this.preview = el('img', 'card-preview', view);
    this.preview.alt = t('card.alt');
    const side = el('div', 'card-side', box);
    el('div', 'ui-kicker', side, 'RECORD CARD');
    this.pilotRow = el('label', 'ui-toggle card-pilot', side);
    this.pilot = el('input', '', this.pilotRow);
    this.pilot.type = 'checkbox';
    this.pilot.checked = true;
    el('span', '', this.pilotRow, t('card.pilotToggle'));
    this.pilot.addEventListener('change', () => {
      void this.render();
    });
    el('p', 'card-note', side, t('card.privacy'));
    this.text = el('textarea', 'ui-field card-text', side);
    this.text.readOnly = true;
    this.text.rows = 3;
    this.text.setAttribute('aria-label', t('card.textLabel'));
    this.status = el('div', 'card-status', side);
    this.status.setAttribute('role', 'status');
    // 9-9c: ボタンはプレビューの下（横に広い画面は画像の下の余白、縦長の画面は一番下。card.css の grid-template-areas）
    const buttons = el('div', 'card-buttons', box);
    this.shareButton = createButton(
      buttons,
      'ui-button is-primary card-share',
      t('card.share'),
      () => {
        void this.share();
      },
    );
    this.saveButton = createButton(buttons, 'ui-button card-save', t('card.save'), () => {
      this.save();
    });
    this.copyButton = createButton(buttons, 'ui-button card-copy', t('card.copy'), () => {
      void this.copy();
    });
    createButton(buttons, 'ui-button is-ghost card-close', t('card.close'), () => {
      this.close();
    });
    root.addEventListener('click', (e) => {
      if (e.target === root) this.close();
    });
    // Esc はここで止める（結果画面・メニューのキーに渡さない）
    document.addEventListener(
      'keydown',
      (e) => {
        if (this.root.hidden || e.code !== 'Escape') return;
        e.stopPropagation();
        e.preventDefault();
        this.close();
      },
      true,
    );
    this.root = root;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** 開いて作る。scene は結果の時点の場面（描けなければ null = 固定のデザイン） */
  async open(source: CardSource, scene: HTMLCanvasElement | null): Promise<void> {
    this.source = source;
    this.scene = scene;
    this.pilot.checked = true;
    this.pilotRow.hidden = source.pilotName === null;
    this.root.hidden = false;
    await this.render();
  }

  close(): void {
    this.root.hidden = true;
    this.generation++;
    this.source = null;
    this.scene = null;
    this.file = null;
    this.setPreview('');
  }

  private async render(): Promise<void> {
    const source = this.source;
    if (!source) return;
    const gen = ++this.generation;
    this.root.dataset.cardState = 'making';
    this.file = null;
    this.setButtons();
    this.say(t('card.making'), 0);
    try {
      await waitForCardFonts();
      if (gen !== this.generation) return;
      const url = playUrl();
      const model = buildCardModel(source, { includePilot: this.pilot.checked, url });
      const { canvas, layout } = drawCard(model, CARD_SIZES[CARD_SIZE], this.scene);
      const blob = await canvasToPng(canvas);
      if (gen !== this.generation) return;
      this.file = new File([blob], photoFileName(CARD_CONFIG.filePrefix, new Date(source.date)), {
        type: 'image/png',
      });
      this.text.value = cardShareText(model, url);
      this.setPreview(URL.createObjectURL(blob));
      // 点検（scripts/ui-audit-card.js）用: 載せた項目
      this.root.dataset.cardItems = layout.ops
        .flatMap((op) => (op.kind === 'text' ? [op.id] : []))
        .join(' ');
      this.root.dataset.cardState = 'ready';
      this.say('', 0);
    } catch {
      if (gen !== this.generation) return;
      this.root.dataset.cardState = 'failed';
      this.say(t('card.failed'), 0);
    }
    this.setButtons();
  }

  /** ファイル付きの共有ができるか */
  private canShareFile(): boolean {
    const f = this.file;
    return (
      f !== null &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [f] })
    );
  }

  /** 共有できれば「共有」と「画像を保存」、できなければ「画像を保存」と「文面をコピー」 */
  private setButtons(): void {
    const ready = this.file !== null;
    const share = ready && this.canShareFile();
    this.shareButton.hidden = !share;
    this.copyButton.hidden = share;
    for (const b of [this.shareButton, this.saveButton, this.copyButton]) b.disabled = !ready;
    this.root.dataset.cardShare = share ? 'share' : 'fallback';
  }

  private async share(): Promise<void> {
    const f = this.file;
    if (!f) return;
    try {
      await navigator.share({ files: [f], text: this.text.value, title: CARD_TITLE });
      this.say(t('card.shared'));
    } catch (e) {
      // 共有シートを閉じただけなら何もしない。ほかの失敗は保存にする
      if (e instanceof DOMException && e.name === 'AbortError') return;
      this.download(f);
      this.say(t('card.shareFailed'));
    }
  }

  private save(): void {
    const f = this.file;
    if (!f) return;
    this.download(f);
    this.say(t('card.saved'));
  }

  private async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.text.value);
      this.say(t('card.copied'));
    } catch {
      // 選んだ状態にして手でコピーしてもらう
      this.text.focus();
      this.text.select();
      this.say(t('card.copyFailed'));
    }
  }

  private download(f: File): void {
    const url = URL.createObjectURL(f);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  private setPreview(url: string): void {
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = url;
    if (url) this.preview.src = url;
    else this.preview.removeAttribute('src');
  }

  private say(text: string, ms = STATUS_MS): void {
    this.status.textContent = text;
    window.clearTimeout(this.statusTimer);
    if (ms > 0)
      this.statusTimer = window.setTimeout(() => {
        this.status.textContent = '';
      }, ms);
  }
}

/** 共有シートの題 */
const CARD_TITLE = 'SkyRaid: Titan Skies';
