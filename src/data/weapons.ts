// 武装の数値（2-1: 機銃）。ロジックは src/combat/gun.ts / src/combat/heat.ts
// 距離は m、時間は秒、速度は m/s

export interface GunHeatSpec {
  /** 1 発で上がる熱（上限 1） */
  readonly perShot: number;
  /** 冷える速さ（1/秒） */
  readonly coolRate: number;
  /** 最後に撃ってから冷え始めるまでの時間 */
  readonly coolDelay: number;
  /** オーバーヒートが解除される熱 */
  readonly recoverBelow: number;
}

export interface GunSpec {
  /** 連射速度（発/秒） */
  readonly fireRate: number;
  /** 機体に対する弾の初速。撃った機体の速度に足す */
  readonly muzzleSpeed: number;
  /** 弾が消えるまでに飛ぶ距離（ワールドでの移動距離） */
  readonly range: number;
  /** 弾にかかる重力（m/s²） */
  readonly gravity: number;
  /** 1 発のダメージ */
  readonly damage: number;
  /** 弾のばらつき（度。機首方向からの最大のずれ） */
  readonly spreadDeg: number;
  /** 銃口の位置（機体ローカル。前方 -Z・上 +Y・右 +X） */
  readonly muzzleOffset: { readonly x: number; readonly y: number; readonly z: number };
  /** 同時に飛べる弾の上限（プールの大きさ）。満杯のときは撃っても弾が出ない */
  readonly maxBullets: number;
  readonly heat: GunHeatSpec;
}

/**
 * 初期機の機銃。
 * - 15 発/秒 × 4 秒（60 発）撃ち続けるとオーバーヒート。1.25 秒冷えると（熱 0.5）また撃てる
 * - 初速 900 + 機速（巡航 250）で約 1150 m/s。射程 1500m を約 1.3 秒で飛び、その間に約 8m 落ちる
 * - 的（HP 120）は 12 発で落ちる。連射で 0.8 秒、外れを含めて 2〜3 秒
 */
export const GUN_CONFIG: GunSpec = {
  fireRate: 15,
  muzzleSpeed: 900,
  range: 1500,
  gravity: 9.8,
  damage: 10,
  spreadDeg: 0.3,
  // 機首の先端（胴体 9m の半分 + 機首 3.5m）より少し後ろ・下
  muzzleOffset: { x: 0, y: -0.3, z: -7.5 },
  maxBullets: 256,
  heat: {
    perShot: 1 / 60,
    coolRate: 0.4,
    coolDelay: 0.3,
    recoverBelow: 0.5,
  },
};
