// ドラッグ操作（9-4）: 画面の行きたい場所を指で押さえると、押さえた点と画面の中央のずれを「方向へ倒す」方式の
// スティックの値（Input.directStick）にする。離すと 0（水平飛行に戻る）。画面の上端の近くを押さえ続けると上へ端まで = 宙返り。
// カメラは機体と一緒に傾くので、押さえた・動かした瞬間の画面の傾きでずれを地平線の基準に戻す（画面に見える所へ向かう）。
// 指を止めている間はその向きのまま（傾きが変わるたびに読み直すと、旋回で傾いた分だけ下を向いて螺旋に下りていく）。
// 宙返りの間は傾きを読み直さない
// 面は描画（canvas）のすぐ上・HUD とボタンの下に置くので、ボタン・スロットルの上では反応しない（そちらが先に受ける）
import './drag-surface.css';
import type { Vec2Out } from '../core/analog';
import type { Input } from '../core/input';
import { dragStick } from '../core/tilt';
import { DRAG_CONFIG } from '../data/steer';

const RELEASE_EVENTS = ['pointerup', 'pointercancel', 'lostpointercapture'] as const;

export class DragSurface {
  readonly root: HTMLDivElement;
  private readonly marker: HTMLDivElement;
  private pointer: number | null = null;
  private width = 0;
  private height = 0;
  private readonly value: Vec2Out = { x: 0, y: 0 };
  private roll = 0;
  /** 傾きを読んだときの指の位置（少し動いただけでは読み直さない） */
  private rollX = 0;
  private rollY = 0;
  /** 画面の傾き（rad。app がカメラから入れる） */
  screenRoll: () => number = () => 0;
  /** 宙返りの途中か（傾きを読み直さない） */
  looping: () => boolean = () => false;

  constructor(
    parent: HTMLElement,
    private readonly input: Input,
  ) {
    const root = document.createElement('div');
    root.className = 'drag-surface';
    root.hidden = true;
    root.style.setProperty('--drag-marker', `${DRAG_CONFIG.markerSize}px`);
    this.marker = document.createElement('div');
    this.marker.className = 'drag-marker';
    root.appendChild(this.marker);
    root.addEventListener('pointerdown', this.onDown);
    root.addEventListener('pointermove', this.onMove);
    for (const type of RELEASE_EVENTS) root.addEventListener(type, this.onUp);
    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
    parent.appendChild(root);
    this.root = root;
  }

  setShown(shown: boolean): void {
    if (shown === !this.root.hidden) return;
    this.root.hidden = !shown;
    if (!shown) this.reset();
  }

  /** 指を離した扱い（値は呼ぶ側が Input.clearAnalog で消す） */
  reset(): void {
    this.pointer = null;
    this.marker.classList.remove('is-active');
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (this.pointer !== null) return;
    this.pointer = e.pointerId;
    this.root.setPointerCapture(e.pointerId);
    // 大きさは触れた瞬間だけ読む（move ごとのレイアウト計算を避ける）
    const rect = this.root.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.marker.classList.add('is-active');
    this.rollX = Number.NaN;
    this.write(e.clientX - rect.left, e.clientY - rect.top);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointer) return;
    const rect = this.root.getBoundingClientRect();
    this.write(e.clientX - rect.left, e.clientY - rect.top);
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointer) return;
    this.reset();
    this.input.setDirectStick(0, 0);
  };

  private write(x: number, y: number): void {
    // 押さえた瞬間と、指をはっきり動かした（rereadPx より）ときだけ画面の傾きを読み直す
    const moved =
      Number.isNaN(this.rollX) || Math.hypot(x - this.rollX, y - this.rollY) > DRAG_CONFIG.rereadPx;
    if (moved && !this.looping()) {
      this.roll = this.screenRoll();
      this.rollX = x;
      this.rollY = y;
    }
    dragStick(x, y, this.width, this.height, DRAG_CONFIG.radiusRatio, this.value, this.roll);
    this.input.setDirectStick(this.value.x, this.value.y);
    this.marker.style.transform = `translate(${x}px, ${y}px)`;
  }
}
