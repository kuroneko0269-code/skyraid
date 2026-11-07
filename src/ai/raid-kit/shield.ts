// 10-2: バリアと瞬間移動（レイドの怪獣の共通の部品。UFO を想定）。どちらも予兆を必ず出す（理不尽にしない）:
// - バリア: 張っている間は当たっても効かない（absorbs）。外れる前に flicker 秒だけ揺らぐ（見た目の予兆）→ 外れる（down 秒）
//   → 張り直す。光線の溜め撃ちの直前に外す、のように呼ぶ側が drop() で外す時刻を決める
// - 瞬間移動: 移る先を決めると telegraph 秒だけ移る先が光る（予兆）→ 移る（位置を変えるのは呼ぶ側。arrived で知らせる）
//   → cooldown 秒は次の瞬間移動をしない。移る先は乱数（種の列）で、狙う人から近すぎない輪の上
// 決まった計算・状態は数と配列だけ。Three.js・DOM 非依存
import { vec3, type Vec3 } from '../../flight/math';

export type BarrierPhase = 'up' | 'flicker' | 'down';

export interface BarrierSpec {
  readonly flicker: number;
  readonly down: number;
}

export class Barrier {
  phase: BarrierPhase = 'up';
  time = 0;
  /** 外れた回数 */
  drops = 0;

  constructor(readonly spec: BarrierSpec) {}

  /** 当たりを止めるか（揺らいでいる間もまだ止める。外れて初めて当たる） */
  get absorbs(): boolean {
    return this.phase !== 'down';
  }

  /** 外し始める（揺らぎ → 外れる）。張っているときだけ */
  drop(): boolean {
    if (this.phase !== 'up') return false;
    this.phase = 'flicker';
    this.time = 0;
    return true;
  }

  step(dt: number): void {
    if (this.phase === 'up') return;
    this.time += dt;
    if (this.phase === 'flicker' && this.time >= this.spec.flicker) {
      this.phase = 'down';
      this.time = 0;
      this.drops++;
    } else if (this.phase === 'down' && this.time >= this.spec.down) {
      this.phase = 'up';
      this.time = 0;
    }
  }

  /** 揺らぎの強さ（0〜1。見た目） */
  get flickerAmount(): number {
    return this.phase === 'flicker'
      ? Math.min(1, this.time / Math.max(0.001, this.spec.flicker))
      : 0;
  }
}

export type WarpPhase = 'idle' | 'telegraph' | 'cooldown';

export interface WarpSpec {
  readonly telegraph: number;
  readonly cooldown: number;
  /** 移る先の輪（中心からの半径の下限・上限 m）と高さ（m）、狙う人から離す距離（m） */
  readonly ringMin: number;
  readonly ringMax: number;
  readonly altitudeMin: number;
  readonly altitudeMax: number;
  readonly keepAway: number;
}

export class Warp {
  phase: WarpPhase = 'idle';
  time = 0;
  /** 移る先（予兆の光の位置） */
  readonly destination: Vec3 = vec3();
  warps = 0;

  constructor(readonly spec: WarpSpec) {}

  get ready(): boolean {
    return this.phase === 'idle';
  }

  /**
   * 移る先を決めて予兆を始める。center は戦う場所の中心、avoid は離す人の位置。輪の上の 8 か所を乱数の順に試し、
   * avoid から keepAway 以上離れた最初の所（全部近ければ一番遠い所）
   */
  begin(center: Readonly<Vec3>, avoid: Readonly<Vec3> | null, rnd: () => number): boolean {
    if (!this.ready) return false;
    const s = this.spec;
    const start = rnd() * Math.PI * 2;
    const r = s.ringMin + rnd() * (s.ringMax - s.ringMin);
    const y = s.altitudeMin + rnd() * (s.altitudeMax - s.altitudeMin);
    let bestD = -1;
    for (let k = 0; k < 8; k++) {
      const a = start + (k * Math.PI) / 4;
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;
      const d = avoid ? Math.hypot(x - avoid.x, y - avoid.y, z - avoid.z) : Infinity;
      if (d > bestD) {
        bestD = d;
        this.destination.x = x;
        this.destination.y = y;
        this.destination.z = z;
      }
      if (d >= s.keepAway) break;
    }
    this.phase = 'telegraph';
    this.time = 0;
    return true;
  }

  /** 1 ステップ。移る瞬間に true（呼ぶ側が destination へ位置を移す） */
  step(dt: number): boolean {
    if (this.phase === 'idle') return false;
    this.time += dt;
    if (this.phase === 'telegraph' && this.time >= this.spec.telegraph) {
      this.phase = 'cooldown';
      this.time = 0;
      this.warps++;
      return true;
    }
    if (this.phase === 'cooldown' && this.time >= this.spec.cooldown) {
      this.phase = 'idle';
      this.time = 0;
    }
    return false;
  }

  /** 予兆の光の強さ（0〜1。移る直前に一番強い） */
  get glow(): number {
    return this.phase === 'telegraph'
      ? Math.min(1, this.time / Math.max(0.001, this.spec.telegraph))
      : 0;
  }
}
