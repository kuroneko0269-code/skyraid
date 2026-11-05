// 飛行中の一言（9-5d）: 照準（機首の印と補助の円）のすぐ下に短く出す。機首に付いて動き、画面の下に収まらなければ円の上へ。
// 9-5c は練習場の HUD の上中央（残り時間の下）だったが、目が照準にあるので気づかれなかった。照準は隠さない（円の外）。
// 見失いの一言には的の向きの矢印（画面の上から時計回り）を添える
import './hud-tip.css';
import { HUD_ASSIST_CONFIG } from '../data/assist';
import type { Hud } from './hud';
import { el } from './hud-dom';

/** 円の外へ離す px と、画面の端に残す px */
const GAP = 10;
const EDGE = 6;

export class HudTip {
  private readonly root: HTMLDivElement;
  private readonly arrow: HTMLSpanElement;
  private readonly text: HTMLSpanElement;
  private until = 0;
  private height = 0;
  private lastPos = '';

  constructor(private readonly hud: Hud) {
    this.root = el('div', 'hud-tip', hud.root);
    this.root.hidden = true;
    this.root.setAttribute('role', 'status');
    this.arrow = el('span', 'hud-tip-arrow', this.root, '▲');
    this.text = el('span', 'hud-tip-text', this.root);
  }

  /** seconds 秒出す。arrowDeg があれば矢印をその向きに */
  show(text: string, seconds: number, arrowDeg: number | null = null): void {
    this.text.textContent = text;
    this.arrow.hidden = arrowDeg === null;
    if (arrowDeg !== null) this.arrow.style.rotate = `${arrowDeg.toFixed(0)}deg`;
    this.root.hidden = false;
    this.height = this.root.offsetHeight;
    this.lastPos = '';
    this.until = performance.now() + seconds * 1000;
    this.place();
  }

  hide(): void {
    this.root.hidden = true;
    this.until = 0;
  }

  /** 描画フレームごと（出している間だけ位置を合わせる） */
  update(): void {
    if (this.root.hidden) return;
    if (performance.now() > this.until) {
      this.hide();
      return;
    }
    this.place();
  }

  private place(): void {
    const nose = this.hud.nose;
    const c = HUD_ASSIST_CONFIG;
    const ring = nose.compact ? c.compactRingRadius : c.ringRadius;
    const half = (this.hud.root.clientHeight || window.innerHeight) / 2;
    // 円の下。収まらなければ円の上（中央からの px。要素の上端）
    let y = nose.y + ring + GAP;
    if (y + this.height > half - EDGE) y = nose.y - ring - GAP - this.height;
    const pos = `${nose.x.toFixed(0)}px ${y.toFixed(0)}px`;
    if (pos === this.lastPos) return;
    this.lastPos = pos;
    this.root.style.translate = pos;
  }
}
