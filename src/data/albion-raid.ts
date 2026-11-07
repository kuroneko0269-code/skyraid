// 10-3b: 白鯨アルビオンのレイド（ソロ・協力）の数値: 体力の倍率・制限時間・高難度・出し方・撃破・協力の人数の補正。
// 動き・攻撃・部位・子分の数値は src/data/albion.ts。値は tests/albion-raid-bots.ts・tests/albion-coop-bots.ts のボットの表で決めた
// （docs/kaiju-roster.md の「10-3b」）。Three.js・DOM 非依存（起動時には読まない。遅延チャンク albion-runtime）
import type { RaidDifficulty } from './raid';

export const ALBION_RAID_CONFIG = {
  /** 制限時間（秒）。湾を渡り切って去る（失敗の理由は「時間切れ」） */
  totalSeconds: { normal: 1200, hard: 960 } satisfies Record<RaidDifficulty, number>,
  /** 高難度: 体力・攻撃の間隔・当たりのダメージ・子分の間隔の倍率 */
  hard: { hpScale: 1.3, intervalScale: 0.85, damageScale: 1.15, minionIntervalScale: 0.85 },
  /** 最初の攻撃（出撃してからの秒数。ブリーフィングを読む間） */
  firstAttackDelay: 14,
  /** 被弾で白く光る秒数 */
  flashSeconds: 0.08,
  /** 倒した後: 落ちる速さ（m/s）・海面に着いてから消えるまでの秒数 */
  fallSpeed: 45,
  vanishSeconds: 3,
  /** ソロのブリーフィング（出撃の直後に画面の下に出す秒数） */
  briefingSeconds: 9,
  /** 人数（1〜4 人）ごとの同時に飛べる子分の数（プールは ALBION_CONFIG.minions.cap） */
  minionCap: [12, 12, 14, 16] as readonly number[],
  /**
   * 協力: hpScale は人数ごとの全体 HP の倍率（部位 HP も同じ割合）。人数が増えても 1 人より難しくならない値（ボットの表）。
   * focusSeconds: 攻撃を向ける人（いちばん近い人）を選び直す間隔（攻撃の途中では変えない）。focusKeep: 今の人がいちばん近い人の
   * この倍の距離までなら変えない
   */
  coop: {
    hpScale: [1, 1.6, 2.2, 2.8] as readonly number[],
    focusSeconds: 2,
    focusKeep: 1.25,
  },
} as const;

/** 人数ごとの全体 HP の倍率 */
export function albionCoopHpScale(players: number): number {
  const n = Math.max(1, Math.min(4, Math.round(players)));
  return ALBION_RAID_CONFIG.coop.hpScale[n - 1] ?? 1;
}

/** 人数ごとの同時に飛べる子分の数 */
export function albionMinionCap(players: number): number {
  const n = Math.max(1, Math.min(4, Math.round(players)));
  return ALBION_RAID_CONFIG.minionCap[n - 1] ?? 12;
}
