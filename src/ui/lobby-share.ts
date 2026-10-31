// ロビーの部屋コードの共有（5-4）: 「共有」（Web Share API で OS の共有シート。非対応ならリンクをクリップボードへ）、
// 「コピー」（コードだけ）、「QR」（参加用 URL の QR コードを 220px 四方で出すダイアログ）。
// QR を読んだ相手は OS のカメラから ?room= 付きで開く（アプリ内の読み取りは作らない）。文字は textContent だけで入れる
import { encodeQr } from '../core/qr';
import { el } from './hud-dom';
import { createButton } from './screen';

/** QR コードの表示の大きさ（CSS px） */
const QR_CSS_PX = 220;
/** QR コードの周りの余白（モジュール数。仕様の最小） */
const QR_QUIET = 4;
/** 「コピーしました」を出す秒数 */
const STATUS_SECONDS = 2.5;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** QR コードを canvas に描く（白地に黒。端末の画素密度に合わせて整数倍で拡大し、表示は 220px 四方） */
export function drawQr(canvas: HTMLCanvasElement, text: string): boolean {
  const qr = encodeQr(text);
  const ctx = canvas.getContext('2d');
  if (!qr || !ctx) return false;
  const n = qr.size + QR_QUIET * 2;
  const scale = Math.max(1, Math.ceil((QR_CSS_PX * (window.devicePixelRatio || 1)) / n));
  canvas.width = canvas.height = n * scale;
  canvas.style.width = canvas.style.height = `${QR_CSS_PX}px`;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y * qr.size + x])
        ctx.fillRect((x + QR_QUIET) * scale, (y + QR_QUIET) * scale, scale, scale);
    }
  }
  return true;
}

export class LobbyShare {
  readonly root: HTMLDivElement;
  private readonly status: HTMLSpanElement;
  private readonly dialog: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly urlText: HTMLParagraphElement;
  private code = '';
  private url = '';
  private statusTimer = 0;

  constructor(parent: HTMLElement, dialogParent: HTMLElement) {
    this.root = el('div', 'lobby-share', parent);
    createButton(this.root, 'ui-button lobby-share-button', '共有', () => {
      void this.share();
    });
    createButton(this.root, 'ui-button lobby-share-button', 'コピー', () => {
      void this.copy(this.code, 'コードをコピーしました');
    });
    createButton(this.root, 'ui-button lobby-share-button', 'QR', () => {
      this.openQr();
    });
    this.status = el('span', 'lobby-share-status', parent);
    this.status.setAttribute('role', 'status');
    // QR のダイアログ（画面全体に重ねる。タッチで閉じられる）
    this.dialog = el('div', 'lobby-overlay', dialogParent);
    this.dialog.hidden = true;
    const box = el('div', 'ui-dialog lobby-dialog lobby-qr', this.dialog);
    el('div', 'ui-kicker', box, 'QR CODE');
    el('p', 'briefing-text', box, 'スマホのカメラで読むと、この部屋に参加できます');
    const frame = el('div', 'lobby-qr-frame', box);
    this.canvas = el('canvas', 'lobby-qr-canvas', frame);
    this.canvas.setAttribute('role', 'img');
    this.urlText = el('p', 'lobby-qr-url', box);
    const buttons = el('div', 'campaign-buttons', box);
    createButton(buttons, 'ui-button is-primary campaign-go', '閉じる', () => {
      this.closeQr();
    });
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.closeQr();
    });
  }

  set(code: string, url: string): void {
    this.code = code;
    this.url = url;
  }

  get qrOpen(): boolean {
    return !this.dialog.hidden;
  }

  closeQr(): void {
    this.dialog.hidden = true;
  }

  /** OS の共有シート（LINE・メールなど）に URL を渡す。非対応ならリンクをコピー */
  private async share(): Promise<void> {
    const data: ShareData = {
      title: 'SkyRaid',
      text: `SkyRaid の対戦に参加（部屋コード ${this.code}）`,
      url: this.url,
    };
    if ('share' in navigator && (!('canShare' in navigator) || navigator.canShare(data))) {
      try {
        await navigator.share(data);
        return;
      } catch (e) {
        // 共有シートを閉じただけなら何もしない
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    await this.copy(this.url, 'リンクをコピーしました');
  }

  private async copy(text: string, done: string): Promise<void> {
    const ok = await copyText(text);
    this.showStatus(ok ? done : `コピーできませんでした: ${text}`);
  }

  private showStatus(text: string): void {
    this.status.textContent = text;
    window.clearTimeout(this.statusTimer);
    this.statusTimer = window.setTimeout(() => {
      this.status.textContent = '';
    }, STATUS_SECONDS * 1000);
  }

  private openQr(): void {
    const ok = drawQr(this.canvas, this.url);
    this.canvas.setAttribute('aria-label', `参加用 URL の QR コード: ${this.url}`);
    this.urlText.textContent = ok ? this.url : 'QR コードを作れませんでした';
    this.dialog.hidden = false;
  }
}
