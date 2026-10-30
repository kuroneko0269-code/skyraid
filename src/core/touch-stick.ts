import { applyRadialDeadzone } from './analog';

export interface FloatingStickOptions {
  /** 最大まで倒したときの指の移動量（px） */
  radius: number;
  /** デッドゾーン（radius に対する比） */
  deadzone: number;
}

/**
 * フローティング式の仮想スティック（DOM 非依存）。
 * 触れた位置が原点になり、原点からのずれ / radius を -1〜+1 で返す（画面下・右が正）
 */
export class FloatingStick {
  /** 操作中の pointerId。触れていなければ null */
  pointerId: number | null = null;
  originX = 0;
  originY = 0;
  /** つまみの表示位置（原点からのずれ、radius で頭打ち、px） */
  knobX = 0;
  knobY = 0;
  /** デッドゾーン適用後の出力（-1〜+1） */
  readonly value = { x: 0, y: 0 };

  private readonly options: FloatingStickOptions;

  constructor(options: Readonly<FloatingStickOptions>) {
    this.options = { ...options };
  }

  /** デッドゾーンを変える（4-11。操作設定。半径に対する比） */
  setDeadzone(deadzone: number): void {
    this.options.deadzone = deadzone;
  }

  get active(): boolean {
    return this.pointerId !== null;
  }

  /** 触れ始め。すでに別の指で操作中なら false（無視する） */
  start(pointerId: number, x: number, y: number): boolean {
    if (this.pointerId !== null) return false;
    this.pointerId = pointerId;
    this.originX = x;
    this.originY = y;
    this.knobX = 0;
    this.knobY = 0;
    this.value.x = 0;
    this.value.y = 0;
    return true;
  }

  /** 指の移動。担当の指でなければ false */
  move(pointerId: number, x: number, y: number): boolean {
    if (pointerId !== this.pointerId) return false;
    const r = this.options.radius;
    let dx = x - this.originX;
    let dy = y - this.originY;
    const len = Math.hypot(dx, dy);
    if (len > r) {
      dx = (dx / len) * r;
      dy = (dy / len) * r;
    }
    this.knobX = dx;
    this.knobY = dy;
    applyRadialDeadzone(dx / r, dy / r, this.options.deadzone, this.value);
    return true;
  }

  /** 指を離した（キャンセル含む）。担当の指でなければ false */
  end(pointerId: number): boolean {
    if (pointerId !== this.pointerId) return false;
    this.reset();
    return true;
  }

  reset(): void {
    this.pointerId = null;
    this.knobX = 0;
    this.knobY = 0;
    this.value.x = 0;
    this.value.y = 0;
  }
}
