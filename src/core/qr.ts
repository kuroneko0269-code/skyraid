// QR コードの生成（5-4。ロビーの参加用 URL）。外部ライブラリなし。バイトモード（UTF-8）・誤り訂正 M・型番 1〜10
// （M で 213 バイトまで。参加用 URL は 60 バイト前後）。マスクは 8 種から失点（連続・2×2・明暗の偏り）の最も少ないもの。
// 仕様は JIS X 0510（ISO/IEC 18004）。DOM・Three.js 非依存（描画は ui/lobby-share.ts）

export interface QrCode {
  /** 一辺のモジュール数（21〜57。周りの余白（4 モジュール）は含まない） */
  readonly size: number;
  /** 行優先（y * size + x）。1 = 暗 */
  readonly modules: Uint8Array;
}

/** 型番ごと（1〜10）の誤り訂正 M のブロック構成: [誤り訂正の語数 / ブロック, [ブロック数, データの語数]...] */
const BLOCKS_M: readonly (readonly [number, ...(readonly [number, number])[]])[] = [
  [10, [1, 16]],
  [16, [1, 28]],
  [26, [1, 44]],
  [18, [2, 32]],
  [24, [2, 43]],
  [16, [4, 27]],
  [18, [4, 31]],
  [22, [2, 38], [2, 39]],
  [22, [3, 36], [2, 37]],
  [26, [4, 43], [1, 44]],
];
/** 位置合わせパターンの中心（型番 1〜10） */
const ALIGN: readonly (readonly number[])[] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];
/** 誤り訂正 M の形式情報のビット（L = 1, M = 0, Q = 3, H = 2） */
const ECL_M = 0;

function dataCodewords(version: number): number {
  const [, ...groups] = BLOCKS_M[version - 1] ?? [0];
  return groups.reduce((n, [count, words]) => n + count * words, 0);
}

/** GF(256)（原始多項式 0x11D）の掛け算 */
function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const out = new Array<number>(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = gfMul(out[j] ?? 0, root) ^ (out[j + 1] ?? 0);
    }
    root = gfMul(root, 2);
  }
  return out;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const out = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (out.shift() ?? 0);
    out.push(0);
    divisor.forEach((c, i) => {
      out[i] = (out[i] ?? 0) ^ gfMul(c, factor);
    });
  }
  return out;
}

/** データのビット列 → 誤り訂正を足してブロックを交互に並べた語の列 */
function codewords(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const put = (v: number, n: number): void => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(version) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let k = 0; k < 8; k++) v = (v << 1) | (bits[i + k] ?? 0);
    data.push(v);
  }
  for (let pad = 0xec; data.length < capacity / 8; pad ^= 0xec ^ 0x11) data.push(pad);
  const [ec, ...groups] = BLOCKS_M[version - 1] ?? [0];
  const divisor = rsDivisor(ec);
  const blocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let k = 0;
  for (const [count, words] of groups) {
    for (let i = 0; i < count; i++) {
      const block = data.slice(k, k + words);
      k += words;
      blocks.push(block);
      ecBlocks.push(rsRemainder(block, divisor));
    }
  }
  const out: number[] = [];
  const longest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.length) out.push(b[i] ?? 0);
  for (let i = 0; i < ec; i++) for (const b of ecBlocks) out.push(b[i] ?? 0);
  return out;
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Grid {
  readonly modules: Uint8Array;
  readonly fixed: Uint8Array;

  constructor(readonly size: number) {
    this.modules = new Uint8Array(size * size);
    this.fixed = new Uint8Array(size * size);
  }

  /** 機能パターン（データを置かない所）に書く */
  set(x: number, y: number, dark: boolean): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    this.modules[y * this.size + x] = dark ? 1 : 0;
    this.fixed[y * this.size + x] = 1;
  }

  get(x: number, y: number): number {
    return this.modules[y * this.size + x] ?? 0;
  }
}

function drawFunctionPatterns(g: Grid, version: number): void {
  const n = g.size;
  for (let i = 0; i < n; i++) {
    g.set(6, i, i % 2 === 0);
    g.set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [n - 4, 3],
    [3, n - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        g.set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    }
  }
  const align = ALIGN[version - 1] ?? [];
  const last = align.length - 1;
  align.forEach((cy, i) => {
    align.forEach((cx, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          g.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    });
  });
  drawFormat(g, 0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = n - 11 + (i % 3);
      const b = Math.floor(i / 3);
      g.set(a, b, dark);
      g.set(b, a, dark);
    }
  }
}

/** 形式情報（誤り訂正のレベルとマスクの番号）を 2 か所に書く */
function drawFormat(g: Grid, mask: number): void {
  const data = (ECL_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number): boolean => ((bits >>> i) & 1) === 1;
  const n = g.size;
  for (let i = 0; i <= 5; i++) g.set(8, i, bit(i));
  g.set(8, 7, bit(6));
  g.set(8, 8, bit(7));
  g.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) g.set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) g.set(n - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) g.set(8, n - 15 + i, bit(i));
  g.set(8, n - 8, true);
}

/** データを右下から 2 列ずつジグザグに置く */
function drawData(g: Grid, words: readonly number[]): void {
  const n = g.size;
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = ((right + 1) & 2) === 0 ? n - 1 - vert : vert;
        if (g.fixed[y * n + x]) continue;
        const w = words[i >>> 3] ?? 0;
        g.modules[y * n + x] = i < words.length * 8 ? (w >>> (7 - (i & 7))) & 1 : 0;
        i++;
      }
    }
  }
}

function applyMask(g: Grid, mask: number): void {
  const fn = MASKS[mask];
  if (!fn) return;
  const n = g.size;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      if (!g.fixed[i] && fn(x, y)) g.modules[i] = (g.modules[i] ?? 0) ^ 1;
    }
}

/** マスクの失点（同じ色の 5 つ以上の連続・2×2 の塊・明暗の偏り） */
function penalty(g: Grid): number {
  const n = g.size;
  let score = 0;
  for (let axis = 0; axis < 2; axis++) {
    for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b < n; b++) {
        const same = axis === 0 ? g.get(b, a) === g.get(b - 1, a) : g.get(a, b) === g.get(a, b - 1);
        if (same) run++;
        else run = 1;
        if (run === 5) score += 3;
        else if (run > 5) score++;
      }
    }
  }
  let dark = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c = g.get(x, y);
      dark += c;
      if (x < n - 1 && y < n - 1 && c === g.get(x + 1, y) && c === g.get(x, y + 1))
        if (c === g.get(x + 1, y + 1)) score += 3;
    }
  }
  return score + Math.floor(Math.abs((dark * 20) / (n * n) - 10)) * 10;
}

/** 文字列を QR コードにする（UTF-8）。長すぎれば（型番 10 の M に入らない）null */
export function encodeQr(text: string): QrCode | null {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (
    version <= 10 &&
    4 + (version < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(version) * 8
  )
    version++;
  if (version > 10) return null;
  const words = codewords(bytes, version);
  const size = 17 + version * 4;
  let best: Grid | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const g = new Grid(size);
    drawFunctionPatterns(g, version);
    drawData(g, words);
    applyMask(g, mask);
    drawFormat(g, mask);
    const s = penalty(g);
    if (s < bestScore) {
      bestScore = s;
      best = g;
    }
  }
  return best ? { size, modules: best.modules } : null;
}
