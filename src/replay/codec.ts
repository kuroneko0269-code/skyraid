// リプレイの記録の形（7-B。Three.js・DOM 非依存）: 'SKYR'・形式の版・ヘッダ（JSON）・チャンネルごとの入力・コマンド。
// 入力はチャンネル（ピッチ・ロール・…）ごとに「前のステップとの差」を並べ、差 0 の連続は 1 バイト（64 ステップまで）、
// -8〜7 の差の連続は 2 ステップで 1 バイト（4 bit ずつ）、それ以外は 1 ステップを可変長の整数で書く。
// キーボードの操作は差 0 がほとんどなので 1 分 1〜2KB、アナログのスティックでも小さな差が続くので 1 分 10KB 以下になる
import { DIFFICULTIES } from '../data/ai';
import { REPLAY_CONFIG } from '../data/replay';
import { FRAME_CHANNELS, type ReplayCommand, type ReplayData, type ReplayHeader } from './types';

const MAGIC = [0x53, 0x4b, 0x59, 0x52]; // 'SKYR'

class ByteWriter {
  private buf = new Uint8Array(1024);
  length = 0;

  byte(v: number): void {
    if (this.length >= this.buf.length) {
      const next = new Uint8Array(this.buf.length * 2);
      next.set(this.buf);
      this.buf = next;
    }
    this.buf[this.length++] = v & 0xff;
  }

  /** 0 以上の整数（7 bit ずつ） */
  varint(v: number): void {
    let n = Math.max(0, Math.floor(v));
    while (n >= 0x80) {
      this.byte((n & 0x7f) | 0x80);
      n = Math.floor(n / 128);
    }
    this.byte(n);
  }

  /** 符号付きの整数（ジグザグ） */
  zigzag(v: number): void {
    this.varint(v >= 0 ? v * 2 : -v * 2 - 1);
  }

  bytes(b: Uint8Array): void {
    for (const v of b) this.byte(v);
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

class ByteReader {
  pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  byte(): number {
    const v = this.buf[this.pos++];
    if (v === undefined) throw new Error('リプレイのデータが途中で切れている');
    return v;
  }

  varint(): number {
    let n = 0;
    let mul = 1;
    for (let i = 0; i < 8; i++) {
      const b = this.byte();
      n += (b & 0x7f) * mul;
      if (b < 0x80) return n;
      mul *= 128;
    }
    throw new Error('リプレイのデータが壊れている（整数）');
  }

  zigzag(): number {
    const n = this.varint();
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
  }

  bytes(n: number): Uint8Array {
    if (this.pos + n > this.buf.length) throw new Error('リプレイのデータが途中で切れている');
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

const RUN_MAX = 64;
const SMALL_MIN = -8;
const SMALL_MAX = 7;

const isSmall = (d: number): boolean => d >= SMALL_MIN && d <= SMALL_MAX;

/** 1 チャンネル（ステップごとの値）を書く */
export function encodeChannel(values: ArrayLike<number>, length: number): Uint8Array {
  const w = new ByteWriter();
  let prev = 0;
  let i = 0;
  const delta = (k: number, p: number): number => (values[k] ?? 0) - p;
  while (i < length) {
    const d = delta(i, prev);
    if (d === 0) {
      let n = 1;
      while (n < RUN_MAX && i + n < length && delta(i + n, prev) === 0) n++;
      w.byte(n - 1);
      i += n;
    } else if (isSmall(d)) {
      // 小さな差の連続（差 0 が 3 つ続いたら、そこからは差 0 の連続として書く）
      const block: number[] = [];
      let p = prev;
      let zeros = 0;
      while (block.length < RUN_MAX && i + block.length < length) {
        const dd = delta(i + block.length, p);
        if (!isSmall(dd)) break;
        zeros = dd === 0 ? zeros + 1 : 0;
        if (zeros >= 3) break;
        block.push(dd);
        p = values[i + block.length - 1] ?? 0;
      }
      // 末尾の差 0 は差 0 の連続に回す
      while (block.length > 1 && block[block.length - 1] === 0) block.pop();
      w.byte(0x40 | (block.length - 1));
      for (let k = 0; k < block.length; k += 2) {
        const lo = (block[k] ?? 0) & 0x0f;
        const hi = (block[k + 1] ?? 0) & 0x0f;
        w.byte(lo | (hi << 4));
      }
      i += block.length;
      prev = values[i - 1] ?? 0;
    } else {
      w.byte(0x80);
      w.zigzag(d);
      prev = values[i] ?? 0;
      i++;
    }
  }
  return w.result();
}

const nibble = (v: number): number => (v & 0x08 ? v - 16 : v);

/** encodeChannel の逆 */
export function decodeChannel(bytes: Uint8Array, length: number): Int16Array {
  const out = new Int16Array(length);
  const r = new ByteReader(bytes);
  let prev = 0;
  let i = 0;
  while (i < length) {
    const b = r.byte();
    if (b < 0x40) {
      const n = Math.min(b + 1, length - i);
      out.fill(prev, i, i + n);
      i += n;
    } else if (b < 0x80) {
      const n = (b & 0x3f) + 1;
      for (let k = 0; k < n; k += 2) {
        const v = r.byte();
        for (const d of [nibble(v & 0x0f), nibble(v >> 4)].slice(0, Math.min(2, n - k))) {
          if (i >= length) break;
          prev += d;
          out[i++] = prev;
        }
      }
    } else {
      prev += r.zigzag();
      if (i < length) out[i++] = prev;
    }
  }
  return out;
}

function encodeCommands(w: ByteWriter, commands: readonly ReplayCommand[]): void {
  w.varint(commands.length);
  let last = 0;
  for (const c of commands) {
    w.varint(c.step - last);
    last = c.step;
    switch (c.kind) {
      case 'select':
        w.byte(0);
        w.zigzag(c.target);
        break;
      case 'skip':
        w.byte(1);
        break;
      case 'enemies':
        w.byte(2);
        w.byte(c.enabled ? 1 : 0);
        w.byte(Math.max(0, DIFFICULTIES.indexOf(c.difficulty)));
        w.varint(c.count);
        break;
    }
  }
}

function decodeCommands(r: ByteReader): ReplayCommand[] {
  const n = r.varint();
  const out: ReplayCommand[] = [];
  let step = 0;
  for (let i = 0; i < n; i++) {
    step += r.varint();
    const kind = r.byte();
    if (kind === 0) out.push({ step, kind: 'select', target: r.zigzag() });
    else if (kind === 1) out.push({ step, kind: 'skip' });
    else if (kind === 2) {
      const enabled = r.byte() === 1;
      const difficulty = DIFFICULTIES[r.byte()] ?? 'normal';
      out.push({ step, kind: 'enemies', enabled, difficulty, count: r.varint() });
    } else throw new Error('リプレイのデータが壊れている（コマンド）');
  }
  return out;
}

/** 記録 1 本 → バイト列（.skyreplay・IndexedDB・セーブのゴースト） */
export function encodeReplay(data: ReplayData): Uint8Array {
  const w = new ByteWriter();
  for (const b of MAGIC) w.byte(b);
  w.byte(REPLAY_CONFIG.format);
  const header = new TextEncoder().encode(JSON.stringify(data.header));
  w.varint(header.length);
  w.bytes(header);
  w.byte(data.channels.length);
  for (const ch of data.channels) {
    const b = encodeChannel(ch, data.header.steps);
    w.varint(b.length);
    w.bytes(b);
  }
  encodeCommands(w, data.commands);
  return w.result();
}

/** ヘッダだけ読む（一覧）。読めなければ例外 */
export function decodeHeader(bytes: Uint8Array): ReplayHeader {
  return readStart(bytes).header;
}

function readStart(bytes: Uint8Array): { r: ByteReader; header: ReplayHeader } {
  const r = new ByteReader(bytes);
  for (const b of MAGIC) if (r.byte() !== b) throw new Error('リプレイのファイルではない');
  const format = r.byte();
  if (format > REPLAY_CONFIG.format) throw new Error('新しい版のリプレイ（読めない）');
  const text = new TextDecoder().decode(r.bytes(r.varint()));
  const header = parseHeader(JSON.parse(text) as unknown);
  return { r, header };
}

/** バイト列 → 記録 1 本。壊れていれば例外 */
export function decodeReplay(bytes: Uint8Array): ReplayData {
  const { r, header } = readStart(bytes);
  const count = r.byte();
  if (count !== FRAME_CHANNELS.length)
    throw new Error('リプレイのデータが壊れている（チャンネル）');
  const channels: Int16Array[] = [];
  for (let i = 0; i < count; i++) channels.push(decodeChannel(r.bytes(r.varint()), header.steps));
  return { header, channels, commands: decodeCommands(r) };
}

/** ヘッダの形を確かめる（インポートしたファイルは信用しない） */
function parseHeader(v: unknown): ReplayHeader {
  if (typeof v !== 'object' || v === null) throw new Error('リプレイのヘッダが壊れている');
  const h = v as Partial<Record<keyof ReplayHeader, unknown>>;
  const str = (x: unknown): x is string => typeof x === 'string';
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  if (
    !str(h.mode) ||
    !str(h.mapId) ||
    !str(h.aircraftId) ||
    !num(h.seed) ||
    !num(h.steps) ||
    h.steps < 0 ||
    h.steps > 60 * 60 * 120 ||
    typeof h.upgrades !== 'object' ||
    typeof h.enemies !== 'object'
  )
    throw new Error('リプレイのヘッダが壊れている');
  return v as ReplayHeader;
}

/** バイト列 ⇔ base64（セーブのゴースト） */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
