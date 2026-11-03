import './touch-controls.css';
import { FloatingStick } from '../core/touch-stick';
import { applyStickCurve, sliderValueFromY, type Vec2Out } from '../core/analog';
import type { Input } from '../core/input';
import type { Action } from '../data/keybinds';
import { TOUCH_CONFIG } from '../data/touch';
import { applyCssVariables } from './touch-controls-vars';
import type { TouchPart } from '../data/tutorial';

/**
 * 右下のボタン群。grid の並び順（左上・右上・左下・右下）。
 * MSL は secondary（短押しで今の兵装、長押しで切替）、AB は長押しで爆弾も（2-6。src/core/weapon-input.ts）
 */
const BUTTONS: readonly {
  actions: readonly Action[];
  label: string;
  className: string;
  part: TouchPart;
}[] = [
  { actions: ['afterburner', 'bombHold'], label: 'AB', className: 'tc-ab', part: 'ab' },
  { actions: ['secondary'], label: 'MSL', className: 'tc-msl', part: 'msl' },
  { actions: ['flare'], label: 'FLR', className: 'tc-flr', part: 'flr' },
  { actions: ['fire'], label: 'GUN', className: 'tc-gun', part: 'gun' },
];

/** MSL ボタンの文字（今の兵装） */
const SECONDARY_LABELS = { missile: 'MSL', rocket: 'RKT' } as const;

/** 指が離れた（キャンセル・キャプチャ喪失を含む）ことを表すイベント */
const RELEASE_EVENTS = ['pointerup', 'pointercancel', 'lostpointercapture'] as const;

function el(
  className: string,
  parent: HTMLElement,
  text?: string,
  part?: TouchPart,
): HTMLDivElement {
  const div = document.createElement('div');
  div.className = className;
  if (text) div.textContent = text;
  // チュートリアルで光らせる部品（4-11）
  if (part) div.dataset.part = part;
  parent.appendChild(div);
  return div;
}

/** スティックの設定（9-2。操作設定）: 方式・感度のカーブ・位置 */
export interface StickOptions {
  /** 「方向へ倒す」方式（ピッチ・ロールのアクションへは分配せず Input.directStick に書く） */
  readonly direct: boolean;
  /** 感度のカーブの指数（1 = 直線） */
  readonly curve: number;
  /** 決まった位置（待機位置）に置いたまま（false は親指を置いた場所に出す） */
  readonly fixed: boolean;
}

/** 長押しボタン。複数の指で押しても、全部離すまで押下が続く */
interface HoldButton {
  readonly element: HTMLElement;
  readonly actions: readonly Action[];
  readonly pointers: Set<number>;
}

/**
 * 画面上の仮想コントローラー（DOM + CSS）。Input の 'touch' ソースに書き込む。
 * Pointer Events を要素ごとに pointerId で追うので、スティックとボタンを同時に押せる。
 * DOM の書き込みはイベント時と、スロットル表示が変わったときだけ
 */
export class TouchControls {
  readonly root: HTMLDivElement;
  private readonly stick = new FloatingStick(TOUCH_CONFIG.stick);
  private readonly stickBase: HTMLDivElement;
  private readonly stickKnob: HTMLDivElement;
  private stickOptions: StickOptions = { direct: false, curve: 1, fixed: false };
  private readonly shaped: Vec2Out = { x: 0, y: 0 };
  private readonly holdButtons: HoldButton[] = [];
  private readonly throttleTrack: HTMLDivElement;
  private throttlePointer: number | null = null;
  private throttleTop = 0;
  private throttleHeight = 0;
  private shownThrottle = -1;
  private readonly secondaryButton: HTMLElement | null;
  private shownSecondary: keyof typeof SECONDARY_LABELS = 'missile';
  private visible = false;

  constructor(
    parent: HTMLElement,
    private readonly input: Input,
  ) {
    const root = document.createElement('div');
    root.className = 'touch-controls';
    root.hidden = true;
    applyCssVariables(root);
    this.root = root;

    const zone = el('tc-stick-zone', root);
    this.stickBase = el('tc-stick-base', root, undefined, 'stick');
    this.stickKnob = el('tc-stick-knob', this.stickBase);
    zone.addEventListener('pointerdown', this.onStickDown);
    zone.addEventListener('pointermove', this.onStickMove);
    for (const type of RELEASE_EVENTS) {
      zone.addEventListener(type, this.onStickUp);
    }

    const buttons = el('tc-buttons', root);
    let secondary: HTMLElement | null = null;
    for (const b of BUTTONS) {
      const e = el(`tc-button ${b.className}`, buttons, b.label, b.part);
      if (b.actions.includes('secondary')) secondary = e;
      this.addHoldButton(e, b.actions);
    }
    this.secondaryButton = secondary;
    this.addHoldButton(el('tc-button tc-yaw tc-yaw-left', root, '◀', 'yaw'), ['yawLeft']);
    this.addHoldButton(el('tc-button tc-yaw tc-yaw-right', root, '▶', 'yaw'), ['yawRight']);

    const throttle = el('tc-throttle', root, undefined, 'throttle');
    this.throttleTrack = el('tc-throttle-track', throttle);
    el('tc-throttle-fill', this.throttleTrack);
    el('tc-throttle-thumb', this.throttleTrack);
    el('tc-throttle-label', throttle, 'THR');
    this.throttleTrack.addEventListener('pointerdown', this.onThrottleDown);
    this.throttleTrack.addEventListener('pointermove', this.onThrottleMove);
    for (const type of RELEASE_EVENTS) {
      this.throttleTrack.addEventListener(type, this.onThrottleUp);
    }

    // 長押しのメニュー（コンテキストメニュー・文字選択）を出さない
    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
    parent.appendChild(root);
  }

  get isVisible(): boolean {
    return this.visible;
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    this.root.hidden = !visible;
    document.documentElement.classList.toggle('touch-active', visible);
    if (!visible) this.reset();
  }

  /**
   * 操作設定（4-11）: スティックのデッドゾーン・左右入替（スティックとボタン群・スロットル）・ボタンの大きさの倍率
   */
  configure(deadzone: number, swapped: boolean, scale: number, stick: StickOptions): void {
    this.stick.setDeadzone(deadzone);
    this.stickOptions = { ...stick };
    this.input.directMode = stick.direct;
    this.root.classList.toggle('is-swapped', swapped);
    // ⏸ ボタン（ヨーボタンの隣）も合わせるので :root に置く
    document.documentElement.style.setProperty('--tc-scale', String(scale));
    this.reset();
  }

  /** チュートリアル（4-11）で使う部品を光らせる（空なら消す） */
  highlight(parts: readonly TouchPart[]): void {
    for (const e of this.root.querySelectorAll<HTMLElement>('[data-part]'))
      e.classList.toggle('is-hint', parts.includes(e.dataset.part as TouchPart));
  }

  /** スロットル位置（0〜1）を表示に反映する。毎フレーム呼んでよい（変化したときだけ書く） */
  syncThrottle(value: number): void {
    if (!this.visible) return;
    if (Math.abs(value - this.shownThrottle) < TOUCH_CONFIG.throttle.displayEpsilon) return;
    this.shownThrottle = value;
    this.throttleTrack.style.setProperty('--throttle', value.toFixed(3));
  }

  /** MSL ボタンの文字を今の兵装（MSL / RKT）にする。毎フレーム呼んでよい（変わったときだけ書く） */
  syncSecondary(weapon: keyof typeof SECONDARY_LABELS): void {
    if (weapon === this.shownSecondary || !this.secondaryButton) return;
    this.shownSecondary = weapon;
    this.secondaryButton.textContent = SECONDARY_LABELS[weapon];
  }

  /** すべての指を離した扱いにする（フォーカス喪失・非表示時） */
  reset(): void {
    this.stick.reset();
    this.renderStick();
    this.throttlePointer = null;
    for (const b of this.holdButtons) {
      b.pointers.clear();
      b.element.classList.remove('is-pressed');
    }
    this.input.clearAnalog('touch');
  }

  private addHoldButton(element: HTMLElement, actions: readonly Action[]): void {
    const button: HoldButton = { element, actions, pointers: new Set() };
    this.holdButtons.push(button);
    element.addEventListener('pointerdown', (e) => {
      element.setPointerCapture(e.pointerId);
      button.pointers.add(e.pointerId);
      if (button.pointers.size === 1) {
        element.classList.add('is-pressed');
        for (const a of actions) this.input.setAnalog('touch', a, 1);
      }
    });
    const release = (e: PointerEvent): void => {
      if (!button.pointers.delete(e.pointerId) || button.pointers.size > 0) return;
      element.classList.remove('is-pressed');
      for (const a of actions) this.input.setAnalog('touch', a, 0);
    };
    for (const type of RELEASE_EVENTS) {
      element.addEventListener(type, release);
    }
  }

  private readonly onStickDown = (e: PointerEvent): void => {
    // 9-2: 決まった位置の方式は待機位置の中心が原点（触れた点まで倒した扱い）。触れた瞬間だけ位置を読む
    let ox = e.clientX;
    let oy = e.clientY;
    if (this.stickOptions.fixed) {
      const rect = this.stickBase.getBoundingClientRect();
      ox = rect.left + rect.width / 2;
      oy = rect.top + rect.height / 2;
    }
    if (!this.stick.start(e.pointerId, ox, oy)) return;
    if (e.currentTarget instanceof Element) e.currentTarget.setPointerCapture(e.pointerId);
    this.stickBase.classList.add('is-active');
    if (this.stickOptions.fixed) {
      this.stick.move(e.pointerId, e.clientX, e.clientY);
      this.writeStick();
    }
    this.renderStick();
  };

  private readonly onStickMove = (e: PointerEvent): void => {
    if (!this.stick.move(e.pointerId, e.clientX, e.clientY)) return;
    this.writeStick();
    this.renderStick();
  };

  private readonly onStickUp = (e: PointerEvent): void => {
    if (!this.stick.end(e.pointerId)) return;
    this.writeStick();
    this.renderStick();
  };

  /**
   * スティックの値（感度のカーブの後。9-2）を書く。ピッチ・ロールの方式はアクションに分配する（画面の下へ倒す = 操縦桿を引く =
   * 機首上げ）。「方向へ倒す」方式は Input.directStick（画面の上が正）
   */
  private writeStick(): void {
    const v = this.shaped;
    v.x = this.stick.value.x;
    v.y = this.stick.value.y;
    applyStickCurve(v, this.stickOptions.curve);
    const { x, y } = v;
    if (this.stickOptions.direct) {
      this.input.setDirectStick(x, -y);
      return;
    }
    this.input.setAnalog('touch', 'rollRight', Math.max(0, x));
    this.input.setAnalog('touch', 'rollLeft', Math.max(0, -x));
    this.input.setAnalog('touch', 'pitchUp', Math.max(0, y));
    this.input.setAnalog('touch', 'pitchDown', Math.max(0, -y));
  }

  private renderStick(): void {
    const base = this.stickBase;
    if (this.stick.active && !this.stickOptions.fixed) {
      // 原点（触れた位置）にスティックを出す。CSS の left/top（待機位置）をインラインで上書き
      base.style.left = `${this.stick.originX}px`;
      base.style.top = `${this.stick.originY}px`;
      this.stickKnob.style.transform = `translate(${this.stick.knobX}px, ${this.stick.knobY}px)`;
    } else if (this.stick.active) {
      this.stickKnob.style.transform = `translate(${this.stick.knobX}px, ${this.stick.knobY}px)`;
    } else {
      base.classList.remove('is-active');
      base.style.left = '';
      base.style.top = '';
      this.stickKnob.style.transform = '';
    }
  }

  private readonly onThrottleDown = (e: PointerEvent): void => {
    if (this.throttlePointer !== null) return;
    this.throttlePointer = e.pointerId;
    this.throttleTrack.setPointerCapture(e.pointerId);
    // 位置の読み取りは触れた瞬間だけ（move ごとのレイアウト計算を避ける）
    const rect = this.throttleTrack.getBoundingClientRect();
    this.throttleTop = rect.top;
    this.throttleHeight = rect.height;
    this.applyThrottle(e.clientY);
  };

  private readonly onThrottleMove = (e: PointerEvent): void => {
    if (e.pointerId === this.throttlePointer) this.applyThrottle(e.clientY);
  };

  private readonly onThrottleUp = (e: PointerEvent): void => {
    if (e.pointerId === this.throttlePointer) this.throttlePointer = null;
  };

  private applyThrottle(clientY: number): void {
    const v = sliderValueFromY(clientY, this.throttleTop, this.throttleHeight);
    this.input.setThrottleTarget(v);
    this.syncThrottle(v);
  }
}
