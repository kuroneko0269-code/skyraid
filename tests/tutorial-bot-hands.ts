// チュートリアルのボット（tests/tutorial-bot.ts）の手の模擬: 方式ごとの人の手・キーボードの押し続け / 離し・
// 速度合わせのない方式のスロットル・的の近くを回り続けたときのやり直し
import { TILT_CONFIG } from '../src/data/steer';
import type { AircraftControls } from '../src/entities/aircraft';
import { LOCAL_FORWARD } from '../src/flight/flight-model';
import { rotateVec3, type Quat, type Vec3 } from '../src/flight/math';
import { DEFAULT_HANDS, type HandsSpec } from '../scripts/replay-analysis/hands';
import { DT } from './mission-bots';
import type { TutorialBotMode } from './tutorial-bot';

/** 方式ごとの手: タッチは 9-2〜9-4 の初期値（カーブ 1.5）、パッドは小さなぶれ、キーボードは手なし（押す / 離すにする） */
export function handsFor(mode: TutorialBotMode): HandsSpec | null {
  if (mode === 'keyboard') return null;
  if (mode === 'gamepad') return { ...DEFAULT_HANDS, noise: 0.06, delay: 0.15, curve: 1 };
  if (mode === 'tilt')
    return { ...DEFAULT_HANDS, curve: 1.5, smoothing: TILT_CONFIG.smoothingSeconds };
  return { ...DEFAULT_HANDS, curve: 1.5 };
}

/** キーを押し続ける / 離す（出したい値が 0.3 を超えたら押し、0.12 を切ったら離す） */
function tapper(): (v: number) => number {
  let key = 0;
  return (v) => {
    if (Math.abs(v) > 0.3) key = Math.sign(v);
    else if (Math.abs(v) < 0.12) key = 0;
    return key;
  };
}

/** 的の近くを回り続けたら、離れてから向かい直す */
export class Escape {
  readonly point: Vec3 = { x: 0, y: 0, z: 0 };
  private circling = 0;
  private active = false;
  private readonly l: Vec3 = { x: 0, y: 0, z: 0 };

  check(st: Readonly<{ position: Vec3; orientation: Quat }>, t: Readonly<Vec3>): boolean {
    const p = st.position;
    const d = Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z);
    if (this.active) {
      if (d > 2200) this.active = false;
      return this.active;
    }
    rotateVec3(this.l, st.orientation, LOCAL_FORWARD);
    const cos =
      ((t.x - p.x) * this.l.x + (t.y - p.y) * this.l.y + (t.z - p.z) * this.l.z) / Math.max(1, d);
    this.circling = d < 900 && cos < 0.5 ? this.circling + DT : 0;
    if (this.circling < 2.5) return false;
    this.circling = 0;
    this.active = true;
    const h = Math.hypot(p.x - t.x, p.z - t.z) || 1;
    this.point.x = t.x + ((p.x - t.x) / h) * 3000;
    this.point.z = t.z + ((p.z - t.z) / h) * 3000;
    this.point.y = Math.max(p.y, t.y + 300);
    return true;
  }
}

/** 速度合わせのない方式の人のスロットル: 近いほど下げる（速さの章の指示） */
export function manualThrottle(p: Readonly<Vec3>, t: Readonly<Vec3>): number {
  const d = Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z);
  return d < 900 ? 0.4 : d < 1500 ? 0.55 : 0.85;
}

/** キーボードの人: 押し続ける / 離す。傾けてから引く（大きく傾けている間は引きを控える） */
export function keyboardHands(): (base: Readonly<AircraftControls>, out: AircraftControls) => void {
  const pitch = tapper();
  const roll = tapper();
  return (base, out) => {
    Object.assign(out, base);
    out.pitch = pitch(Math.abs(out.roll) > 0.4 ? out.pitch * 0.3 : out.pitch);
    out.roll = roll(out.roll);
    out.yaw = 0;
  };
}
