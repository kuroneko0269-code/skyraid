// 無誘導兵器（2-6）の数値: ロケット・爆弾・着弾予測点。ロジックは src/combat/rocket.ts / bomb.ts、
// 描画は src/render/ordnance-view.ts。距離は m、時間は秒、速度は m/s
import type { BlastSpec } from './ground-targets';

export const ROCKET_CONFIG = {
  /** 搭載数。1 回に 2 発（左右）同時に撃つので 6 斉射 */
  ammo: 12,
  perSalvo: 2,
  /** 斉射の間隔 */
  fireInterval: 0.3,
  /** 機体に対する初速。撃った機体の速度に足す（巡航で 600 m/s） */
  muzzleSpeed: 350,
  gravity: 9.8,
  /** ばらつき（度。機首方向からの最大のずれ）。1000m 先で約 7m */
  spreadDeg: 0.4,
  /** 発射位置（機体ローカル。左右の翼下、ミサイルの外側）。x は左右で符号を変える */
  launchOffset: { x: 3.4, y: -0.5, z: -0.5 },
  /** 寿命（約 3.6km） */
  life: 6,
  /** 起爆（対象・地面）で表面から radius 以内の敵側の対象に maxDamage（距離で減らさない） */
  blast: { radius: 5, maxDamage: 60, edgeFraction: 1 } satisfies BlastSpec,
  maxRockets: 24,
} as const;

export const BOMB_CONFIG = {
  ammo: 4,
  /** 投下の間隔 */
  dropInterval: 0.4,
  gravity: 9.8,
  /** 投下位置（機体ローカル。胴体の下） */
  releaseOffset: { x: 0, y: -1.2, z: 0 },
  /** 地面に着かないまま落ち続けたら消す時間 */
  life: 60,
  /** 表面から 40m 以内の敵側の対象すべてに 300（距離で減らさない。格納庫 HP 600 は 2 発） */
  blast: { radius: 40, maxDamage: 300, edgeFraction: 1 } satisfies BlastSpec,
  maxBombs: 8,
} as const;

/**
 * 着弾予測点（HUD の ○）。今の位置・速度で投下したときの放物線を step 秒刻みで地表と交差するまで進め、
 * 交差した区間を二分法で詰める。落下に maxSeconds 秒より長くかかる（高すぎる）なら出さない。
 * タッチ（AB 長押し）・パッド（RT 長押し）の投下は ○ が出ているときだけ（アフターバーナー・ヨーと兼ねるため）
 */
export const BOMB_PREDICTOR_CONFIG = {
  step: 0.25,
  bisections: 14,
  /** 約 15 秒 = 水平飛行で地表から約 1100m まで */
  maxSeconds: 15,
} as const;

/** タッチ・パッドの長押し（MSL 長押しで兵装の切替、AB・RT 長押しで爆弾の投下） */
export const WEAPON_INPUT_CONFIG = {
  holdSeconds: 0.4,
} as const;

/** ロケット・爆弾の見た目（InstancedMesh 1 つに両方を描く） */
export const ORDNANCE_VIEW_CONFIG = {
  rocket: { length: 2.2, width: 0.24, color: 0xc9ccd1 },
  bomb: { length: 2.4, width: 0.55, color: 0x4a5040 },
} as const;
