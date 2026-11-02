// 胴体（断面を前後で変えるロフト）・キャノピー・エアインテーク・ノズル・ナセル
import { SphereGeometry } from 'three';
import type { AircraftShape } from '../../data/aircraft-shapes';
import { AIRCRAFT_MODEL_CONFIG } from '../../data/aircraft-model';
import type { MeshAccumulator, Rgb, UvFn } from './accumulator';
import { loft, type LoftUv, type Ring } from './loft';
import { PART, stationZ, wingSection } from './planform';

/** 胴体の断面の寸法（中心の高さ・横の半径・上下の半径・超楕円の指数） */
export interface Section {
  readonly cy: number;
  readonly a: number;
  readonly top: number;
  readonly bottom: number;
  readonly n: number;
}

/** ノズルが胴体の後端から出る長さ（m） */
export const NOZZLE_PROTRUDE = 0.4;

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 機首からの割合 s の胴体の断面 */
export function fuselageSection(shape: Readonly<AircraftShape>, s: number): Section {
  const W = shape.fuselageWidth / 2;
  const H = shape.fuselageHeight / 2;
  const nf = shape.noseFraction;
  // 機首: 先端は尖り（傾き一定の円錐）、根元でレドームの太さになる
  const t = Math.min(1, s / nf);
  const k = 1 - (1 - t) ** 2;
  const radome = Math.min(W, H) * 0.62;
  // 機首の太さ → 胴体の太さ
  const grow = smooth(nf, nf + 0.2, s);
  let a = mix(radome * k, W, grow);
  let top = mix(radome * k, H * 0.88, grow);
  let bottom = mix(radome * k, H, grow);
  let cy = -0.18 * H * (1 - k);
  // キャノピーの後ろの背中の盛り上がり（コックピットから尾部へ下がる）
  const c = shape.cockpit;
  const spine = smooth(c.position, c.position + 0.08, s) * (1 - smooth(0.5, 0.95, s));
  top += c.height * 0.42 * spine;
  // 尾部: ノズルの太さへ絞る（輸送機は細く絞って跳ね上げる）
  const r = shape.nozzleRadius * 1.08;
  const twin = shape.engines === 2;
  const tail = smooth(0.74, 1, s);
  if (shape.engines === 4) {
    a = mix(a, W * 0.18, tail);
    top = mix(top, H * 0.2, tail);
    bottom = mix(bottom, H * 0.12, tail);
    cy += shape.tailUpsweep * smooth(0.6, 1, s);
  } else {
    a = mix(a, twin ? r * 2.1 : r, tail);
    top = mix(top, r, tail);
    bottom = mix(bottom, r, tail);
  }
  const n = mix(2, shape.engines === 4 ? 2.2 : 2.8, grow) * (1 - tail) + 2.2 * tail;
  return { cy, a, top, bottom, n };
}

/** 胴体の UV: 前後 s を u、周の角度 t を v の 0〜0.5 に */
export const fuselageUv: LoftUv = (s, t) => [s, 0.5 * t];

/** 胴体の後端（ノズルの付け根）の割合 */
export function fuselageEnd(shape: Readonly<AircraftShape>): number {
  return shape.engines === 4 ? 1 : 1 - NOZZLE_PROTRUDE / shape.length;
}

export function addFuselage(
  acc: MeshAccumulator,
  shape: Readonly<AircraftShape>,
  stations: number,
  radial: number,
  body: Rgb,
): void {
  const end = fuselageEnd(shape);
  const rings: Ring[] = [];
  const radome = AIRCRAFT_MODEL_CONFIG.colors.radomeShade;
  for (let i = 0; i <= stations; i++) {
    // 機首の先端に断面を寄せる
    const s = end * (1 - Math.cos((Math.PI / 2) * (i / stations)) ** 1.2);
    const sec = fuselageSection(shape, s);
    const color: Rgb =
      s < shape.noseFraction * 0.7 ? [body[0] * radome, body[1] * radome, body[2] * radome] : body;
    rings.push({ cx: 0, z: stationZ(shape, s), color, s, ...sec });
  }
  // 後端のふた（ノズルの奥。暗い色）
  const last = rings[rings.length - 1];
  if (last) {
    const dark = rgbOf(AIRCRAFT_MODEL_CONFIG.colors.nozzle);
    const n: [number, number, number] = [0, 0, 1];
    rings.push({ ...last, color: dark, seam: true, normal: n });
    rings.push({ ...last, a: 0, top: 0, bottom: 0, color: dark, normal: n });
  }
  loft(acc, rings, radial, fuselageUv, PART.none);
}

function rgbOf(hex: number): Rgb {
  const v = ((hex >> 16) & 255) / 255;
  // 暗い色だけなのでガンマはおおよそ 2.2 で戻す
  const g = (c: number): number => c ** 2.2;
  return [g(v), g(((hex >> 8) & 255) / 255), g((hex & 255) / 255)];
}

/** キャノピー: 上半分の楕円体を後ろへ引き伸ばした涙滴形。胴体の上面に少し沈める */
export function addCanopy(
  acc: MeshAccumulator,
  shape: Readonly<AircraftShape>,
  segments: readonly [number, number],
  color: Rgb,
  uv: UvFn,
): void {
  const c = shape.cockpit;
  const sec = fuselageSection(shape, c.position);
  const baseY = sec.cy + sec.top - 0.06;
  const zc = stationZ(shape, c.position);
  const g = new SphereGeometry(1, segments[0], segments[1], 0, Math.PI * 2, 0, Math.PI / 2);
  acc.addGeometry(
    g,
    color,
    PART.none,
    uv,
    (v) => {
      const back = v.z > 0 ? 1.35 : 0.85;
      v.set((v.x * c.width) / 2, baseY + v.y * c.height, zc + (v.z * c.length * back) / 2);
    },
    (n) => {
      n.set(n.x / c.width, n.y / c.height, n.z / c.length);
    },
  );
}

/** ダクト（インテーク・ナセル）の断面 */
function duct(
  cx: number,
  cy: number,
  z: number,
  a: number,
  h: number,
  n: number,
  color: Rgb,
  extra: Partial<Ring> = {},
): Ring {
  return { cx, cy, z, a, top: h, bottom: h, n, color, ...extra };
}

/** 左右のエアインテーク（コックピットの後ろの胴体の横。入口は開いていて奥は暗い） */
export function addIntakes(
  acc: MeshAccumulator,
  shape: Readonly<AircraftShape>,
  radial: number,
  body: Rgb,
): void {
  const dark = rgbOf(AIRCRAFT_MODEL_CONFIG.colors.duct);
  const W = shape.fuselageWidth / 2;
  const H = shape.fuselageHeight / 2;
  // 入口はキャノピーの後端の少し後ろ、主翼の付け根の後ろで胴体に溶け込む
  const s0 = shape.cockpit.position + (0.5 * shape.cockpit.length) / shape.length + 0.02;
  const s1 = shape.wing.position + 0.14;
  const z0 = stationZ(shape, s0);
  const z1 = stationZ(shape, s1);
  const f0 = fuselageSection(shape, s0);
  const f1 = fuselageSection(shape, s1);
  const a = W * 0.34;
  const h = H * 0.52;
  const cy = -H * 0.12;
  const n = 3.4;
  const rake = -0.45;
  const lip = 0.05;
  const uv: LoftUv = (_s, t, _x, _y, z) => [(z - stationZ(shape, 0)) / shape.length, 0.5 * t];
  for (const side of [-1, 1]) {
    // 胴体の横に半分ほど埋める
    const cx = side * (f0.a * 0.92 + a * 0.55);
    const r = { rake, s: 0 };
    const nIn: [number, number, number] = [0, 0, -1];
    const rings: Ring[] = [
      duct(cx, cy, z0 + 1.2, 0, 0, n, dark, { ...r, normal: nIn }),
      duct(cx, cy, z0 + 1.2, a - lip, h - lip, n, dark, { ...r, normal: nIn }),
      duct(cx, cy, z0 + 1.2, a - lip, h - lip, n, dark, { ...r, seam: true }),
      duct(cx, cy, z0 + 0.1, a - lip, h - lip, n, dark, r),
      duct(cx, cy, z0, a - lip * 0.5, h - lip * 0.5, n, body, r),
      duct(cx, cy, z0 - 0.02, a - lip * 0.25, h - lip * 0.25, n, body, r),
      duct(cx, cy, z0 + 0.03, a, h, n, body, r),
      duct(cx, cy, z0 + 0.5, a, h, n, body, r),
      duct(side * (f1.a * 0.85 + a * 0.3), cy, mix(z0, z1, 0.6), a * 0.8, h * 0.85, n, body, r),
      duct(side * f1.a * 0.6, cy, z1, a * 0.4, h * 0.5, n, body, r),
    ];
    loft(acc, rings, radial, uv, PART.none);
  }
}

/** ノズルの中心（胴体の後端。双発は左右に並べる）と半径。アフターバーナーの炎もここから出す */
export interface NozzleSpot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

export function nozzleSpots(shape: Readonly<AircraftShape>): NozzleSpot[] {
  const r = shape.nozzleRadius;
  const zTip = stationZ(shape, 1);
  if (shape.engines === 4) {
    // 主翼の下のナセルの後端
    return nacelleSpots(shape).map((n) => ({ x: n.x, y: n.y, z: n.z + n.length, radius: r * 0.8 }));
  }
  const sec = fuselageSection(shape, 1);
  const xs = shape.engines === 2 ? [-r * 1.05, r * 1.05] : [0];
  return xs.map((x) => ({ x, y: sec.cy, z: zTip, radius: r }));
}

/** ノズル（外側 → 縁 → 内側 → 奥のふた） */
export function addNozzles(
  acc: MeshAccumulator,
  shape: Readonly<AircraftShape>,
  radial: number,
): void {
  if (shape.engines === 4) return;
  const metal = rgbOf(AIRCRAFT_MODEL_CONFIG.colors.nozzle);
  const dark = rgbOf(AIRCRAFT_MODEL_CONFIG.colors.duct);
  const back: [number, number, number] = [0, 0, 1];
  for (const n of nozzleSpots(shape)) {
    const r = n.radius;
    const z = n.z;
    const p = NOZZLE_PROTRUDE;
    const rings: Ring[] = [
      duct(n.x, n.y, z - p - 0.5, r, r, 2, metal, { s: 0.95 }),
      duct(n.x, n.y, z - p * 0.6, r, r, 2, metal, { s: 0.97 }),
      duct(n.x, n.y, z, r * 0.88, r * 0.88, 2, metal, { s: 1 }),
      duct(n.x, n.y, z, r * 0.8, r * 0.8, 2, metal, { s: 1 }),
      duct(n.x, n.y, z - 0.08, r * 0.76, r * 0.76, 2, dark, { s: 1 }),
      duct(n.x, n.y, z - 0.9, r * 0.7, r * 0.7, 2, dark, { s: 1 }),
      duct(n.x, n.y, z - 0.9, r * 0.7, r * 0.7, 2, dark, { s: 1, seam: true, normal: back }),
      duct(n.x, n.y, z - 0.9, 0, 0, 2, dark, { s: 1, normal: back }),
    ];
    loft(acc, rings, radial, fuselageUv, PART.none);
  }
}

/** 輸送機のナセル: 前端の中心と長さ（主翼の下、翼幅の 33% と 62%） */
export function nacelleSpots(
  shape: Readonly<AircraftShape>,
): { x: number; y: number; z: number; length: number }[] {
  const out: { x: number; y: number; z: number; length: number }[] = [];
  for (const u of [0.33, 0.62]) {
    const sec = wingSection(shape, shape.wing, u);
    const y = sec.y - shape.nozzleRadius * 1.6;
    const z = sec.z - 1.7;
    out.push({ x: -sec.x, y, z, length: 4.2 }, { x: sec.x, y, z, length: 4.2 });
  }
  return out;
}

/** 輸送機のエンジンナセル（入口は開いて奥は暗い・後ろは排気口）。UV は汚れのないアトラスの右下 */
export function addNacelles(
  acc: MeshAccumulator,
  shape: Readonly<AircraftShape>,
  radial: number,
  body: Rgb,
): void {
  if (shape.engines !== 4) return;
  const dark = rgbOf(AIRCRAFT_MODEL_CONFIG.colors.duct);
  const metal = rgbOf(AIRCRAFT_MODEL_CONFIG.colors.nozzle);
  const r = shape.nozzleRadius;
  const front: [number, number, number] = [0, 0, -1];
  const back: [number, number, number] = [0, 0, 1];
  const uv: LoftUv = (s, t) => [0.55 + 0.4 * s, 0.76 + 0.2 * t];
  for (const n of nacelleSpots(shape)) {
    const z = n.z;
    const e = z + n.length;
    const rings: Ring[] = [
      duct(n.x, n.y, z + 0.5, 0, 0, 2, dark, { s: 0, normal: front }),
      duct(n.x, n.y, z + 0.5, r * 0.8, r * 0.8, 2, dark, { s: 0, normal: front }),
      duct(n.x, n.y, z + 0.5, r * 0.8, r * 0.8, 2, dark, { s: 0, seam: true }),
      duct(n.x, n.y, z + 0.05, r * 0.82, r * 0.82, 2, body, { s: 0 }),
      duct(n.x, n.y, z - 0.03, r * 0.92, r * 0.92, 2, body, { s: 0 }),
      duct(n.x, n.y, z + 0.08, r, r, 2, body, { s: 0.05 }),
      duct(n.x, n.y, z + n.length * 0.45, r * 1.04, r * 1.04, 2, body, { s: 0.5 }),
      duct(n.x, n.y, e - 0.3, r * 0.86, r * 0.86, 2, metal, { s: 0.9 }),
      duct(n.x, n.y, e, r * 0.8, r * 0.8, 2, metal, { s: 1 }),
      duct(n.x, n.y, e - 0.05, r * 0.7, r * 0.7, 2, dark, { s: 1 }),
      duct(n.x, n.y, e - 0.6, r * 0.62, r * 0.62, 2, dark, { s: 1 }),
      duct(n.x, n.y, e - 0.6, r * 0.62, r * 0.62, 2, dark, { s: 1, seam: true, normal: back }),
      duct(n.x, n.y, e - 0.6, 0, 0, 2, dark, { s: 1, normal: back }),
    ];
    loft(acc, rings, radial, uv, PART.none);
  }
}
