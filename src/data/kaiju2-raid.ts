// 9-6b: ネフィルガのレイド（9-6c でソロ・協力とも公開）の数値: 体力・部位・難易度・制限時間・出し方・報酬の考え方。
// 動きと攻撃の数値は src/data/kaiju2.ts。進め方は src/missions/kaiju2-raid.ts（Three.js 非依存）。
// 体力と制限時間は tests/kaiju2-raid-bots.ts のボットと模擬の人で決めた（docs/kaiju2.md の「9-6b の調整」）
import type { RaidDifficulty } from './raid';
import type { Kaiju2Part } from './kaiju2';

/** 撃てる部位（胴は壊れない。翼・頭・尾は壊すと動きが変わる） */
export const KAIJU2_TARGETS = ['body', 'wingL', 'wingR', 'head', 'tail'] as const;
export type Kaiju2Target = (typeof KAIJU2_TARGETS)[number];

export interface Kaiju2TargetSpec {
  /** 判定の球の半径（ヴォルガスの部位 19〜38m と同じくらい） */
  readonly radius: number;
  /** 体の中心からの位置（体の向き: 右 +x・上 +y・前 −z。翼を広げたとき / たたんだとき） */
  readonly open: readonly [number, number, number];
  readonly folded: readonly [number, number, number];
  /** 部位 HP（全体 HP に対する割合。胴は 0 = 壊れない） */
  readonly hpShare: number;
  /** 受けるダメージの倍率（胴は硬い: 部位を壊すほうが早い） */
  readonly damageScale: number;
}

export const KAIJU2_RAID_CONFIG = {
  /** 全体 HP（ソロ・通常）。高難度は hard.hpScale 倍 */
  hp: 4200,
  targets: {
    body: { radius: 30, open: [0, 0, -5], folded: [0, 0, -5], hpShare: 0, damageScale: 0.6 },
    wingL: { radius: 32, open: [-62, 8, -12], folded: [-34, 10, 2], hpShare: 0.13, damageScale: 1 },
    wingR: { radius: 32, open: [62, 8, -12], folded: [34, 10, 2], hpShare: 0.13, damageScale: 1 },
    head: { radius: 20, open: [0, 11, -64], folded: [0, 11, -64], hpShare: 0.1, damageScale: 1 },
    tail: { radius: 22, open: [0, -2, 62], folded: [0, -2, 62], hpShare: 0.1, damageScale: 1 },
  } satisfies Record<Kaiju2Target, Kaiju2TargetSpec>,
  /** 止まり木の間（羽を休めている・降りる途中・飛び立つ途中）に受けるダメージの倍率（攻める隙） */
  perchedDamageScale: 1.25,
  /** 被弾で白く光る秒数 */
  flashSeconds: 0.08,
  /** 制限時間: 段階 3（嵐。体力 40% 以下）に入ってから・全体（嵐が街に着く）。秒 */
  finalSeconds: { normal: 270, hard: 240 } satisfies Record<RaidDifficulty, number>,
  totalSeconds: { normal: 720, hard: 600 } satisfies Record<RaidDifficulty, number>,
  /** 高難度: 体力の倍率・予兆の秒数の倍率・攻撃の間隔の倍率・当たりのダメージの倍率（ヴォルガスの高難度にならう） */
  hard: { hpScale: 1.55, windupScale: 0.8, intervalScale: 0.85, damageScale: 1.15 },
  /** 段階が変わったときに吠えて上がる秒数（攻撃しない） */
  phaseShoutSeconds: 2.2,
  /** 出し方: 開始位置の前方（湾の上）の距離と高さ、最初の攻撃までの秒数（ブリーフィングを読む間） */
  spawnAhead: 3000,
  spawnAltitude: 800,
  firstAttackDelay: 14,
  /** 撃破: 落ちる速さ（m/s）と、地面・海面に着いてから消えるまでの秒数 */
  fallSpeed: 90,
  vanishSeconds: 2,
  /** ブリーフィングを出す秒数（タップで閉じる） */
  briefingSeconds: 9,
  /**
   * 9-6c: 協力。hpScale は人数（1〜4 人）ごとの全体 HP の倍率（部位 HP も同じ割合）。人数が増えても 1 人より難しくならないよう、
   * 協力のボット（tests/kaiju2-coop-bots.ts）で人数ごとの中央値が 1 人以下になる値にした（docs/kaiju2.md の 9-6c）。
   * focusSeconds: 狙う人（いちばん近い人）を選び直す間隔（攻撃の途中では変えない）。focusKeep: 今の人がいちばん近い人の
   * この倍の距離までなら変えない
   */
  coop: {
    hpScale: [1, 1.85, 2.65, 3.5] as readonly number[],
    focusSeconds: 2,
    focusKeep: 1.25,
  },
} as const;

/** 部位の名前（壊れると動きが変わる部位）→ 撃てる部位 */
export function isBreakable(t: Kaiju2Target): t is Kaiju2Part {
  return t !== 'body';
}
