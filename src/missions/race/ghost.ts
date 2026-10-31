// リングレース（7-1）のゴースト: 走行を入力ではなく「位置・姿勢」で 15Hz に記録し、時刻で補間して再生する（Three.js 非依存）。
// 保存の形: 1 サンプル 12 バイト（位置 x・y・z を 0.25m 単位の Int16、姿勢のクォータニオンを w ≥ 0 にそろえて
// x・y・z を ×32767 の Int16。w は 1 − x² − y² − z² から戻す）をリトルエンディアンで並べて base64。
// 90 秒で 1350 サンプル = 16.2KB → base64 で約 21.6KB
import { RACE_CONFIG } from '../../data/race';
import { normalizeQuat, type Quat, type Vec3 } from '../../flight/math';

const BYTES = 12;
const Q = 32767;

export class GhostRecorder {
  private readonly samples: number[] = [];
  private nextAt = 0;
  readonly interval: number;

  constructor(readonly hz: number = RACE_CONFIG.ghostHz) {
    this.interval = 1 / hz;
  }

  reset(): void {
    this.samples.length = 0;
    this.nextAt = 0;
  }

  /** 走行の時計 time のときの位置・姿勢。記録の時刻（1/hz 秒おき）に達するたびに 1 つ残す */
  record(time: number, p: Readonly<Vec3>, q: Readonly<Quat>): void {
    while (time + 1e-9 >= this.nextAt) {
      const s = q.w < 0 ? -1 : 1;
      this.samples.push(p.x, p.y, p.z, q.x * s, q.y * s, q.z * s, q.w * s);
      this.nextAt += this.interval;
    }
  }

  get count(): number {
    return this.samples.length / 7;
  }

  /** 保存用の文字列 */
  encode(): string {
    return encodeGhost(this.samples, this.count);
  }
}

function toInt16(v: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(v)));
}

/** サンプル（x, y, z, qx, qy, qz, qw の並び）→ base64 */
export function encodeGhost(samples: readonly number[], count: number): string {
  const step = RACE_CONFIG.ghostPositionStep;
  const view = new DataView(new ArrayBuffer(count * BYTES));
  for (let i = 0; i < count; i++) {
    const o = i * BYTES;
    const s = i * 7;
    view.setInt16(o, toInt16((samples[s] ?? 0) / step), true);
    view.setInt16(o + 2, toInt16((samples[s + 1] ?? 0) / step), true);
    view.setInt16(o + 4, toInt16((samples[s + 2] ?? 0) / step), true);
    view.setInt16(o + 6, toInt16((samples[s + 3] ?? 0) * Q), true);
    view.setInt16(o + 8, toInt16((samples[s + 4] ?? 0) * Q), true);
    view.setInt16(o + 10, toInt16((samples[s + 5] ?? 0) * Q), true);
  }
  let binary = '';
  const bytes = new Uint8Array(view.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** 再生用のゴースト。decode できなければ null */
export class GhostTrack {
  private constructor(
    private readonly data: Float32Array,
    readonly count: number,
    readonly hz: number,
  ) {}

  static decode(text: string, hz: number = RACE_CONFIG.ghostHz): GhostTrack | null {
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    } catch {
      return null;
    }
    if (bytes.length === 0 || bytes.length % BYTES !== 0 || !(hz > 0)) return null;
    const count = bytes.length / BYTES;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const step = RACE_CONFIG.ghostPositionStep;
    const data = new Float32Array(count * 7);
    for (let i = 0; i < count; i++) {
      const o = i * BYTES;
      const d = i * 7;
      data[d] = view.getInt16(o, true) * step;
      data[d + 1] = view.getInt16(o + 2, true) * step;
      data[d + 2] = view.getInt16(o + 4, true) * step;
      const x = view.getInt16(o + 6, true) / Q;
      const y = view.getInt16(o + 8, true) / Q;
      const z = view.getInt16(o + 10, true) / Q;
      data[d + 3] = x;
      data[d + 4] = y;
      data[d + 5] = z;
      data[d + 6] = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
    }
    return new GhostTrack(data, count, hz);
  }

  /** 記録の長さ（秒） */
  get duration(): number {
    return (this.count - 1) / this.hz;
  }

  /** 時刻 time の位置・姿勢（前後のサンプルを線形補間・クォータニオンは正規化の線形補間）。最後を過ぎたら最後のまま */
  sample(time: number, outP: Vec3, outQ: Quat): void {
    const f = Math.max(0, Math.min(this.count - 1, time * this.hz));
    const i = Math.min(this.count - 2, Math.floor(f));
    const t = this.count < 2 ? 0 : f - Math.max(0, i);
    const a = Math.max(0, i) * 7;
    const b = Math.min(this.count - 1, Math.max(0, i) + 1) * 7;
    const d = this.data;
    const at = (k: number, sign = 1): number =>
      (d[a + k] ?? 0) + ((d[b + k] ?? 0) * sign - (d[a + k] ?? 0)) * t;
    outP.x = at(0);
    outP.y = at(1);
    outP.z = at(2);
    // w ≥ 0 にそろえたので w ≈ 0（南向きなど）で隣と符号が反転しうる。内積が負なら後ろを反転して近い側で補間
    let dot = 0;
    for (let k = 3; k < 7; k++) dot += (d[a + k] ?? 0) * (d[b + k] ?? 0);
    const sign = dot < 0 ? -1 : 1;
    outQ.x = at(3, sign);
    outQ.y = at(4, sign);
    outQ.z = at(5, sign);
    outQ.w = at(6, sign);
    normalizeQuat(outQ);
  }
}
