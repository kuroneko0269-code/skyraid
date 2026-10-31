// 街の配置の生成（6-4。Three.js 非依存・決定的）: 格子状の道路、区画ごとの建物（低層・中層・中心部のタワー）、
// 港（倉庫の帯・桟橋・クレーン）。同じ設定なら毎回同じ配置。建物は道路と海に重ならない（区画の内側・岸壁の手前）。
// 判定と「守れた建物」は常に全部（count）、描画は画質の数だけ viewOrder の先頭から
import { createRandom } from '../../core/random';
import { CITY_CONFIG, type BuildingKind } from '../../data/city';

export type CityConfig = typeof CITY_CONFIG;

export interface Rect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface Road extends Rect {
  readonly main: boolean;
}

/** 建物の部品の箱（ワールドの x・z の中心と幅・奥行き、地面からの下端と高さ） */
export interface BuildingPart {
  readonly cx: number;
  readonly cz: number;
  readonly w: number;
  readonly d: number;
  readonly y0: number;
  readonly h: number;
}

export interface Building extends Rect {
  readonly kind: BuildingKind;
  /** 地面の高さ（街は平ら） */
  readonly base: number;
  /** 地面から最も高い所まで */
  readonly height: number;
  readonly parts: readonly BuildingPart[];
  /** 0〜1 の個体差（色・窓） */
  readonly seed: number;
}

export interface CityLayout {
  readonly rect: Rect;
  readonly roads: readonly Road[];
  readonly buildings: readonly Building[];
  readonly piers: readonly Rect[];
  /** クレーン（足元の位置と、腕の向き。+Z = 海へ） */
  readonly cranes: readonly { readonly x: number; readonly z: number }[];
  /** 描画の優先順（タワー・中層・倉庫 → 低層をハッシュ順）。画質の数だけ先頭から描く */
  readonly viewOrder: readonly number[];
  /** 道路の中心線（x と z）。描画のシェーダーと同じ格子 */
  readonly roadX: readonly number[];
  readonly roadZ: readonly number[];
  /** 倉庫の帯と住宅地の境の z（海沿いの主要道路の中心） */
  readonly portLine: number;
}

interface Block extends Rect {
  readonly cx: number;
  readonly cz: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 範囲 [lo, hi] の整数 */
function intIn(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function generateCity(config: CityConfig = CITY_CONFIG): CityLayout {
  const rng = createRandom(config.seed);
  const r = config.rect;
  const rd = config.road;
  const base = config.groundHeight;
  const portLine =
    r.minZ + Math.floor((r.maxZ - config.port.depth - r.minZ) / rd.spacing) * rd.spacing;

  // ---- 道路（中心線の格子。mainEvery 本ごと・外周・海沿いは主要道路） ----
  const roadX: number[] = [];
  for (let x = r.minX; x <= r.maxX + 1e-6; x += rd.spacing) roadX.push(x);
  const roadZ: number[] = [];
  for (let z = r.minZ; z <= portLine + 1e-6; z += rd.spacing) roadZ.push(z);
  const isMain = (i: number, n: number): boolean => i % rd.mainEvery === 0 || i === n - 1;
  const widthX = roadX.map((_, i) => (isMain(i, roadX.length) ? rd.mainWidth : rd.width));
  const widthZ = roadZ.map((_, j) => (isMain(j, roadZ.length) ? rd.mainWidth : rd.width));
  const roads: Road[] = [];
  roadX.forEach((x, i) => {
    const w = widthX[i] ?? rd.width;
    // 南北の道路は海沿いの主要道路まで（倉庫の帯は主要道路の格子の線だけ岸壁まで通す）
    const toQuay = isMain(i, roadX.length);
    roads.push({
      minX: x - w / 2,
      maxX: x + w / 2,
      minZ: r.minZ - w / 2,
      maxZ: toQuay ? r.maxZ : portLine + (widthZ[widthZ.length - 1] ?? rd.mainWidth) / 2,
      main: isMain(i, roadX.length),
    });
  });
  roadZ.forEach((z, j) => {
    const w = widthZ[j] ?? rd.width;
    roads.push({
      minX: r.minX - w / 2,
      maxX: r.maxX + w / 2,
      minZ: z - w / 2,
      maxZ: z + w / 2,
      main: isMain(j, roadZ.length),
    });
  });

  // ---- 区画 ----
  const blocks: Block[] = [];
  for (let j = 0; j < roadZ.length - 1; j++) {
    for (let i = 0; i < roadX.length - 1; i++) {
      const minX = (roadX[i] ?? 0) + (widthX[i] ?? 0) / 2 + rd.setback;
      const maxX = (roadX[i + 1] ?? 0) - (widthX[i + 1] ?? 0) / 2 - rd.setback;
      const minZ = (roadZ[j] ?? 0) + (widthZ[j] ?? 0) / 2 + rd.setback;
      const maxZ = (roadZ[j + 1] ?? 0) - (widthZ[j + 1] ?? 0) / 2 - rd.setback;
      blocks.push({ minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 });
    }
  }
  const c = config.center;
  const dist = (b: Block): number => Math.hypot(b.cx - c.x, b.cz - c.z);

  // タワー: 中心に近い区画から 6〜10 棟（1 区画 1 棟）
  const nTowers = intIn(rng, config.towers.min, config.towers.max);
  const byDistance = blocks.slice().sort((a, b) => dist(a) - dist(b));
  const towerBlocks = new Set(byDistance.slice(0, nTowers));

  const buildings: Building[] = [];
  const add = (kind: BuildingKind, parts: BuildingPart[]): void => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let top = 0;
    for (const p of parts) {
      minX = Math.min(minX, p.cx - p.w / 2);
      maxX = Math.max(maxX, p.cx + p.w / 2);
      minZ = Math.min(minZ, p.cz - p.d / 2);
      maxZ = Math.max(maxZ, p.cz + p.d / 2);
      top = Math.max(top, p.y0 + p.h);
    }
    buildings.push({ kind, minX, maxX, minZ, maxZ, base, height: top, parts, seed: rng() });
  };
  const floorsOf = (kind: BuildingKind): number => {
    const k = config.kinds[kind];
    return intIn(rng, k.floors[0], k.floors[1]) * k.floorHeight;
  };
  /** 敷地 lot の中に、一辺 fill（割合）の箱を少しずらして置く */
  const boxIn = (lot: Rect, fillMin: number, fillMax: number, h: number, y0 = 0): BuildingPart => {
    const lw = lot.maxX - lot.minX;
    const ld = lot.maxZ - lot.minZ;
    const w = lw * lerp(fillMin, fillMax, rng());
    const d = ld * lerp(fillMin, fillMax, rng());
    const cx = lot.minX + w / 2 + (lw - w) * rng();
    const cz = lot.minZ + d / 2 + (ld - d) * rng();
    return { cx, cz, w, d, y0, h };
  };
  /** 区画を nx × nz の敷地に分ける（敷地の間は gap m） */
  const split = (b: Rect, nx: number, nz: number, gap: number): Rect[] => {
    const out: Rect[] = [];
    const lw = (b.maxX - b.minX - gap * (nx - 1)) / nx;
    const ld = (b.maxZ - b.minZ - gap * (nz - 1)) / nz;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const minX = b.minX + i * (lw + gap);
        const minZ = b.minZ + j * (ld + gap);
        out.push({ minX, maxX: minX + lw, minZ, maxZ: minZ + ld });
      }
    }
    return out;
  };

  for (const b of blocks) {
    const d = dist(b);
    if (towerBlocks.has(b)) {
      // タワー: 区画いっぱいの低い基壇（4 階）+ 細い塔 + 頂部の小さな箱
      const h = floorsOf('tower');
      const podium = boxIn(b, 0.85, 0.95, 4 * config.kinds.tower.floorHeight);
      const sw = Math.min(podium.w, podium.d) * lerp(0.45, 0.62, rng());
      const shaft: BuildingPart = {
        cx: podium.cx,
        cz: podium.cz,
        w: sw,
        d: sw * lerp(0.85, 1.15, rng()),
        y0: 0,
        h: h * 0.9,
      };
      const crown: BuildingPart = {
        cx: shaft.cx,
        cz: shaft.cz,
        w: shaft.w * 0.7,
        d: shaft.d * 0.7,
        y0: shaft.h,
        h: h * 0.1,
      };
      add('tower', [podium, shaft, crown]);
      continue;
    }
    const midChance = d < config.midRadius ? 0.95 * (1 - d / config.midRadius) + 0.08 : 0.03;
    if (rng() < midChance) {
      const nx = intIn(rng, config.midLots[0], config.midLots[1]);
      const nz = intIn(rng, config.midLots[0], config.midLots[1]);
      for (const lot of split(b, nx, nz, 6)) {
        const h = floorsOf('mid');
        const main = boxIn(lot, 0.7, 0.92, h);
        const parts = [main];
        // 半分は上の方を細くした段（セットバック）
        if (rng() < 0.5) {
          const top = h * lerp(0.15, 0.3, rng());
          parts[0] = { ...main, h: h - top };
          parts.push({
            cx: main.cx,
            cz: main.cz,
            w: main.w * 0.72,
            d: main.d * 0.72,
            y0: h - top,
            h: top,
          });
        }
        add('mid', parts);
      }
      continue;
    }
    const nx = intIn(rng, config.lowLots[0], config.lowLots[1]);
    const nz = intIn(rng, config.lowLots[0], config.lowLots[1]);
    for (const lot of split(b, nx, nz, 3)) add('low', [boxIn(lot, 0.68, 0.95, floorsOf('low'))]);
  }

  // ---- 港: 倉庫の帯（海沿いの主要道路と岸壁の間。南北の主要道路は避ける）・桟橋・クレーン ----
  const p = config.port;
  const apron = 24;
  const stripMinZ = portLine + (widthZ[widthZ.length - 1] ?? rd.mainWidth) / 2 + rd.setback;
  const stripMaxZ = r.maxZ - apron;
  const mainXs = roadX.filter((_, i) => isMain(i, roadX.length));
  for (let k = 0; k < mainXs.length - 1; k++) {
    let x = (mainXs[k] ?? 0) + rd.mainWidth / 2 + rd.setback;
    const end = (mainXs[k + 1] ?? 0) - rd.mainWidth / 2 - rd.setback;
    while (x < end - 30) {
      const len = Math.min(end - x, lerp(p.warehouse.length[0], p.warehouse.length[1], rng()));
      // 帯の奥行きに 2 列（海側・陸側）
      for (const row of [0, 1]) {
        const depth = lerp(p.warehouse.width[0], p.warehouse.width[1], rng());
        const z0 = row === 0 ? stripMinZ : stripMaxZ - depth;
        if (row === 1 && z0 < stripMinZ + depth + 8) continue;
        const h = lerp(p.warehouse.height[0], p.warehouse.height[1], rng());
        add('warehouse', [{ cx: x + len / 2, cz: z0 + depth / 2, w: len, d: depth, y0: 0, h }]);
      }
      x += len + 10;
    }
  }
  const piers: Rect[] = [];
  const cranes: { x: number; z: number }[] = [];
  const span = (r.maxX - r.minX) * 0.8;
  for (let k = 0; k < p.piers; k++) {
    const x = -span / 2 + (span * (k + 0.5)) / p.piers;
    piers.push({
      minX: x - p.pierWidth / 2,
      maxX: x + p.pierWidth / 2,
      minZ: r.maxZ - 2,
      maxZ: r.maxZ + p.pierLength,
    });
  }
  for (let k = 0; k < p.cranes; k++) {
    const pier = piers[k % piers.length];
    if (!pier) continue;
    const along = Math.floor(k / piers.length);
    // 1 周目は岸壁（桟橋の脇）、2 周目は桟橋の上
    const cx = (pier.minX + pier.maxX) / 2;
    cranes.push({ x: along === 0 ? cx - 34 : cx, z: r.maxZ - 10 + along * 110 });
  }

  // ---- 数を count にそろえる（多ければ低層をハッシュ順に間引く） ----
  const target = config.count;
  const lowIdx = buildings.map((b, i) => ({ b, i, key: b.seed })).filter((e) => e.b.kind === 'low');
  lowIdx.sort((a, b) => a.key - b.key);
  const remove = new Set<number>();
  for (let k = 0; k < buildings.length - target && k < lowIdx.length; k++) {
    const e = lowIdx[lowIdx.length - 1 - k];
    if (e) remove.add(e.i);
  }
  const kept = buildings.filter((_, i) => !remove.has(i));

  // 描画の優先順: 低層以外 → 低層（seed の小さい順 = ハッシュ順で街全体に散らばる）
  const order = kept.map((b, i) => ({ i, k: b.kind === 'low' ? 1 + b.seed : 0 }));
  order.sort((a, b) => a.k - b.k);
  return {
    rect: r,
    roads,
    buildings: kept,
    piers,
    cranes,
    viewOrder: order.map((o) => o.i),
    roadX,
    roadZ,
    portLine,
  };
}
