// 地上目標（2-6）の数値: 種類ごとの HP・当たり判定・見た目の部品、燃料タンクの誘爆、対空砲の射撃、黒煙。
// ロジックは src/entities/ground-target.ts / src/combat/aaa.ts、描画は src/render/ground-target-view.ts。
// 距離は m、時間は秒、速度は m/s。見た目はプリミティブ（箱・円柱）の組み合わせのプレースホルダー
import type { Difficulty } from './ai';

export const GROUND_TARGET_TYPES = ['radar', 'fuelTank', 'hangar', 'aaa', 'command'] as const;
export type GroundTargetType = (typeof GROUND_TARGET_TYPES)[number];

/**
 * 見た目の部品 1 つ。box は幅・高さ・奥行き、cylinder は直径・高さ・直径（横倒しは axis）。
 * offset は部品の中心（目標の足元 = 地表が原点、前方 -Z）。
 * role: turret は対空砲の砲塔（方位だけ自機を向く）、barrel は砲身（方位 + 仰角。根元が offset）、dish はレーダーの回転部
 */
export interface GroundTargetPart {
  readonly shape: 'box' | 'cylinder';
  readonly size: { readonly x: number; readonly y: number; readonly z: number };
  readonly offset: { readonly x: number; readonly y: number; readonly z: number };
  readonly color: number;
  readonly role?: 'turret' | 'barrel' | 'dish';
  /** 円柱の軸の向き（既定 y = 縦）。x なら横倒しで、size.x が長さ、size.y・size.z が直径 */
  readonly axis?: 'x' | 'y';
}

export interface GroundTargetSpec {
  readonly maxHp: number;
  /** 当たり判定の球の半径と、その中心の地表からの高さ */
  readonly hitRadius: number;
  readonly centerHeight: number;
  /** 破片を散らす半径 */
  readonly visualRadius: number;
  /** 接地を調べる足元の半径（四隅と中心の地表の最も低い所に立てる） */
  readonly footprint: number;
  readonly parts: readonly GroundTargetPart[];
}

/** 範囲ダメージ: 中心 maxDamage から半径 radius の縁で maxDamage × edgeFraction、外は 0（距離は対象の表面まで） */
export interface BlastSpec {
  readonly radius: number;
  readonly maxDamage: number;
  readonly edgeFraction: number;
}

/** 地面に埋める深さ（斜面で浮かないよう、いちばん下の部品を地表の最も低い所からさらに下へ伸ばす） */
const SINK = 3;

export const GROUND_TARGET_SPECS: Readonly<Record<GroundTargetType, GroundTargetSpec>> = {
  /** レーダー: 台座 + 柱 + 回るアンテナ。HP 300（機銃 30 発・ロケット 5 発・爆弾 1 発） */
  radar: {
    maxHp: 300,
    hitRadius: 13,
    centerHeight: 9,
    visualRadius: 12,
    footprint: 8,
    parts: [
      {
        shape: 'box',
        size: { x: 16, y: 6 + SINK, z: 16 },
        offset: { x: 0, y: (6 - SINK) / 2, z: 0 },
        color: 0x8a8f86,
      },
      {
        shape: 'cylinder',
        size: { x: 2.4, y: 14, z: 2.4 },
        offset: { x: 0, y: 13, z: 0 },
        color: 0x6d726b,
      },
      {
        shape: 'box',
        size: { x: 16, y: 7, z: 1.2 },
        offset: { x: 0, y: 22, z: 0 },
        color: 0xd7dbd3,
        role: 'dish',
      },
    ],
  },
  /** 燃料タンク: 円筒 + 台座。HP 200。壊れると周囲 60m に範囲ダメージ（FUEL_TANK_BLAST） */
  fuelTank: {
    maxHp: 200,
    hitRadius: 14,
    centerHeight: 8,
    visualRadius: 13,
    footprint: 12,
    parts: [
      {
        shape: 'box',
        size: { x: 28, y: 2 + SINK, z: 28 },
        offset: { x: 0, y: (2 - SINK) / 2, z: 0 },
        color: 0x77786f,
      },
      {
        shape: 'cylinder',
        size: { x: 22, y: 14, z: 22 },
        offset: { x: 0, y: 9, z: 0 },
        color: 0xc9c2a8,
      },
      {
        shape: 'cylinder',
        size: { x: 14, y: 1.6, z: 14 },
        offset: { x: 0, y: 16.8, z: 0 },
        color: 0xa39b80,
      },
    ],
  },
  /** 格納庫: 箱 + かまぼこ屋根（横にした円柱を箱に半分埋める）。HP 600（爆弾 2 発） */
  hangar: {
    maxHp: 600,
    hitRadius: 24,
    centerHeight: 9,
    visualRadius: 20,
    footprint: 20,
    parts: [
      {
        shape: 'box',
        size: { x: 40, y: 10 + SINK, z: 30 },
        offset: { x: 0, y: (10 - SINK) / 2, z: 0 },
        color: 0x7b8174,
      },
      {
        shape: 'cylinder',
        axis: 'x',
        size: { x: 40, y: 16, z: 30 },
        offset: { x: 0, y: 10, z: 0 },
        color: 0x6a7263,
      },
      {
        shape: 'box',
        size: { x: 26, y: 8, z: 0.6 },
        offset: { x: 0, y: 4, z: -15.1 },
        color: 0x3b3e38,
      },
    ],
  },
  /** 対空砲: 台座 + 砲塔 + 2 本の砲身（自機を向く）。HP 250 */
  aaa: {
    maxHp: 250,
    hitRadius: 9,
    centerHeight: 4,
    visualRadius: 8,
    footprint: 6,
    parts: [
      {
        shape: 'box',
        size: { x: 10, y: 2 + SINK, z: 10 },
        offset: { x: 0, y: (2 - SINK) / 2, z: 0 },
        color: 0x6f7563,
      },
      {
        shape: 'cylinder',
        size: { x: 6, y: 3, z: 6 },
        offset: { x: 0, y: 3.5, z: 0 },
        color: 0x59604d,
        role: 'turret',
      },
      {
        shape: 'box',
        size: { x: 0.5, y: 0.5, z: 7 },
        offset: { x: -0.9, y: 4.6, z: 0 },
        color: 0x2f322b,
        role: 'barrel',
      },
      {
        shape: 'box',
        size: { x: 0.5, y: 0.5, z: 7 },
        offset: { x: 0.9, y: 4.6, z: 0 },
        color: 0x2f322b,
        role: 'barrel',
      },
    ],
  },
  /**
   * 司令部（7-2 の防衛戦の防衛対象）: 低い箱の建物 + 管制塔 + 屋上のアンテナ。HP 2000（高難度は防衛戦の側で 1500 に）。
   * 防衛戦では陣営を味方にして置く（プレイヤーの弾は当たらない）
   */
  command: {
    maxHp: 2000,
    hitRadius: 22,
    centerHeight: 10,
    visualRadius: 20,
    footprint: 18,
    parts: [
      {
        shape: 'box',
        size: { x: 36, y: 12 + SINK, z: 24 },
        offset: { x: 0, y: (12 - SINK) / 2, z: 0 },
        color: 0x8c9187,
      },
      {
        shape: 'box',
        size: { x: 10, y: 14, z: 10 },
        offset: { x: 10, y: 19, z: 0 },
        color: 0x9fa59a,
      },
      {
        shape: 'box',
        size: { x: 12, y: 3, z: 12 },
        offset: { x: 10, y: 27.5, z: 0 },
        color: 0x4b6a7a,
      },
      {
        shape: 'cylinder',
        size: { x: 0.8, y: 10, z: 0.8 },
        offset: { x: -10, y: 17, z: 4 },
        color: 0x5a5e57,
      },
    ],
  },
};

/** 燃料タンクが壊れたときの範囲ダメージ（陣営によらず、自機・ほかの地上目標にも入る） */
export const FUEL_TANK_BLAST: BlastSpec = {
  radius: 60,
  /** 中心 120（自機 HP 200 の 6 割）・縁 36。隣の燃料タンク（HP 200）は 20m 以内で 1 回では誘爆しない */
  maxDamage: 120,
  edgeFraction: 0.3,
};

export const GROUND_TARGET_CONFIG = {
  /** 同時に出せる数 */
  maxCount: 8,
  hitFlashSeconds: 0.08,
  /** レーダーのアンテナの回る速さ（rad/s。約 6 秒で 1 周） */
  dishTurnRate: 1.05,
  /** 壊れた後に黒煙を出す時間 */
  smokeSeconds: 30,
} as const;

/**
 * 対空砲（AAA）。600〜2500m の自機を予測射撃する。2 秒ごとに 5 発のバースト、その 1 秒前から HUD に「AAA」。
 * 1 発ごとに難易度の命中率（hitChance）で「予測位置へ正確に」か「予測位置から missMin〜missMax ずらす」かを決める
 * （ずらした弾は当たらない。正確な弾も自機が旋回すれば外れる）
 */
export const AAA_CONFIG = {
  minRange: 600,
  maxRange: 2500,
  shellSpeed: 600,
  damage: 8,
  gravity: 9.8,
  /** バーストの始まりの間隔・1 回の弾数・弾の間隔（5 発で 0.32 秒） */
  burstInterval: 2,
  burstShots: 5,
  shotSpacing: 0.08,
  /** 撃つ前に警告を出す時間。範囲に入ってから最初のバーストまでもこの時間 */
  warnSeconds: 1,
  hitChance: { rookie: 0.1, easy: 0.15, normal: 0.3, hard: 0.45 } satisfies Record<
    Difficulty,
    number
  >,
  /** 外す弾のずらし幅（予測位置での距離）。自機の当たり判定 6m より十分大きく、曳光弾が近くを抜けて見える */
  missMin: 18,
  missMax: 45,
  /**
   * 予測に使う自機の加速度（速度の変化）をなめらかにする時定数と上限（m/s²）。
   * 等速直線なら 0 で、予測は速度だけになる
   */
  accelSmoothing: 0.3,
  accelLimit: 150,
  /**
   * 弾が消えるまでの距離。撃つのは 2500m 以内の自機だが、遠ざかる自機に追いつくまで 7 秒近く飛ぶことがある
   * （2500m 先を 250 m/s で遠ざかると約 3.7km）。3000m では遠ざかる自機への弾が届く前に消えていた
   */
  range: 4500,
  /** 同時に飛ぶ弾の上限（1 門で約 12 発） */
  maxShells: 96,
  /** 曳光弾の色（黄色） */
  tracerColor: 0xffd23a,
} as const;

/** 壊れた地上目標の黒煙（パーティクル、InstancedMesh 1 つ） */
export const GROUND_SMOKE_CONFIG = {
  max: 320,
  /** 1 つの残骸から煙の玉を出す間隔 */
  interval: 0.25,
  /** 玉の寿命・上がる速さ・風で流れる速さ */
  life: 8,
  riseSpeed: 7,
  driftSpeed: 4,
  /** 大きさ（直径）。出た直後 → 寿命の終わり、最後の fadeFraction で縮んで消える */
  startSize: 7,
  endSize: 34,
  fadeFraction: 0.25,
  color: 0x171513,
  opacity: 0.6,
} as const;

/** 壊れた後の残骸: 部品の高さをこの割合にし、色をこの割合に暗くする（砲身・アンテナは消す） */
export const GROUND_WRECK_CONFIG = {
  heightScale: 0.3,
  colorScale: 0.22,
} as const;
