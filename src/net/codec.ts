// バイナリの読み書き（5-1）: 伸びる書き込みバッファ・範囲を検査する読み込み・クォータニオンの smallest-three 圧縮・
// 操作の量子化。Three.js 非依存
import type { Quat } from '../flight/math';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** 書き込み先。足りなくなったら倍に伸ばす。finish() で書いた分の ArrayBuffer を返す */
export class ByteWriter {
  private buffer: ArrayBuffer;
  private view: DataView;
  private offset = 0;

  constructor(capacity = 256) {
    this.buffer = new ArrayBuffer(capacity);
    this.view = new DataView(this.buffer);
  }

  private reserve(bytes: number): void {
    const need = this.offset + bytes;
    if (need <= this.buffer.byteLength) return;
    let size = this.buffer.byteLength * 2;
    while (size < need) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(new Uint8Array(this.buffer, 0, this.offset));
    this.buffer = next;
    this.view = new DataView(next);
  }

  u8(v: number): this {
    this.reserve(1);
    this.view.setUint8(this.offset, v);
    this.offset += 1;
    return this;
  }

  i8(v: number): this {
    this.reserve(1);
    this.view.setInt8(this.offset, v);
    this.offset += 1;
    return this;
  }

  u16(v: number): this {
    this.reserve(2);
    this.view.setUint16(this.offset, v);
    this.offset += 2;
    return this;
  }

  i16(v: number): this {
    this.reserve(2);
    this.view.setInt16(this.offset, v);
    this.offset += 2;
    return this;
  }

  u32(v: number): this {
    this.reserve(4);
    this.view.setUint32(this.offset, v >>> 0);
    this.offset += 4;
    return this;
  }

  f32(v: number): this {
    this.reserve(4);
    this.view.setFloat32(this.offset, v);
    this.offset += 4;
    return this;
  }

  f64(v: number): this {
    this.reserve(8);
    this.view.setFloat64(this.offset, v);
    this.offset += 8;
    return this;
  }

  /** UTF-8 の文字列（先頭 1 バイトが長さ。255 バイトを超える分は文字の途中で切らずに捨てる） */
  str(s: string): this {
    let bytes = encoder.encode(s);
    if (bytes.length > 255) {
      let end = 255;
      // 継続バイト（10xxxxxx）の手前まで戻して、文字の途中で切らない
      while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
      bytes = bytes.subarray(0, end);
    }
    this.u8(bytes.length);
    this.reserve(bytes.length);
    new Uint8Array(this.buffer, this.offset, bytes.length).set(bytes);
    this.offset += bytes.length;
    return this;
  }

  finish(): ArrayBuffer {
    return this.buffer.slice(0, this.offset);
  }
}

/** 読み込み。範囲外を読むと RangeError（decode が捕まえて「壊れたメッセージ」として捨てる） */
export class ByteReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(data: ArrayBuffer) {
    this.view = new DataView(data);
  }

  get remaining(): number {
    return this.view.byteLength - this.offset;
  }

  u8(): number {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  i8(): number {
    const v = this.view.getInt8(this.offset);
    this.offset += 1;
    return v;
  }

  u16(): number {
    const v = this.view.getUint16(this.offset);
    this.offset += 2;
    return v;
  }

  i16(): number {
    const v = this.view.getInt16(this.offset);
    this.offset += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.offset);
    this.offset += 4;
    return v;
  }

  f32(): number {
    const v = this.view.getFloat32(this.offset);
    this.offset += 4;
    return v;
  }

  f64(): number {
    const v = this.view.getFloat64(this.offset);
    this.offset += 8;
    return v;
  }

  str(): string {
    const n = this.u8();
    if (n > this.remaining) throw new RangeError('文字列が途中で切れている');
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, n);
    this.offset += n;
    return decoder.decode(bytes);
  }
}

// ---- クォータニオンの smallest-three（48 ビット） ----
// 絶対値が最大の成分を落とし（2 ビットで位置）、残り 3 成分（±1/√2 の範囲）を 15 ビットずつにする。
// 落とした成分は正にそろえ（q と -q は同じ回転）、復元は sqrt(1 - 残りの二乗和)。誤差は成分あたり約 2e-5

const QUAT_BITS = 15;
const QUAT_MAX = (1 << QUAT_BITS) - 1;
const QUAT_RANGE = Math.SQRT1_2;
const comps = [0, 0, 0, 0];

function packComponent(v: number): number {
  const t = (v / QUAT_RANGE) * 0.5 + 0.5;
  return Math.round(Math.min(1, Math.max(0, t)) * QUAT_MAX);
}

function unpackComponent(n: number): number {
  return ((n / QUAT_MAX) * 2 - 1) * QUAT_RANGE;
}

/** 正規化済みのクォータニオンを 6 バイトで書く */
export function writeQuat(w: ByteWriter, q: Readonly<Quat>): void {
  comps[0] = q.x;
  comps[1] = q.y;
  comps[2] = q.z;
  comps[3] = q.w;
  let largest = 0;
  for (let i = 1; i < 4; i++) {
    if (Math.abs(comps[i] ?? 0) > Math.abs(comps[largest] ?? 0)) largest = i;
  }
  const sign = (comps[largest] ?? 0) < 0 ? -1 : 1;
  const packed: number[] = [];
  for (let i = 0; i < 4; i++) {
    if (i !== largest) packed.push(packComponent((comps[i] ?? 0) * sign));
  }
  // 15 ビット × 3 の上位ビットに落とした成分の位置（2 ビット）を入れる
  w.u16(((largest & 2) << 14) | (packed[0] ?? 0));
  w.u16(((largest & 1) << 15) | (packed[1] ?? 0));
  w.u16(packed[2] ?? 0);
}

/** writeQuat で書いた 6 バイトを out に読む */
export function readQuat(r: ByteReader, out: Quat): Quat {
  const a = r.u16();
  const b = r.u16();
  const c = r.u16();
  const largest = ((a >> 15) << 1) | (b >> 15);
  const vals = [unpackComponent(a & QUAT_MAX), unpackComponent(b & QUAT_MAX), unpackComponent(c)];
  let sum = 0;
  for (const v of vals) sum += v * v;
  let k = 0;
  for (let i = 0; i < 4; i++) {
    comps[i] = i === largest ? Math.sqrt(Math.max(0, 1 - sum)) : (vals[k++] ?? 0);
  }
  out.x = comps[0] ?? 0;
  out.y = comps[1] ?? 0;
  out.z = comps[2] ?? 0;
  out.w = comps[3] ?? 1;
  return out;
}

// ---- 操作の量子化 ----
// 自機の先行計算もホストも「量子化した後の値」で計算するので、両者の結果が一致する

/** -1〜1 を 8 ビット符号付き（±127）に */
export function packAxis(v: number): number {
  return Math.round(Math.min(1, Math.max(-1, v)) * 127);
}

export function unpackAxis(n: number): number {
  return n / 127;
}

/** 0〜1 を 0〜254 に（255 は「指定なし」） */
export const UNIT_NONE = 255;

export function packUnit(v: number | null): number {
  return v === null ? UNIT_NONE : Math.round(Math.min(1, Math.max(0, v)) * 254);
}

export function unpackUnit(n: number): number | null {
  return n === UNIT_NONE ? null : n / 254;
}
