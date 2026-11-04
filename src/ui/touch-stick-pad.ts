// 画面のスティック（1-5。9-2 の方式・カーブ・位置）の DOM と指の追跡。touch-controls.ts が 300 行を超えたので分けた（9-5 の事前修正。挙動は変えていない）
import { FloatingStick } from '../core/touch-stick';
import { applyStickCurve, type Vec2Out } from '../core/analog';
import type { Input } from '../core/input';
import type { SteerMode } from '../data/steer';
import { TOUCH_CONFIG } from '../data/touch';
import type { TouchPart } from '../data/tutorial';

/** スティックの設定（9-2。操作設定）: 方式・感度のカーブ・位置 */
export interface StickOptions {
  /**
   * 操縦の方式（classic 以外は「方向へ倒す」の組み立てで、ピッチ・ロールのアクションへは分配せず Input.directStick に書く）。
   * 9-4: tilt はスティックを隠して左手側に「水平を合わせ直す」ボタン、drag はスティックを隠して画面全体（ボタンの下）で押さえる
   */
  readonly mode: SteerMode;
  /** 感度のカーブの指数（1 = 直線） */
  readonly curve: number;
  /** 決まった位置（待機位置）に置いたまま（false は親指を置いた場所に出す） */
  readonly fixed: boolean;
}

/** 指が離れた（キャンセル・キャプチャ喪失を含む）ことを表すイベント */
export const RELEASE_EVENTS = ['pointerup', 'pointercancel', 'lostpointercapture'] as const;

/** タッチ操作の部品の div（part はチュートリアルで光らせる部品。4-11） */
export function touchEl(
  className: string,
  parent: HTMLElement,
  text?: string,
  part?: TouchPart,
): HTMLDivElement {
  const div = document.createElement('div');
  div.className = className;
  if (text) div.textContent = text;
  if (part) div.dataset.part = part;
  parent.appendChild(div);
  return div;
}

/** 左手側のスティック（触れた範囲 zone・待機位置の土台・つまみ） */
export class TouchStickPad {
  options: StickOptions = { mode: 'classic', curve: 1, fixed: false };
  private readonly stick = new FloatingStick(TOUCH_CONFIG.stick);
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly shaped: Vec2Out = { x: 0, y: 0 };

  constructor(
    root: HTMLElement,
    private readonly input: Input,
  ) {
    const zone = touchEl('tc-stick-zone', root);
    this.base = touchEl('tc-stick-base', root, undefined, 'stick');
    this.knob = touchEl('tc-stick-knob', this.base);
    zone.addEventListener('pointerdown', this.onDown);
    zone.addEventListener('pointermove', this.onMove);
    for (const type of RELEASE_EVENTS) zone.addEventListener(type, this.onUp);
  }

  setDeadzone(deadzone: number): void {
    this.stick.setDeadzone(deadzone);
  }

  /** 指を離した扱いにする（値は書かない。Input の側は TouchControls が消す） */
  reset(): void {
    this.stick.reset();
    this.render();
  }

  private readonly onDown = (e: PointerEvent): void => {
    // 9-2: 決まった位置の方式は待機位置の中心が原点（触れた点まで倒した扱い）。触れた瞬間だけ位置を読む
    let ox = e.clientX;
    let oy = e.clientY;
    if (this.options.fixed) {
      const rect = this.base.getBoundingClientRect();
      ox = rect.left + rect.width / 2;
      oy = rect.top + rect.height / 2;
    }
    if (!this.stick.start(e.pointerId, ox, oy)) return;
    if (e.currentTarget instanceof Element) e.currentTarget.setPointerCapture(e.pointerId);
    this.base.classList.add('is-active');
    if (this.options.fixed) {
      this.stick.move(e.pointerId, e.clientX, e.clientY);
      this.write();
    }
    this.render();
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (!this.stick.move(e.pointerId, e.clientX, e.clientY)) return;
    this.write();
    this.render();
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!this.stick.end(e.pointerId)) return;
    this.write();
    this.render();
  };

  /**
   * スティックの値（感度のカーブの後。9-2）を書く。ピッチ・ロールの方式はアクションに分配する（画面の下へ倒す = 操縦桿を引く =
   * 機首上げ）。「方向へ倒す」方式は Input.directStick（画面の上が正）
   */
  private write(): void {
    const v = this.shaped;
    v.x = this.stick.value.x;
    v.y = this.stick.value.y;
    applyStickCurve(v, this.options.curve);
    const { x, y } = v;
    if (this.options.mode !== 'classic') {
      this.input.setDirectStick(x, -y);
      return;
    }
    this.input.setAnalog('touch', 'rollRight', Math.max(0, x));
    this.input.setAnalog('touch', 'rollLeft', Math.max(0, -x));
    this.input.setAnalog('touch', 'pitchUp', Math.max(0, y));
    this.input.setAnalog('touch', 'pitchDown', Math.max(0, -y));
  }

  private render(): void {
    const base = this.base;
    if (this.stick.active && !this.options.fixed) {
      // 原点（触れた位置）にスティックを出す。CSS の left/top（待機位置）をインラインで上書き
      base.style.left = `${this.stick.originX}px`;
      base.style.top = `${this.stick.originY}px`;
      this.knob.style.transform = `translate(${this.stick.knobX}px, ${this.stick.knobY}px)`;
    } else if (this.stick.active) {
      this.knob.style.transform = `translate(${this.stick.knobX}px, ${this.stick.knobY}px)`;
    } else {
      base.classList.remove('is-active');
      base.style.left = '';
      base.style.top = '';
      this.knob.style.transform = '';
    }
  }
}
