// クライアント側の同期（5-1）: 他機の表示（受信した状態をホストの時刻で 100ms 遅らせて補間、途切れたら速度で外挿）と、
// 入力の送信（毎ステップ記録し、30Hz で直近 6 ステップを冗長に送る）。Three.js 非依存。
// 自機の先行計算と補正は prediction.ts、ホスト側の入力の受け取りは input-buffer.ts
import { NET_CONFIG } from '../data/net';
import type { Quat, Vec3 } from '../flight/math';
import type { AircraftStateMsg, InputMsg, NetControls } from './protocol';

const S = NET_CONFIG.sync;

/** 1 機の 1 時点の状態（時刻はホストの秒） */
export interface Snapshot {
  time: number;
  readonly position: Vec3;
  readonly orientation: Quat;
  readonly velocity: Vec3;
  alive: boolean;
  afterburner: boolean;
  throttle: number;
  hp: number;
  invulnerable: boolean;
}

function createSnapshot(): Snapshot {
  return {
    time: 0,
    position: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
    velocity: { x: 0, y: 0, z: 0 },
    alive: true,
    afterburner: false,
    throttle: 0,
    hp: 0,
    invulnerable: false,
  };
}

function copyInto(out: Snapshot, time: number, m: Readonly<AircraftStateMsg>): void {
  out.time = time;
  out.position.x = m.position.x;
  out.position.y = m.position.y;
  out.position.z = m.position.z;
  out.orientation.x = m.orientation.x;
  out.orientation.y = m.orientation.y;
  out.orientation.z = m.orientation.z;
  out.orientation.w = m.orientation.w;
  out.velocity.x = m.velocity.x;
  out.velocity.y = m.velocity.y;
  out.velocity.z = m.velocity.z;
  out.alive = m.alive;
  out.afterburner = m.afterburner;
  out.throttle = m.throttle;
  out.hp = m.hp;
  out.invulnerable = m.invulnerable;
}

/** 補間した結果。mode: interpolated（2 点の間）/ extrapolated（最新より先を速度で）/ held（外挿の上限を超えた）/ empty */
export type SampleMode = 'interpolated' | 'extrapolated' | 'held' | 'empty';

export interface SampledPose {
  readonly position: Vec3;
  readonly orientation: Quat;
  /** 使った最新の状態（演出の炎・HP など） */
  latest: Snapshot | null;
}

export function createSampledPose(): SampledPose {
  return { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 }, latest: null };
}

/**
 * 1 機ぶんの受信した状態の並び（時刻順）。順不同の経路で遅れて届いた古い状態も時刻の位置に入れる。
 * 入れ物は使い回す（毎回の割り当てなし）
 */
export class SnapshotBuffer {
  private readonly items: Snapshot[] = [];
  private readonly spare: Snapshot[] = [];
  /** これ以前の状態は入れない（復帰で位置が飛んだ。5-3） */
  private floor = -Infinity;

  get size(): number {
    return this.items.length;
  }

  get newest(): Snapshot | null {
    return this.items[this.items.length - 1] ?? null;
  }

  push(time: number, msg: Readonly<AircraftStateMsg>): void {
    const items = this.items;
    if (time <= this.floor) return;
    const newest = this.newest;
    // 撃墜 → 復帰（5-3）: 残骸と出現位置の間を補間しないよう、そこから並べ直す（遅れて届いた前の状態も捨てる）
    if (msg.alive && newest && !newest.alive && time > newest.time) {
      this.clear();
      this.floor = newest.time;
    }
    let i = items.length;
    while (i > 0 && (items[i - 1]?.time ?? 0) > time) i--;
    if (items[i - 1]?.time === time) return;
    const snap = this.spare.pop() ?? createSnapshot();
    copyInto(snap, time, msg);
    items.splice(i, 0, snap);
    while (items.length > S.bufferSize) {
      const old = items.shift();
      if (old) this.spare.push(old);
    }
  }

  clear(): void {
    this.spare.push(...this.items);
    this.items.length = 0;
  }

  /** 時刻 t（ホストの秒）の位置・姿勢を out に書く */
  sample(t: number, out: SampledPose): SampleMode {
    const items = this.items;
    const last = items[items.length - 1];
    if (!last) {
      out.latest = null;
      return 'empty';
    }
    out.latest = last;
    if (t >= last.time || items.length === 1) {
      const dt = Math.min(Math.max(0, t - last.time), S.maxExtrapolationSeconds);
      this.extrapolate(last, items[items.length - 2] ?? null, dt, out);
      if (t <= last.time) return 'interpolated';
      return t - last.time > S.maxExtrapolationSeconds ? 'held' : 'extrapolated';
    }
    let i = items.length - 1;
    while (i > 0 && (items[i - 1]?.time ?? 0) > t) i--;
    const a = items[i - 1];
    const b = items[i];
    if (!a || !b) {
      // 最古より前: 最古の状態のまま
      const first = items[0] ?? last;
      copyVec(out.position, first.position);
      copyQuatInto(out.orientation, first.orientation);
      return 'interpolated';
    }
    const span = b.time - a.time;
    const s = span > 0 ? (t - a.time) / span : 1;
    hermite(out.position, a.position, a.velocity, b.position, b.velocity, s, span);
    slerp(out.orientation, a.orientation, b.orientation, s);
    return 'interpolated';
  }

  /**
   * 最新の状態から dt 秒先を外挿する。直前の状態があれば速度の変化（加速度）も使い、旋回の弧に沿わせる。
   * 姿勢も直前からの回転を同じ割合で続ける
   */
  private extrapolate(last: Snapshot, prev: Snapshot | null, dt: number, out: SampledPose): void {
    const p = last.position;
    const v = last.velocity;
    const span = prev ? last.time - prev.time : 0;
    if (!prev || span <= 0 || span > S.maxExtrapolationSeconds) {
      out.position.x = p.x + v.x * dt;
      out.position.y = p.y + v.y * dt;
      out.position.z = p.z + v.z * dt;
      copyQuatInto(out.orientation, last.orientation);
      return;
    }
    const h = 0.5 * dt * dt;
    out.position.x = p.x + v.x * dt + accel(v.x, prev.velocity.x, span) * h;
    out.position.y = p.y + v.y * dt + accel(v.y, prev.velocity.y, span) * h;
    out.position.z = p.z + v.z * dt + accel(v.z, prev.velocity.z, span) * h;
    slerp(out.orientation, prev.orientation, last.orientation, 1 + dt / span);
  }
}

function accel(v1: number, v0: number, span: number): number {
  const a = (v1 - v0) / span;
  return Math.max(-S.maxExtrapolationAccel, Math.min(S.maxExtrapolationAccel, a));
}

function copyVec(out: Vec3, v: Readonly<Vec3>): void {
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
}

function copyQuatInto(out: Quat, q: Readonly<Quat>): void {
  out.x = q.x;
  out.y = q.y;
  out.z = q.z;
  out.w = q.w;
}

/** 位置と速度の 3 次エルミート補間（旋回中の弧を直線より正しくなぞる） */
export function hermite(
  out: Vec3,
  p0: Readonly<Vec3>,
  v0: Readonly<Vec3>,
  p1: Readonly<Vec3>,
  v1: Readonly<Vec3>,
  s: number,
  span: number,
): Vec3 {
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = (s3 - 2 * s2 + s) * span;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = (s3 - s2) * span;
  out.x = h00 * p0.x + h10 * v0.x + h01 * p1.x + h11 * v1.x;
  out.y = h00 * p0.y + h10 * v0.y + h01 * p1.y + h11 * v1.y;
  out.z = h00 * p0.z + h10 * v0.z + h01 * p1.z + h11 * v1.z;
  return out;
}

/** 球面線形補間（近い方の回りで） */
export function slerp(out: Quat, a: Readonly<Quat>, b: Readonly<Quat>, s: number): Quat {
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  let cos = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let k0 = 1 - s;
  let k1 = s;
  if (cos < 0.9995) {
    const angle = Math.acos(Math.min(1, cos));
    const sin = Math.sin(angle);
    k0 = Math.sin((1 - s) * angle) / sin;
    k1 = Math.sin(s * angle) / sin;
  }
  out.x = a.x * k0 + bx * k1;
  out.y = a.y * k0 + by * k1;
  out.z = a.z * k0 + bz * k1;
  out.w = a.w * k0 + bw * k1;
  const len = Math.hypot(out.x, out.y, out.z, out.w) || 1;
  out.x /= len;
  out.y /= len;
  out.z /= len;
  out.w /= len;
  return out;
}

/**
 * ホストの時刻の推定。届いた状態の「ホストの時刻 − 届いた時刻」の直近の最大（いちばん早く届いたもの）を
 * ずれとし、表示時刻 = 今 + ずれ − 補間の遅れ。ずれは急に変えずなめらかに寄せる（大きく違えば一度に合わせる）
 */
export class HostClock {
  private readonly samples: number[] = [];
  private offset: number | null = null;
  private lastLocal: number | null = null;

  /** 状態を受け取ったとき（どちらも秒） */
  observe(hostTime: number, localTime: number): void {
    this.samples.push(hostTime - localTime);
    if (this.samples.length > S.clockWindow) this.samples.shift();
    if (this.offset === null) this.offset = hostTime - localTime;
  }

  /** 推定したホストの今の時刻（秒）。まだ何も届いていなければ null */
  hostNow(localTime: number): number | null {
    if (this.offset === null) return null;
    const target = Math.max(...this.samples);
    const elapsed = this.lastLocal === null ? 0 : Math.max(0, localTime - this.lastLocal);
    this.lastLocal = localTime;
    const diff = target - this.offset;
    if (Math.abs(diff) > S.clockSnapSeconds) this.offset = target;
    else {
      const step = S.clockSlewPerSecond * elapsed;
      this.offset += Math.max(-step, Math.min(step, diff));
    }
    return localTime + this.offset;
  }

  /** 他機を表示する時刻（ホストの秒） */
  renderTime(localTime: number): number | null {
    const now = this.hostNow(localTime);
    return now === null ? null : now - S.interpolationDelaySeconds;
  }
}

/** 入力の送信。毎ステップ record し、ready() のステップで message() を送る */
export class InputSender {
  private readonly ring: NetControls[] = [];
  private newestSeq = 0;
  /** 最新のステップで他機を表示していたホストの tick（遅延補償。5-3。0 はまだ） */
  viewTick = 0;
  private readonly every = Math.round(NET_CONFIG.rates.tickHz / NET_CONFIG.rates.inputHz);

  /** seq（1 から）のステップの操作（量子化済み）を記録する */
  record(seq: number, c: Readonly<NetControls>): void {
    const n = NET_CONFIG.input.redundancyTicks;
    const slot = this.ring[seq % n] ?? { ...c };
    Object.assign(slot, c);
    this.ring[seq % n] = slot;
    this.newestSeq = seq;
  }

  /** このステップで送るか（30Hz） */
  ready(): boolean {
    return this.newestSeq > 0 && this.newestSeq % this.every === 0;
  }

  /** 直近のステップ（最新から古い順。最初のステップより前は含めない） */
  message(): InputMsg {
    const n = Math.min(NET_CONFIG.input.redundancyTicks, this.newestSeq);
    const controls: NetControls[] = [];
    for (let i = 0; i < n; i++) {
      const c = this.ring[(this.newestSeq - i) % NET_CONFIG.input.redundancyTicks];
      if (c) controls.push({ ...c });
    }
    return { type: 'input', seq: this.newestSeq, viewTick: this.viewTick, controls };
  }
}
