// 速度合わせ（9-5b、Three.js 非依存）: 選んだ空の対象（9-8: 地上目標は除く）に前方から近づいているとき、詰まる速さが大きすぎないようスロットルを下げる。
// 数値は src/data/assist.ts の SPEED_MATCH_CONFIG。固定ステップごと、操縦の入力を組み立てた後・記録の前に呼ぶ（出したスロットルは
// throttleTarget として記録に残るので、再生は記録の値で同じになる）。スロットルを上げることはしない
import { SPEED_MATCH_CONFIG } from '../data/assist';
import type { AircraftSpec } from '../data/aircraft';
import type { AircraftControls } from '../entities/aircraft';
import { clamp, inverseRotateVec3, vec3, type Quat, type Vec3 } from '../flight/math';
import type { CombatTarget } from './target';

const DEG = 180 / Math.PI;

/** 速度合わせが読む自機・対象（FlightSession がそのまま渡せる形） */
export interface SpeedMatchSubject {
  readonly aircraft: {
    readonly throttle: number;
    readonly state: {
      readonly position: Readonly<Vec3>;
      readonly orientation: Readonly<Quat>;
      readonly speed: number;
      readonly afterburnerActive: boolean;
    };
    readonly flight: { readonly spec: Pick<AircraftSpec, 'speed'> };
  };
  readonly combat: { readonly targeting: { readonly selected: CombatTarget | null } };
  readonly player: { readonly active: boolean; readonly velocity: Readonly<Vec3> };
}

export class SpeedMatch {
  /** このステップでスロットルを下げているか（HUD の AUTO） */
  engaged = false;
  /** 効かせ始めたときのスロットルの位置（止めたら戻す） */
  private manual = 1;
  /** スロットルを自分で動かした対象（離れる・変わるまで効かせない） */
  private suspended: CombatTarget | null = null;
  private readonly local: Vec3 = vec3();

  constructor(private readonly config: typeof SPEED_MATCH_CONFIG = SPEED_MATCH_CONFIG) {}

  reset(): void {
    this.engaged = false;
    this.suspended = null;
  }

  /** controls（組み立てた後の操縦）の throttleTarget を書き換える */
  apply(controls: AircraftControls, s: SpeedMatchSubject): void {
    const target = s.combat.targeting.selected;
    // 9-8 の事前修正: 地上目標（施設・対空砲）への急降下では下げない（空の的 = 敵機・ドローン・的・怪獣だけ）
    const live = target !== null && target.active && target.surface !== true && s.player.active;
    if (!live || target !== this.suspended) this.suspended = null;
    const manualInput =
      (controls.throttleTarget !== null && controls.throttleTarget !== undefined) ||
      controls.throttle !== 0 ||
      controls.afterburner ||
      s.aircraft.state.afterburnerActive;
    if (manualInput) {
      // 自分の操作を優先（戻さない）。同じ対象にはもう効かせない
      if (this.engaged && live) this.suspended = target;
      this.engaged = false;
      return;
    }
    const want = live && this.suspended === null ? this.wantedThrottle(target, s) : null;
    if (want === null) {
      if (this.engaged) controls.throttleTarget = this.manual;
      this.engaged = false;
      return;
    }
    if (!this.engaged) this.manual = s.aircraft.throttle;
    this.engaged = true;
    controls.throttleTarget = Math.min(this.manual, want);
  }

  /** 効かせる条件なら下げたいスロットル（0〜1）。条件の外なら null */
  private wantedThrottle(t: CombatTarget, s: SpeedMatchSubject): number | null {
    const c = this.config;
    const st = s.aircraft.state;
    const l = this.local;
    l.x = t.position.x - st.position.x;
    l.y = t.position.y - st.position.y;
    l.z = t.position.z - st.position.z;
    const distance = Math.hypot(l.x, l.y, l.z);
    if (distance < 1e-6) return null;
    const pv = s.player.velocity;
    const tv = t.velocity;
    const closure = -((tv.x - pv.x) * l.x + (tv.y - pv.y) * l.y + (tv.z - pv.z) * l.z) / distance;
    inverseRotateVec3(l, st.orientation, l);
    const angle = Math.atan2(Math.hypot(l.x, l.y), -l.z) * DEG;
    const range = this.engaged ? c.releaseRange : c.engageRange;
    const cone = this.engaged ? c.releaseConeDeg : c.engageConeDeg;
    if (distance > range || angle > cone) return null;
    const desired = clamp((distance - c.stopDistance) * c.gain, c.minClosure, c.maxClosure);
    if (!this.engaged && closure < desired + c.closureMargin) return null;
    // 自機の速さを変えると、視線の方向の分だけ詰まる速さが変わる
    const along = Math.max(0.5, Math.cos(angle / DEG));
    const sp = s.aircraft.flight.spec.speed;
    const speedWant = Math.max(c.minSpeed, st.speed - (closure - desired) / along);
    // エンジンは目標速度へ response（1/秒）で近づくので、目標を前へ出して approachRate で近づける
    const engineTarget = st.speed + ((speedWant - st.speed) * c.approachRate) / sp.response;
    return clamp((engineTarget - sp.idle) / (sp.military - sp.idle), 0, 1);
  }
}
