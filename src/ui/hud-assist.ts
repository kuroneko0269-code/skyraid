// HUD 補助（4-12）: 選択中の対象への角度差の矢印（画面中央の○の外周に太い線）と距離・接近 / 離脱の色、後方の敵機の「BEHIND」。
// 値は hud-assist-feed.ts が作る。DOM は最初に作って使い回し、値が変わったときだけ書く
import './hud-assist.css';
import { HUD_ASSIST_CONFIG } from '../data/assist';
import { HUD_CONFIG } from '../data/hud';
import { el } from './hud-dom';
import { changed, formatDistance } from './hud-math';

export type Closing = 'none' | 'approach' | 'recede';

export interface HudAssistFrame {
  /** 設定「HUD 補助」。false なら何も出さない（距離の色も付けない） */
  enabled: boolean;
  /** 角度差の矢印: 画面の上から時計回りの向き（度）と、機首（進行方向）と対象のなす角（度） */
  arrowShown: boolean;
  arrowDeg: number;
  angleDeg: number;
  distance: number;
  /** 対象に近づいている / 離れている（間の速さでは前の値のまま） */
  closing: Closing;
  /** 後方（尾部から 60°・1500m 以内）に敵機 */
  behind: boolean;
}

export function createAssistFrame(): HudAssistFrame {
  return {
    enabled: false,
    arrowShown: false,
    arrowDeg: 0,
    angleDeg: 0,
    distance: 0,
    closing: 'none',
    behind: false,
  };
}

export class HudAssist {
  private readonly ring: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private last = {
    shown: false,
    deg: NaN,
    text: '',
    labelShown: true,
    closing: '' as Closing | '',
    behind: false,
  };

  constructor(
    private readonly root: HTMLElement,
    /** 選択中の対象の距離の文字（hud-weapons.ts）。接近 / 離脱で色を変える */
    private readonly distText: HTMLElement,
  ) {
    const c = HUD_ASSIST_CONFIG;
    root.style.setProperty('--hud-assist-ring-normal', String(c.ringRadius));
    root.style.setProperty('--hud-assist-ring-compact', String(c.compactRingRadius));
    this.ring = el('div', 'hud-assist-ring', root);
    el('div', 'hud-assist-arrow', this.ring);
    this.label = el('div', 'hud-assist-label', this.ring);
    this.ring.hidden = true;
    el('div', 'hud-warn hud-behind', root, 'BEHIND');
  }

  /** selectedOnScreen: 選択中の対象が画面内（ひし形と距離が出ている）なら、○の外側の「角度 距離」は出さない */
  update(f: Readonly<HudAssistFrame>, selectedOnScreen: boolean): void {
    const last = this.last;
    const shown = f.enabled && f.arrowShown;
    if (shown !== last.shown) {
      last.shown = shown;
      this.ring.hidden = !shown;
    }
    if (shown) {
      if (changed(last.deg, f.arrowDeg, HUD_CONFIG.epsilon.angleDeg)) {
        last.deg = f.arrowDeg;
        this.ring.style.setProperty('--hud-assist-deg', `${f.arrowDeg.toFixed(1)}deg`);
      }
      const labelShown = !selectedOnScreen;
      if (labelShown !== last.labelShown) {
        last.labelShown = labelShown;
        this.label.hidden = !labelShown;
      }
      const text = `${Math.round(f.angleDeg)}° ${formatDistance(f.distance)}`;
      if (labelShown && text !== last.text) this.label.textContent = last.text = text;
    }
    const closing = f.enabled ? f.closing : 'none';
    if (closing !== last.closing) {
      last.closing = closing;
      for (const e of [this.ring, this.distText]) {
        e.classList.toggle('is-approach', closing === 'approach');
        e.classList.toggle('is-recede', closing === 'recede');
      }
    }
    const behind = f.enabled && f.behind;
    if (behind !== last.behind) {
      last.behind = behind;
      this.root.classList.toggle('is-behind', behind);
    }
  }

  invalidate(): void {
    this.last.deg = NaN;
    this.last.text = '';
  }
}
