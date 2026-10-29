// 敵機 AI（2-3）の入出力の型と、小さなベクトル演算（Three.js 非依存）
import type { Quat, Vec3 } from '../flight/math';

export type AiState = 'patrol' | 'engage' | 'attack' | 'evade' | 'disengage';
export type Rng = () => number;

/** 自機の状態（飛行モデルの状態 + HP・地表からの高さ） */
export interface AiSelf {
  readonly position: Readonly<Vec3>;
  readonly orientation: Readonly<Quat>;
  readonly angularRate: Readonly<Vec3>;
  readonly speed: number;
  readonly afterburnerGauge: number;
  /** HP の割合（0〜1） */
  readonly hpRatio: number;
  /** 地表（海の上は海面）からの高さ（m）と上下の速さ（m/s） */
  readonly agl: number;
  readonly verticalSpeed: number;
}

/** 相手（プレイヤー） */
export interface AiTarget {
  readonly position: Readonly<Vec3>;
  readonly velocity: Readonly<Vec3>;
  readonly active: boolean;
}

/** 1 ステップ分の知覚。threat は自分を追っているミサイルのうち最も近いものの位置（なければ null） */
export interface AiSenses {
  readonly self: AiSelf;
  readonly target: AiTarget | null;
  readonly threat: Readonly<Vec3> | null;
  /** このステップに受けたダメージ */
  readonly damageTaken: number;
  /** 相手をロックできているか、ミサイル・フレアをいま使えるか */
  readonly locked: boolean;
  readonly missileReady: boolean;
  readonly flareReady: boolean;
}

/** AI の出力。throttle はスロットル位置（0〜1）。missile / flare はこのステップに撃つ・撒くなら true */
export interface AiCommand {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  afterburner: boolean;
  trigger: boolean;
  missile: boolean;
  flare: boolean;
}

export function createCommand(): AiCommand {
  return {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: 0.7,
    afterburner: false,
    trigger: false,
    missile: false,
    flare: false,
  };
}

export function sub(out: Vec3, a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

/** v を正規化して out に書く（長さ 0 なら -Z） */
export function unit(out: Vec3, v: Readonly<Vec3>): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len < 1e-9) {
    out.x = 0;
    out.y = 0;
    out.z = -1;
    return out;
  }
  out.x = v.x / len;
  out.y = v.y / len;
  out.z = v.z / len;
  return out;
}
