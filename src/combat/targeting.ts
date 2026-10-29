// ターゲット管理（Three.js 非依存）: 索敵範囲の対象の列挙、選択（切替・自動選択）、ロックオンの進行
import { TARGETING_CONFIG, type TargetingSpec } from '../data/weapons';
import { LOCAL_FORWARD } from '../flight/flight-model';
import { rotateVec3, vec3, type Quat, type Vec3 } from '../flight/math';

/** 索敵できるもの */
export interface Trackable {
  readonly position: Readonly<Vec3>;
  /** 撃墜済み・再出現待ちは false */
  readonly active: boolean;
}

/** 索敵する機体（位置と姿勢。前方は機体ローカル -Z） */
export interface Observer {
  readonly position: Readonly<Vec3>;
  readonly orientation: Readonly<Quat>;
}

const DEG = Math.PI / 180;

/**
 * 機首方向 forward（単位ベクトル）と対象への向きのなす角の cos。
 * 距離 0 のときは 1（真正面扱い）
 */
export function noseCos(
  from: Readonly<Vec3>,
  forward: Readonly<Vec3>,
  to: Readonly<Vec3>,
  distance: number,
): number {
  if (distance <= 0) return 1;
  return (
    ((to.x - from.x) * forward.x + (to.y - from.y) * forward.y + (to.z - from.z) * forward.z) /
    distance
  );
}

/** 対象が円錐（頂点 from・軸 forward・片側 coneDeg 度・長さ range）の中にあるか */
export function inCone(
  from: Readonly<Vec3>,
  forward: Readonly<Vec3>,
  to: Readonly<Vec3>,
  range: number,
  coneDeg: number,
): boolean {
  const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  if (d > range) return false;
  return noseCos(from, forward, to, d) >= Math.cos(coneDeg * DEG);
}

/**
 * 索敵とロック。固定ステップで step() を呼ぶ。
 * - candidates: 索敵範囲（距離・機首からの角度）内の対象。機首に近い順
 * - selected: 選択中の対象。何も選んでいなければ機首に最も近い候補を自動で選ぶ。
 *   撃墜・消滅・keepRange より遠くへ離れたら外れ、次の候補を自動で選ぶ
 * - lockProgress: ロック円錐に入っている間 1/lockSeconds で増え、外れると 1/lockDecaySeconds で減る。1 でロック完了
 */
export class Targeting<T extends Trackable> {
  /** 索敵範囲の対象（機首に近い順）。配列は使い回す */
  readonly candidates: T[] = [];
  selected: T | null = null;
  lockProgress = 0;
  /** 選択中の対象までの距離（m）。未選択なら 0 */
  selectedDistance = 0;
  private readonly cosines: number[] = [];
  private readonly forward = vec3();

  constructor(readonly spec: TargetingSpec = TARGETING_CONFIG) {}

  get locked(): boolean {
    return this.selected !== null && this.lockProgress >= 1;
  }

  /** 対象を直接選ぶ（タッチで HUD の対象をタップ）。別の対象に変わったらロックはやり直し */
  select(target: T | null): void {
    if (target === this.selected) return;
    this.selected = target;
    this.lockProgress = 0;
  }

  reset(): void {
    this.candidates.length = 0;
    this.cosines.length = 0;
    this.selected = null;
    this.lockProgress = 0;
    this.selectedDistance = 0;
  }

  /** cycle: このステップでターゲット切替（Tab / パッド Y）が押されたか */
  step(observer: Observer, targets: readonly T[], cycle: boolean, dt: number): void {
    const s = this.spec;
    const p = observer.position;
    const f = rotateVec3(this.forward, observer.orientation, LOCAL_FORWARD);
    this.collect(p, f, targets);

    const sel = this.selected;
    if (sel && (!sel.active || distance(p, sel.position) > s.keepRange)) this.select(null);
    if (cycle) this.select(this.nextCandidate());
    if (!this.selected) this.select(this.candidates[0] ?? null);

    const target = this.selected;
    if (!target) {
      this.selectedDistance = 0;
      return;
    }
    this.selectedDistance = distance(p, target.position);
    if (inCone(p, f, target.position, s.lockRange, s.lockConeDeg)) {
      const next = this.lockProgress + dt / s.lockSeconds;
      // 浮動小数の誤差で lockSeconds ちょうどのステップ数でロックし損ねないように
      this.lockProgress = next > 1 - 1e-9 ? 1 : next;
    } else {
      this.lockProgress = Math.max(0, this.lockProgress - dt / s.lockDecaySeconds);
    }
  }

  /** 機首に近い順の候補で、選択中の次（末尾なら先頭）。選択中が候補にいなければ先頭 */
  private nextCandidate(): T | null {
    const list = this.candidates;
    if (list.length === 0) return this.selected;
    const i = this.selected ? list.indexOf(this.selected) : -1;
    return list[(i + 1) % list.length] ?? null;
  }

  /** 索敵範囲の対象を cos の大きい順（挿入ソート。数が少なく、毎ステップほぼ整列済み）に並べる */
  private collect(p: Readonly<Vec3>, f: Readonly<Vec3>, targets: readonly T[]): void {
    const list = this.candidates;
    const cosines = this.cosines;
    list.length = 0;
    cosines.length = 0;
    const s = this.spec;
    const minCos = Math.cos(s.sensorConeDeg * DEG);
    for (const t of targets) {
      if (!t.active) continue;
      const d = distance(p, t.position);
      if (d > s.sensorRange) continue;
      const c = noseCos(p, f, t.position, d);
      if (c < minCos) continue;
      let i = list.length;
      list.push(t);
      cosines.push(c);
      while (i > 0 && (cosines[i - 1] ?? 0) < c) {
        list[i] = list[i - 1] ?? t;
        cosines[i] = cosines[i - 1] ?? c;
        i--;
      }
      list[i] = t;
      cosines[i] = c;
    }
  }
}

function distance(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}
