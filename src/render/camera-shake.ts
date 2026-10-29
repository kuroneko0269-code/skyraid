// 画面揺れ（Three.js 非依存）。失速中の継続的な揺れと、地面衝突の減衰する揺れ
import type { CameraConfig } from '../data/camera';

export class CameraShake {
  /** カメラの右・上方向への揺れ（m） */
  readonly offset = { x: 0, y: 0 };
  private impact = 0;
  private time = 0;

  constructor(private readonly config: CameraConfig['shake']) {}

  /** 地面衝突などの衝撃を加える。strength 1 で impactAmplitude */
  addImpact(strength = 1): void {
    this.impact = Math.max(this.impact, strength);
  }

  /** stall は失速の度合い（0〜1） */
  update(stall: number, dt: number): void {
    const cfg = this.config;
    this.time += dt;
    this.impact *= Math.exp(-cfg.impactDecay * dt);
    if (this.impact < 1e-3) this.impact = 0;

    const amplitude = cfg.stallAmplitude * stall + cfg.impactAmplitude * this.impact;
    if (amplitude <= 0) {
      this.offset.x = 0;
      this.offset.y = 0;
      return;
    }
    // 周波数の比を無理数寄りにした正弦波の和で、乱数を使わずに不規則な揺れにする
    const w = 2 * Math.PI * cfg.frequency * this.time;
    this.offset.x = amplitude * (0.6 * Math.sin(w) + 0.4 * Math.sin(w * 2.31 + 1.7));
    this.offset.y = amplitude * (0.6 * Math.sin(w * 1.13 + 0.5) + 0.4 * Math.sin(w * 2.73 + 2.9));
  }

  reset(): void {
    this.impact = 0;
    this.offset.x = 0;
    this.offset.y = 0;
  }
}
