// HUD の無誘導兵器と対空砲（2-6）: ロケット・爆弾の残弾、タッチの MSL ボタンで撃つ兵装（▸ の付いた行）、
// 爆弾の着弾予測点（○）、対空砲が撃つ前の「AAA」警告。DOM は最初に作り、値が変わったときだけ書く
import './hud-ordnance.css';
import { HUD_CONFIG } from '../data/hud';
import { el } from './hud-dom';
import { changed } from './hud-math';

/** HUD に渡す 1 フレーム分の値（座標は px、左上原点） */
export interface HudOrdnanceFrame {
  rockets: number;
  bombs: number;
  /** タッチの MSL ボタンで撃つ兵装 */
  secondary: 'missile' | 'rocket';
  /** 爆弾の着弾予測点。impactShown が false なら隠す */
  impactShown: boolean;
  impactX: number;
  impactY: number;
  /** 対空砲が 1 秒以内に撃つ */
  aaaWarning: boolean;
  /** 10-4b: ロケット・爆弾の撃ち方の小さな印（タッチは長押しの切り替え。'' は出さない） */
  hint: string;
}

export function createOrdnanceFrame(): HudOrdnanceFrame {
  return {
    rockets: 0,
    bombs: 0,
    secondary: 'missile',
    impactShown: false,
    impactX: 0,
    impactY: 0,
    aaaWarning: false,
    hint: '',
  };
}

export class HudOrdnance {
  private readonly rktRow: HTMLDivElement;
  private readonly rktText: HTMLSpanElement;
  private readonly bmbRow: HTMLDivElement;
  private readonly bmbText: HTMLSpanElement;
  private readonly impact: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private last = {
    rkt: '',
    bmb: '',
    secondary: '',
    impactShown: false,
    x: NaN,
    y: NaN,
    aaa: false,
    hint: '',
  };

  /**
   * root: HUD の根（警告・○ を置く）、ammo: 残弾の列（MSL / FLR の行の後ろに足す）、
   * mslRow: ミサイルの行（選んでいる兵装の印を付ける）
   */
  constructor(
    private readonly root: HTMLElement,
    ammo: HTMLElement,
    private readonly mslRow: HTMLElement,
  ) {
    this.rktRow = el('div', 'hud-ammo-row', ammo);
    el('span', 'hud-ammo-label', this.rktRow, 'RKT');
    this.rktText = el('span', 'hud-ammo-value', this.rktRow);
    this.bmbRow = el('div', 'hud-ammo-row', ammo);
    el('span', 'hud-ammo-label', this.bmbRow, 'BMB');
    this.bmbText = el('span', 'hud-ammo-value', this.bmbRow);
    this.hint = el('div', 'hud-ammo-hint', ammo);
    this.hint.hidden = true;
    this.impact = el('div', 'hud-bomb-impact', root);
    this.impact.hidden = true;
    el('div', 'hud-warn hud-aaa', root, 'AAA');
  }

  update(f: Readonly<HudOrdnanceFrame>): void {
    const last = this.last;
    const rkt = String(f.rockets);
    if (rkt !== last.rkt) {
      this.rktText.textContent = last.rkt = rkt;
      this.rktRow.classList.toggle('is-empty', f.rockets === 0);
    }
    const bmb = String(f.bombs);
    if (bmb !== last.bmb) {
      this.bmbText.textContent = last.bmb = bmb;
      this.bmbRow.classList.toggle('is-empty', f.bombs === 0);
    }
    if (f.secondary !== last.secondary) {
      last.secondary = f.secondary;
      this.mslRow.classList.toggle('is-selected', f.secondary === 'missile');
      this.rktRow.classList.toggle('is-selected', f.secondary === 'rocket');
    }
    if (f.impactShown !== last.impactShown) {
      last.impactShown = f.impactShown;
      this.impact.hidden = !f.impactShown;
    }
    const eps = HUD_CONFIG.epsilon.px;
    if (f.impactShown && (changed(last.x, f.impactX, eps) || changed(last.y, f.impactY, eps))) {
      last.x = f.impactX;
      last.y = f.impactY;
      this.impact.style.transform = `translate(${f.impactX.toFixed(1)}px, ${f.impactY.toFixed(1)}px)`;
    }
    if (f.hint !== last.hint) {
      last.hint = f.hint;
      this.hint.textContent = f.hint;
      this.hint.hidden = f.hint === '';
    }
    if (f.aaaWarning !== last.aaa) {
      last.aaa = f.aaaWarning;
      this.root.classList.toggle('is-aaa', f.aaaWarning);
    }
  }

  invalidate(): void {
    const last = this.last;
    last.rkt = last.bmb = last.secondary = last.hint = '';
    last.x = last.y = NaN;
  }
}
