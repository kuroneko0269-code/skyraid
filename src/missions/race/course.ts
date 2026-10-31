// リングレース（7-1）のコース: 定義 → 判定用のリング、コースの保証条件の計算（Three.js 非依存）。
// 保証条件（tests/race-course.test.ts）: リングは地表 30m 以上・前のリングから見える・連続リング間の必要旋回率が最大旋回の 80% 以下
import { AIRCRAFT_MODELS, type AircraftSpec } from '../../data/aircraft';
import { RACE_CONFIG } from '../../data/race';
import { RING_CONFIG } from '../../data/rings';
import { turnFactor } from '../../flight/flight-model';
import { vec3, type Vec3 } from '../../flight/math';
import { resolveLoadout } from '../../progression/loadout';
import { initialUpgrades } from '../../progression/save';
import { createRing, type Ring } from '../objectives/ring';
import type { CourseDef, CourseRingDef, RingKind } from './types';

const DEG = Math.PI / 180;

/** 判定・描画に使うリング（2-4 のリングに種類・見た目の半径・番号を足したもの） */
export interface RaceRing extends Ring {
  readonly index: number;
  readonly kind: RingKind;
  /** 見た目の半径（m） */
  readonly radius: number;
  /** 飛ばせないリング（チェックポイントとゴール） */
  readonly required: boolean;
}

/** 見た目の半径（細いリングは半分） */
export function ringRadius(def: CourseRingDef): number {
  const base = def.radius ?? RING_CONFIG.radius;
  return def.kind === 'thin' ? base * RACE_CONFIG.thinRadiusScale : base;
}

export function buildRaceRings(course: CourseDef): RaceRing[] {
  const last = course.rings.length - 1;
  return course.rings.map((def, index) => {
    const radius = ringRadius(def);
    return {
      ...createRing(def, radius * RACE_CONFIG.passRadiusScale),
      index,
      kind: def.kind,
      radius,
      required: def.kind === 'checkpoint' || index === last,
    };
  });
}

/** 方位・上向きの角度（度）→ 単位ベクトル（リングの法線と同じ式） */
export function directionOf(headingDeg: number, pitchDeg: number, out: Vec3 = vec3()): Vec3 {
  const h = headingDeg * DEG;
  const p = pitchDeg * DEG;
  out.x = Math.sin(h) * Math.cos(p);
  out.y = Math.sin(p);
  out.z = -Math.cos(h) * Math.cos(p);
  return out;
}

/** 単位ベクトル → 方位・上向きの角度（度。真上・真下では方位 0） */
export function anglesOf(d: Readonly<Vec3>): { headingDeg: number; pitchDeg: number } {
  const horizontal = Math.hypot(d.x, d.z);
  const pitchDeg = Math.atan2(d.y, horizontal) / DEG;
  const headingDeg = horizontal < 1e-9 ? 0 : Math.atan2(d.x, -d.z) / DEG;
  return { headingDeg, pitchDeg };
}

function angleBetween(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  const len = Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z);
  if (len < 1e-12) return 0;
  return Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / len)));
}

/**
 * リング a からリング b へ飛ぶのに要る旋回の角度（rad）と距離（m）。
 * 角度 = a の法線 → a から b への向き + その向き → b の法線（a を向きどおりに抜け、b を向きどおりに抜けるまでに回る量）
 */
export function legTurn(
  a: { readonly position: Readonly<Vec3>; readonly normal: Readonly<Vec3> },
  b: { readonly position: Readonly<Vec3>; readonly normal: Readonly<Vec3> },
): { angle: number; distance: number } {
  const d = {
    x: b.position.x - a.position.x,
    y: b.position.y - a.position.y,
    z: b.position.z - a.position.z,
  };
  const distance = Math.hypot(d.x, d.y, d.z);
  return { angle: angleBetween(a.normal, d) + angleBetween(d, b.normal), distance };
}

/**
 * 区間を機体の最高速（スロットル全開・アフターバーナーなし）で飛ぶときの必要旋回率と、その速度での最大ピッチ角速度（度/秒）。
 * 必要旋回率 = 旋回の角度 ÷ (距離 ÷ 速度)
 */
export function legTurnRate(
  angle: number,
  distance: number,
  spec: AircraftSpec,
): { required: number; max: number } {
  const speed = spec.speed.military;
  const required = distance > 0 ? ((angle / DEG) * speed) / distance : Infinity;
  const max = spec.rates.pitch * turnFactor(spec.turnCurve, speed);
  return { required, max };
}

/** 保証条件の旋回で比べる機体（全機体の未強化） */
export function referenceSpecs(): AircraftSpec[] {
  return AIRCRAFT_MODELS.map((m) => resolveLoadout(m, initialUpgrades()).flight);
}

/** 開始位置を「リング -1」として扱う（1 個目のリングの見える・旋回の判定に使う） */
export function startAsRing(course: CourseDef): { position: Vec3; normal: Vec3 } {
  const s = course.start;
  return { position: vec3(s.x, s.y, s.z), normal: directionOf(s.headingDeg, 0) };
}

/**
 * 線分 a → b の上を step m ごとに見て、地表（と建物の屋根）からの高さの最小（m）。
 * 見える（遮るものがない）の判定に使う。groundTop は地表と立っている建物の屋根の高い方
 */
export function minClearance(
  a: Readonly<Vec3>,
  b: Readonly<Vec3>,
  groundTop: (x: number, z: number) => number,
  step = 10,
): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const n = Math.max(1, Math.ceil(len / step));
  let min = Infinity;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const y = a.y + (b.y - a.y) * t;
    min = Math.min(min, y - groundTop(x, z));
  }
  return min;
}
