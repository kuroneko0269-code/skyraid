// 街の建物の状態と判定（6-4。Three.js 非依存）: 壊れる（崩れる 0.4 秒 → 瓦礫）・自機との衝突（高層だけの簡易 AABB）・
// 爆弾とロケットの着弾の高さ（屋根・壁で起爆）・怪獣（歩行・薙ぎ払い・熱線）による破壊・「守れた建物」の割合。
// 配置は src/render/city/layout.ts（決定的）。検索は一辺 cell m の格子
import { CITY_CONFIG } from '../data/city';
import type { Vec3 } from '../flight/math';
import type { Building, CityLayout } from '../render/city/layout';

export type BuildingState = 'intact' | 'collapsing' | 'rubble';

/** 壊した原因（演出・集計） */
export type BuildingCause = 'kaiju' | 'player';

export interface CollapseEvent {
  readonly index: number;
  readonly cause: BuildingCause;
}

const CELL = 50;

export class BuildingField {
  readonly states: BuildingState[];
  /** 崩れ始めてからの秒数（collapsing の間） */
  readonly timers: Float32Array;
  /** 崩れた・瓦礫になった・…の変化の回数（描画が見て作り直す） */
  version = 0;
  private readonly cols: number;
  private readonly rows: number;
  private readonly grid: number[][];
  private readonly tall: number[];
  private readonly listeners: ((e: CollapseEvent) => void)[] = [];
  private destroyed = 0;
  private readonly seen: Uint32Array;
  private stamp = 0;
  private collapsing = 0;

  constructor(
    readonly layout: CityLayout,
    private readonly config = CITY_CONFIG,
  ) {
    const n = layout.buildings.length;
    this.states = new Array<BuildingState>(n).fill('intact');
    this.timers = new Float32Array(n);
    this.seen = new Uint32Array(n);
    const r = layout.rect;
    this.cols = Math.ceil((r.maxX - r.minX) / CELL) + 2;
    this.rows = Math.ceil((r.maxZ - r.minZ) / CELL) + 2;
    this.grid = Array.from({ length: this.cols * this.rows }, () => []);
    this.tall = [];
    layout.buildings.forEach((b, i) => {
      const [c0, r0] = this.cellOf(b.minX, b.minZ);
      const [c1, r1] = this.cellOf(b.maxX, b.maxZ);
      for (let rr = r0; rr <= r1; rr++)
        for (let cc = c0; cc <= c1; cc++) this.grid[rr * this.cols + cc]?.push(i);
      if (b.height >= config.collisionMinHeight) this.tall.push(i);
    });
  }

  get count(): number {
    return this.layout.buildings.length;
  }

  /** 壊れていない建物の割合（0〜1。崩れている途中は壊れた扱い） */
  get intactRatio(): number {
    return this.count > 0 ? 1 - this.destroyed / this.count : 1;
  }

  get destroyedCount(): number {
    return this.destroyed;
  }

  /** 崩れている途中の建物があるか（描画を毎フレーム作り直す） */
  get animating(): boolean {
    return this.collapsing > 0;
  }

  onCollapse(fn: (e: CollapseEvent) => void): void {
    this.listeners.push(fn);
  }

  /** すべて建て直す（ミッション・フリーフライトの始め） */
  reset(): void {
    this.states.fill('intact');
    this.timers.fill(0);
    this.destroyed = 0;
    this.collapsing = 0;
    this.version++;
  }

  /** 固定ステップ: 崩れている建物の時間を進め、collapseSeconds で瓦礫にする */
  step(dt: number): void {
    if (this.collapsing === 0) return;
    for (let i = 0; i < this.states.length; i++) {
      if (this.states[i] !== 'collapsing') continue;
      const t = (this.timers[i] ?? 0) + dt;
      this.timers[i] = t;
      if (t >= this.config.collapseSeconds) {
        this.states[i] = 'rubble';
        this.collapsing--;
        this.version++;
      }
    }
  }

  /** 崩れの進み具合（0 立っている〜1 崩れきった） */
  collapseProgress(i: number): number {
    const s = this.states[i];
    if (s === 'intact') return 0;
    if (s === 'rubble') return 1;
    return Math.min(1, (this.timers[i] ?? 0) / this.config.collapseSeconds);
  }

  /** 1 棟を壊す（立っているときだけ）。壊したら true */
  destroy(i: number, cause: BuildingCause): boolean {
    if (this.states[i] !== 'intact') return false;
    this.states[i] = 'collapsing';
    this.timers[i] = 0;
    this.destroyed++;
    this.collapsing++;
    this.version++;
    for (const fn of this.listeners) fn({ index: i, cause });
    return true;
  }

  // ---- 検索 ----

  private cellOf(x: number, z: number): [number, number] {
    const r = this.layout.rect;
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor((x - r.minX) / CELL) + 1));
    const rr = Math.min(this.rows - 1, Math.max(0, Math.floor((z - r.minZ) / CELL) + 1));
    return [c, rr];
  }

  /** 水平の四角 [minX, maxX] × [minZ, maxZ] にかかる格子の建物を 1 回ずつ fn に渡す */
  private forEachIn(
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    fn: (i: number, b: Building) => void,
  ): void {
    const r = this.layout.rect;
    if (
      maxX < r.minX - CELL ||
      minX > r.maxX + CELL ||
      maxZ < r.minZ - CELL ||
      minZ > r.maxZ + CELL
    )
      return;
    const [c0, r0] = this.cellOf(minX, minZ);
    const [c1, r1] = this.cellOf(maxX, maxZ);
    const stamp = ++this.stamp;
    const bs = this.layout.buildings;
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        const cell = this.grid[rr * this.cols + cc];
        if (!cell) continue;
        for (const i of cell) {
          if (this.seen[i] === stamp) continue;
          this.seen[i] = stamp;
          const b = bs[i];
          if (b) fn(i, b);
        }
      }
    }
  }

  /** 立っている建物の (x, z) の屋根の高さ（ワールド。建物がなければ −Infinity）。爆弾・ロケットの着弾に使う */
  topAt(x: number, z: number): number {
    let top = -Infinity;
    this.forEachIn(x, x, z, z, (i, b) => {
      if (this.states[i] !== 'intact') return;
      for (const p of b.parts) {
        if (Math.abs(x - p.cx) <= p.w / 2 && Math.abs(z - p.cz) <= p.d / 2)
          top = Math.max(top, b.base + p.y0 + p.h);
      }
    });
    return top;
  }

  /**
   * 自機の移動（線分 a → b）が高層（高さ collisionMinHeight 以上）の立っている建物の部品の箱（radius だけ膨らませる）に
   * かかるか。低層は飛び抜けられる
   */
  collides(
    a: Readonly<Vec3>,
    b: Readonly<Vec3>,
    radius: number = this.config.aircraftRadius,
  ): boolean {
    const r = this.layout.rect;
    if (Math.max(a.x, b.x) < r.minX - 100 || Math.min(a.x, b.x) > r.maxX + 100) return false;
    if (Math.max(a.z, b.z) < r.minZ - 100 || Math.min(a.z, b.z) > r.maxZ + 100) return false;
    const bs = this.layout.buildings;
    for (const i of this.tall) {
      if (this.states[i] !== 'intact') continue;
      const bd = bs[i];
      if (!bd) continue;
      if (Math.min(a.y, b.y) > bd.base + bd.height + radius) continue;
      for (const p of bd.parts) {
        if (
          segmentHitsBox(
            a,
            b,
            p.cx - p.w / 2 - radius,
            bd.base + p.y0 - radius,
            p.cz - p.d / 2 - radius,
            p.cx + p.w / 2 + radius,
            bd.base + p.y0 + p.h + radius,
            p.cz + p.d / 2 + radius,
          )
        )
          return true;
      }
    }
    return false;
  }

  // ---- 破壊 ----

  /** 球（爆発）にかかる建物を壊す。壊した数 */
  hitSphere(x: number, y: number, z: number, radius: number, cause: BuildingCause): number {
    let n = 0;
    this.forEachIn(x - radius, x + radius, z - radius, z + radius, (i, b) => {
      if (this.states[i] !== 'intact') return;
      const dx = Math.max(b.minX - x, 0, x - b.maxX);
      const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
      const dy = Math.max(b.base - y, 0, y - (b.base + b.height));
      if (dx * dx + dy * dy + dz * dz <= radius * radius && this.destroy(i, cause)) n++;
    });
    return n;
  }

  /** 水平の円（怪獣の足元・薙ぎ払い）にかかる建物を壊す。壊した数 */
  hitCircle(x: number, z: number, radius: number, cause: BuildingCause): number {
    let n = 0;
    this.forEachIn(x - radius, x + radius, z - radius, z + radius, (i, b) => {
      if (this.states[i] !== 'intact') return;
      const dx = Math.max(b.minX - x, 0, x - b.maxX);
      const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
      if (dx * dx + dz * dz <= radius * radius && this.destroy(i, cause)) n++;
    });
    return n;
  }

  /** 太い線分（熱線: 始点・単位方向・長さ・半径）にかかる建物を壊す。壊した数 */
  hitBeam(
    o: Readonly<Vec3>,
    dir: Readonly<Vec3>,
    length: number,
    radius: number,
    cause: BuildingCause,
  ): number {
    const ex = o.x + dir.x * length;
    const ey = o.y + dir.y * length;
    const ez = o.z + dir.z * length;
    const end = { x: ex, y: ey, z: ez };
    let n = 0;
    this.forEachIn(
      Math.min(o.x, ex) - radius,
      Math.max(o.x, ex) + radius,
      Math.min(o.z, ez) - radius,
      Math.max(o.z, ez) + radius,
      (i, b) => {
        if (this.states[i] !== 'intact') return;
        if (
          segmentHitsBox(
            o,
            end,
            b.minX - radius,
            b.base - radius,
            b.minZ - radius,
            b.maxX + radius,
            b.base + b.height + radius,
            b.maxZ + radius,
          ) &&
          this.destroy(i, cause)
        )
          n++;
      },
    );
    return n;
  }
}

/** 線分 a → b が箱（min・max）にかかるか（スラブ法） */
export function segmentHitsBox(
  a: Readonly<Vec3>,
  b: Readonly<Vec3>,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): boolean {
  // 毎ステップ何百回も呼ぶので配列を作らない
  const r = { t0: 0, t1: 1 };
  return (
    slab(r, a.x, b.x - a.x, minX, maxX) &&
    slab(r, a.y, b.y - a.y, minY, maxY) &&
    slab(r, a.z, b.z - a.z, minZ, maxZ)
  );
}

function slab(
  r: { t0: number; t1: number },
  p: number,
  d: number,
  lo: number,
  hi: number,
): boolean {
  if (Math.abs(d) < 1e-9) return p >= lo && p <= hi;
  let ta = (lo - p) / d;
  let tb = (hi - p) / d;
  if (ta > tb) {
    const t = ta;
    ta = tb;
    tb = t;
  }
  r.t0 = Math.max(r.t0, ta);
  r.t1 = Math.min(r.t1, tb);
  return r.t0 <= r.t1;
}

/** 「守れた建物」の割合（%。小数を切り捨て） */
export function protectedPercent(field: BuildingField): number {
  return Math.floor(field.intactRatio * 100 + 1e-9);
}
