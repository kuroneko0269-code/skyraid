// 10-7c: メカ怪獣ゴウライの金属の板の絵を起動時（チャンクを読んだとき）にコードで作る（画像ファイルは使わない。道具は共通の
// kaiju-look/noise.ts）。三方向から貼る繰り返しの絵: R 明るさのむら（板ごとの色の違い・汚れの垂れ・焦げは暗く、傷はむき出しで明るい）・
// G つや（粗さ）のむら・B 凹凸の高さ（板の継ぎ目は溝、リベットは丸く高い、傷は浅い溝）・A 継ぎ目（熱の光が漏れる所）。乱数は決まった種から
import { GOURAI_VISUAL } from '../../data/gourai-visual';
import { byte, fbm, rng, stroke, walk } from '../kaiju-look/noise';

const P = GOURAI_VISUAL.plate;

/** 繰り返しの区切り（0〜1 の n 本。間を広すぎ・狭すぎにしない） */
function cuts(r: () => number, n: number): number[] {
  const out: number[] = [];
  const base = r();
  for (let i = 0; i < n; i++) out.push((base + (i + 0.2 + r() * 0.6) / n) % 1);
  return out.sort((a, b) => a - b);
}

/** 折り返しの距離（0〜0.5） */
const wrapDist = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 1;
  return Math.min(d, 1 - d);
};

/** 金属の板の絵（繰り返し）。size × size × RGBA */
export function buildGouraiPlatePixels(size: number, seed = 0x60a1): Uint8Array {
  const r = rng(seed);
  const n = size * size;
  const seam = new Float32Array(n);
  const rivet = new Float32Array(n);
  const panel = new Float32Array(n);
  const scratch = new Float32Array(n);
  const scorch = new Float32Array(n);
  const drip = new Float32Array(n);
  // 板: 縦の列に分け、列ごとに横へ区切る（ずれた石積みのような並び）。小さな点検の板を少し足す
  const cols = cuts(r, P.panels);
  const rows = cols.map(() => cuts(r, P.panels + 1));
  const tone = cols.map((_, i) => (rows[i] ?? []).map(() => r()));
  const px = 1 / size;
  const seamW = Math.max(1.1, size / 360) * px;
  const gap = P.rivetGap;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * px;
      const v = (y + 0.5) * px;
      const o = y * size + x;
      // どの列か（列の左の区切り）
      let ci = cols.length - 1;
      for (let i = 0; i < cols.length; i++) if (u >= (cols[i] ?? 0)) ci = i;
      const rs = rows[ci] ?? [];
      let ri = rs.length - 1;
      for (let i = 0; i < rs.length; i++) if (v >= (rs[i] ?? 0)) ri = i;
      panel[o] = tone[ci]?.[ri] ?? 0.5;
      // 継ぎ目までの距離（縦の線・その列の横の線）
      let dSeam = 1;
      for (const c of cols) dSeam = Math.min(dSeam, wrapDist(u, c));
      let dRow = 1;
      for (const c of rs) dRow = Math.min(dRow, wrapDist(v, c));
      const d = Math.min(dSeam, dRow);
      seam[o] = Math.max(0, 1 - d / seamW);
      // リベット: 継ぎ目から少し内側に、継ぎ目に沿って等間隔の丸
      const inset = 3.2 * seamW;
      const along = (t: number) => {
        const k = (t / gap) % 1;
        return Math.min(k, 1 - k) * gap;
      };
      let rv = 0;
      if (Math.abs(dSeam - inset) < 1.6 * seamW) {
        const q = Math.hypot(dSeam - inset, along(v)) / (1.4 * seamW);
        rv = Math.max(rv, 1 - q);
      }
      if (Math.abs(dRow - inset) < 1.6 * seamW) {
        const q = Math.hypot(dRow - inset, along(u)) / (1.4 * seamW);
        rv = Math.max(rv, 1 - q);
      }
      rivet[o] = Math.max(0, rv);
    }
  // 傷: 細く短い引っかき（むき出しの金属）。いくつかは平行の束
  for (let i = 0; i < P.scratches; i++) {
    const x = r();
    const y = r();
    const a = r() * Math.PI * 2;
    const lines = 1 + Math.floor(r() * 3);
    for (let j = 0; j < lines; j++) {
      const ox = Math.cos(a + Math.PI / 2) * 0.008 * j;
      const oy = Math.sin(a + Math.PI / 2) * 0.008 * j;
      stroke(
        scratch,
        size,
        walk(r, x + ox, y + oy, a, 4 + Math.floor(r() * 6), 0.012 + r() * 0.01, 0.12),
        0.0028 + r() * 0.002,
        0.6 + r() * 0.4,
        true,
      );
    }
  }
  // 焦げ: 丸く広がる黒いしみ（被弾の跡）。真ん中は砕けたように凹む
  for (let i = 0; i < P.scorches; i++) {
    const cx = r();
    const cy = r();
    const rad = 0.03 + r() * 0.05;
    const R = Math.ceil(rad * size * 1.6);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const xx = (((Math.round(cx * size) + dx) % size) + size) % size;
        const yy = (((Math.round(cy * size) + dy) % size) + size) % size;
        const u = xx / size;
        const v = yy / size;
        const q = Math.hypot(dx, dy) / (rad * size);
        const edge = 0.75 + 0.5 * fbm(u, v, 8, 71 + i);
        const s = Math.max(0, 1 - q / edge);
        const o = yy * size + xx;
        if (s > (scorch[o] ?? 0)) scorch[o] = s;
      }
  }
  // 汚れの垂れ: 継ぎ目・リベットの下へ流れる細い筋（三方向の横の面では下へ。v が増える向きを下とする）
  for (let i = 0; i < P.drips; i++) {
    const x = r();
    const y = r();
    const len = 0.04 + r() * 0.14;
    stroke(
      drip,
      size,
      [
        [x, y],
        [x + (r() - 0.5) * 0.01, y - len],
      ],
      0.004 + r() * 0.006,
      0.4 + r() * 0.4,
      true,
    );
  }
  const out = new Uint8Array(n * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const o = y * size + x;
      const u = x / size;
      const v = y / size;
      const big = fbm(u, v, 3, 17);
      const fine = fbm(u, v, 16, 29);
      const sm = seam[o] ?? 0;
      const rv = rivet[o] ?? 0;
      const pn = panel[o] ?? 0.5;
      const sc = scratch[o] ?? 0;
      const bu = scorch[o] ?? 0;
      const dr = drip[o] ?? 0;
      // 明るさ: 板ごとの色の違い・大きなむら・細かい粒・継ぎ目は暗い・焦げと垂れは暗い・傷は明るい
      const albedo =
        0.6 +
        0.2 * (pn - 0.5) +
        0.16 * (big - 0.5) +
        0.06 * (fine - 0.5) -
        0.14 * sm -
        0.45 * bu -
        0.16 * dr +
        0.32 * sc;
      // 粗さ: 板ごと・焦げは粗い・傷はつるつる
      const rough = 0.5 + 0.12 * (pn - 0.5) + 0.12 * (fine - 0.5) + 0.3 * bu + 0.12 * dr - 0.3 * sc;
      // 高さ: 継ぎ目は溝・リベットは高い・傷は浅い溝・焦げの真ん中は少し凹む
      const height = 0.6 + 0.05 * (big - 0.5) - 0.4 * sm + 0.14 * rv - 0.12 * sc - 0.1 * bu * bu;
      out[o * 4] = byte(albedo);
      out[o * 4 + 1] = byte(rough);
      out[o * 4 + 2] = byte(height);
      out[o * 4 + 3] = byte(sm);
    }
  return out;
}
