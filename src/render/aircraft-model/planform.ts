// 機体モデル（4-3）の配置の計算（Three.js 非依存）: 翼の断面の位置、操舵面の角度、パイロンの並び、G。
// 座標は機体のローカル（前方 -Z・上 +Y・右 +X、原点は機体の位置）
import type { AircraftShape, WingShape } from '../../data/aircraft-shapes';
import { AIRCRAFT_MODEL_CONFIG } from '../../data/aircraft-model';

const DEG = Math.PI / 180;

/** 頂点の部品の番号（シェーダーで動かす・消す）。100 + n はミサイルの n 番（1 始まり） */
export const PART = {
  none: 0,
  aileronLeft: 1,
  aileronRight: 2,
  stabilizerLeft: 3,
  stabilizerRight: 4,
  rudderLeft: 5,
  rudderRight: 6,
} as const;
export const MISSILE_PART_BASE = 100;
/** 操舵面の数（シェーダーの uniform の配列の長さ） */
export const SURFACE_COUNT = 6;

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** 機首からの全長に対する割合 s の z（機首 s = 0 が -Z 側） */
export function stationZ(shape: Readonly<AircraftShape>, s: number): number {
  return (s - shape.originFraction) * shape.length;
}

/** 主翼・水平尾翼の付け根（胴体の中に埋める）の横の位置 */
export function wingRootX(shape: Readonly<AircraftShape>): number {
  return shape.fuselageWidth * 0.3;
}

/** 翼の断面: 前縁の位置（右側。左は x を反転）と翼弦 */
export interface WingSection {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly chord: number;
}

/**
 * 主翼・水平尾翼の翼幅の割合 u（0 = 胴体の中心線、1 = 翼端）の断面。翼弦は付け根から翼端へ直線で細くなり、
 * 前縁は後退角で後ろへ、上反角で上へずれる
 */
export function wingSection(
  shape: Readonly<AircraftShape>,
  w: Readonly<WingShape>,
  u: number,
): WingSection {
  const x = (u * w.span) / 2;
  return {
    x,
    y: (w.height * shape.fuselageHeight) / 2 + x * Math.tan(w.dihedralDeg * DEG),
    z: stationZ(shape, w.position) + x * Math.tan(w.sweepDeg * DEG),
    chord: w.rootChord + (w.tipChord - w.rootChord) * u,
  };
}

/** 垂直尾翼の付け根の横の位置（双垂直尾翼は左右へ。右側の値） */
export function finRootX(shape: Readonly<AircraftShape>): number {
  return shape.tail === 'twin' ? shape.fuselageWidth * 0.3 : 0;
}

/**
 * 垂直尾翼の高さの割合 u の断面（右側。双垂直尾翼は外へ dihedralDeg だけ傾く）。
 * 戻り値の x は横、y は高さ
 */
export function finSection(shape: Readonly<AircraftShape>, u: number): WingSection {
  const f = shape.fin;
  const h = u * f.span;
  const cant = f.dihedralDeg * DEG;
  return {
    x: finRootX(shape) + h * Math.sin(cant),
    y: (f.height * shape.fuselageHeight) / 2 + h * Math.cos(cant),
    z: stationZ(shape, f.position) + h * Math.tan(f.sweepDeg * DEG),
    chord: f.rootChord + (f.tipChord - f.rootChord) * u,
  };
}

/** 操舵面の角度（rad）。水平の面は後縁が下がる向き、ラダーは後縁が右へ動く向きが正 */
export interface SurfaceAngles {
  aileronLeft: number;
  aileronRight: number;
  elevator: number;
  rudder: number;
}

/**
 * 操作（ピッチ +1 = 機首上げ、ロール +1 = 右、ヨー +1 = 機首右）に比例した操舵面の角度。入力 ±1 で ±maxDeg。
 * 右ロールは右のエルロンが上がり左が下がる、機首上げは水平尾翼の後縁が上がる、機首右はラダーの後縁が右へ
 */
export function controlSurfaceAngles(
  pitch: number,
  roll: number,
  yaw: number,
  out: SurfaceAngles,
  maxDeg: number = AIRCRAFT_MODEL_CONFIG.surfaces.maxDeflectionDeg,
): SurfaceAngles {
  const max = maxDeg * DEG;
  const r = clamp1(roll) * max;
  out.aileronLeft = r;
  out.aileronRight = -r;
  out.elevator = -clamp1(pitch) * max;
  out.rudder = clamp1(yaw) * max;
  return out;
}

function clamp1(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/** パイロン 1 つ: ミサイルの中心の位置と番号（1 始まり。残りの数がこの番号以上なら見える） */
export interface PylonSpot {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly slot: number;
  /** 翼端のレール（翼の横に付ける）か、翼・胴体の下に吊るすか */
  readonly kind: 'tip' | 'wing' | 'center';
}

/**
 * パイロンの並び: 翼端から内側へ左右 1 組ずつ（間隔は最大 spacing、主翼の innerLimit より内へは行かない）、
 * 奇数なら残りの 1 発を胴体の下に。番号は翼端の組が 1・2、内側へ 3・4…、胴体の下が最後（最初に撃つ）
 */
export function pylonLayout(shape: Readonly<AircraftShape>, count: number): PylonSpot[] {
  const m = AIRCRAFT_MODEL_CONFIG.missile;
  const spots: PylonSpot[] = [];
  const n = Math.max(0, Math.floor(count));
  const pairs = Math.floor(n / 2);
  const w = shape.wing;
  const half = w.span / 2;
  const step = pairs > 1 ? Math.min(m.spacing / half, (1 - m.innerLimit) / (pairs - 1)) : 0;
  for (let k = 0; k < pairs; k++) {
    const u = 1 - k * step;
    const sec = wingSection(shape, w, u);
    const tip = k === 0;
    // 翼端は翼の横、それ以外は翼の下。前後は翼弦の中ほどにミサイルの中心
    const x = tip ? sec.x + m.radius * 1.6 : sec.x;
    const y = tip ? sec.y : sec.y - sec.chord * w.thickness * 0.5 - 0.32;
    const z = sec.z + sec.chord * 0.55;
    spots.push({ x: -x, y, z, slot: 2 * k + 1, kind: tip ? 'tip' : 'wing' });
    spots.push({ x, y, z, slot: 2 * k + 2, kind: tip ? 'tip' : 'wing' });
  }
  if (n % 2 === 1) {
    const sec = wingSection(shape, w, 0);
    spots.push({
      x: 0,
      y: -shape.fuselageHeight * 0.5 - 0.3,
      z: sec.z + sec.chord * 0.45,
      slot: n,
      kind: 'center',
    });
  }
  return spots;
}

/** 荷重倍数（G）: ピッチの角速度（rad/s）× 速度 ÷ 重力 + 1 */
export function loadFactor(pitchRate: number, speed: number, gravity = 9.8): number {
  return 1 + (Math.abs(pitchRate) * speed) / gravity;
}
