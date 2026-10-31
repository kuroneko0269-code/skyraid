// 自機が怪獣に狙われるときの状態（6-2。Three.js 非依存）: 咆哮のスタン（操作不能の残り秒数）と、
// フレアを最後に撒いてからの秒数（咆哮を防ぐ）。FlightSession が持ち、怪獣 AI に自機を KaijuTarget として渡す
import type { KaijuTarget } from '../ai/kaiju-ai';
import type { FlareField } from '../combat/flare';
import { TEAM_PLAYER } from '../combat/target';
import type { Vec3 } from '../flight/math';

/** 怪獣に狙われる自機（読むだけ） */
export interface ExposedPlayer {
  readonly position: Readonly<Vec3>;
  readonly hitRadius: number;
  readonly active: boolean;
}

export class KaijuExposure implements KaijuTarget {
  readonly id = 0;
  /** スタンの残り秒数（0 は操作できる） */
  stun = 0;
  flareAge = Infinity;
  /** 怪獣 AI に渡す相手の並び（自機だけ） */
  readonly targets: readonly KaijuTarget[] = [this];
  private flareCount = 0;

  constructor(
    private readonly player: ExposedPlayer,
    private readonly flares: FlareField,
  ) {}

  get position(): Readonly<Vec3> {
    return this.player.position;
  }

  get hitRadius(): number {
    return this.player.hitRadius;
  }

  get active(): boolean {
    return this.player.active;
  }

  get stunned(): boolean {
    return this.stun > 0;
  }

  /** スタンさせる（長い方を残す） */
  applyStun(seconds: number): void {
    if (this.player.active) this.stun = Math.max(this.stun, seconds);
  }

  /** 固定ステップ 1 回分（怪獣 AI の前）: スタンとフレアの時間 */
  step(dt: number): void {
    if (this.stun > 0) this.stun = Math.max(0, this.stun - dt);
    if (!this.player.active) this.stun = 0;
    const n = this.flares.releases.get(TEAM_PLAYER) ?? 0;
    if (n !== this.flareCount) {
      this.flareCount = n;
      this.flareAge = 0;
    } else this.flareAge += dt;
  }

  reset(): void {
    this.stun = 0;
    this.flareAge = Infinity;
    this.flareCount = this.flares.releases.get(TEAM_PLAYER) ?? 0;
  }
}
