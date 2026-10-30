// ゲルストナー波（4-2。Three.js 非依存）。海面の頂点シェーダー（ocean-glsl.ts）と同じ式。
// 衝突判定には使わない（海面 = 高度 0 のまま）。テストと、将来の水しぶき等の位置合わせ用
import { OCEAN_CONFIG } from '../data/ocean';
import { WIND_CONFIG } from '../data/wind';
import type { Vec3 } from '../flight/math';

export interface GerstnerWave {
  /** 進む向き（水平の単位ベクトル） */
  readonly dirX: number;
  readonly dirZ: number;
  /** 波数 2π / 波長 */
  readonly k: number;
  /** 角振動数（深海の分散関係 √(g·k)） */
  readonly omega: number;
  /** 振幅（m） */
  readonly amplitude: number;
  /** 鋭さ Q·k·A。水平の寄りの振幅 = steepness / k */
  readonly steepness: number;
}

export interface WaveSpec {
  readonly angle: number;
  readonly wavelength: number;
  readonly amplitude: number;
  readonly steepness: number;
}

/** 設定（風向きからの差）から波を作る。風向きを変えると全部の波が一緒に回る */
export function buildGerstnerWaves(
  specs: readonly WaveSpec[] = OCEAN_CONFIG.waves,
  windDeg: number = WIND_CONFIG.direction,
  gravity: number = OCEAN_CONFIG.gravity,
): GerstnerWave[] {
  return specs.map((w) => {
    const a = ((windDeg + w.angle) * Math.PI) / 180;
    const k = (2 * Math.PI) / w.wavelength;
    return {
      dirX: Math.cos(a),
      dirZ: Math.sin(a),
      k,
      omega: Math.sqrt(gravity * k),
      amplitude: w.amplitude,
      steepness: w.steepness,
    };
  });
}

/**
 * 静かな海面の点 (x, 0, z) が時刻 t に動く量（m）を out に入れる。scale は浅瀬で波を小さくする倍率
 * （shoalFactor）。y が高さ
 */
export function gerstnerDisplacement(
  waves: readonly GerstnerWave[],
  x: number,
  z: number,
  t: number,
  out: Vec3,
  scale = 1,
): Vec3 {
  out.x = 0;
  out.y = 0;
  out.z = 0;
  for (const w of waves) {
    const phase = w.k * (w.dirX * x + w.dirZ * z) - w.omega * t;
    const c = Math.cos(phase);
    const side = (w.steepness / w.k) * c * scale;
    out.x += w.dirX * side;
    out.z += w.dirZ * side;
    out.y += w.amplitude * Math.sin(phase) * scale;
  }
  return out;
}

const tmp: Vec3 = { x: 0, y: 0, z: 0 };

/** 静かな海面の点 (x, z) の時刻 t の高さ（m） */
export function gerstnerHeight(
  waves: readonly GerstnerWave[],
  x: number,
  z: number,
  t: number,
): number {
  return gerstnerDisplacement(waves, x, z, t, tmp).y;
}

/** 高さの上限（振幅の合計）。全部の波の山が重なったとき */
export function maxWaveHeight(waves: readonly GerstnerWave[]): number {
  return waves.reduce((sum, w) => sum + w.amplitude, 0);
}

/** 波の周期（秒） */
export function wavePeriod(wave: GerstnerWave): number {
  return (2 * Math.PI) / wave.omega;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 浅瀬で波を小さくする倍率（水深 minDepth 以下で 0、fullDepth 以上で 1） */
export function shoalFactor(depth: number, shoal = OCEAN_CONFIG.shoal): number {
  return smoothstep(shoal.minDepth, shoal.fullDepth, depth);
}

/**
 * さざ波（法線ノイズ）の距離による弱め（4-2b）。ocean-noise-glsl.ts の oceanRipples と同じ式
 */
export function rippleFalloff(
  dist: number,
  cfg: { halfDistance: number; exponent: number } = OCEAN_CONFIG.rippleFalloff,
): number {
  return 1 / (1 + Math.pow(Math.max(dist, 0) / cfg.halfDistance, cfg.exponent));
}
