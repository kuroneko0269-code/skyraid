// HUD の警告の表示の切り替え（hud.ts から分けた。9-3）: 地面接近（PULL UP）・失速（STALL）・宙返りの速度不足（9-3）。
// どれもルートのクラスで出し分ける（hud.css）。書き換えは変わったときだけ
import { HUD_CONFIG } from '../data/hud';
import type { HudFrame } from './hud-frame';
import { isGroundWarning, isStallWarning } from './hud-math';

export class HudWarnings {
  private ground = false;
  private stall = false;
  private loopSpeed = false;

  constructor(private readonly root: HTMLElement) {}

  update(f: Readonly<HudFrame>): void {
    const ground = isGroundWarning(f.altitudeAboveGround, HUD_CONFIG.groundWarningAgl);
    if (ground !== this.ground) {
      this.ground = ground;
      this.root.classList.toggle('is-ground-warning', ground);
    }
    const stall = isStallWarning(f.stall, HUD_CONFIG.stallThreshold);
    if (stall !== this.stall) {
      this.stall = stall;
      this.root.classList.toggle('is-stall', stall);
    }
    // 宙返り（9-3）: 上へ端まで倒しているのに速さが足りない（失速の表示が出ている間は出さない）
    const loopSpeed = f.loopSpeedLow && !stall;
    if (loopSpeed !== this.loopSpeed) {
      this.loopSpeed = loopSpeed;
      this.root.classList.toggle('is-loop-speed', loopSpeed);
    }
  }
}
