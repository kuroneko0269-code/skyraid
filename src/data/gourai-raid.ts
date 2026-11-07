// 10-4b: メカ怪獣ゴウライのレイド（ソロ・協力）の数値: 制限時間・高難度・出し方・撃破・協力の人数の補正。
// 動き・砲台・弾・熱・攻撃・部位の数値は src/data/gourai.ts。値は tests/gourai-raid-bots.ts・tests/gourai-coop-bots.ts のボットの表と、
// 人の手応えの目安（docs/kaiju-roster.md の「10-4b」）で決めた。Three.js・DOM 非依存（起動時には読まない。遅延チャンク gourai-runtime）
import type { RaidDifficulty } from './raid';

export const GOURAI_RAID_CONFIG = {
  /** 制限時間（秒）。湾を離れて去る（失敗の理由は「時間切れ」） */
  totalSeconds: { normal: 960, hard: 780 } satisfies Record<RaidDifficulty, number>,
  /** 高難度: 体力・大きな攻撃の間隔・当たりのダメージ・弾幕の速さの倍率 */
  hard: { hpScale: 1.3, intervalScale: 0.85, damageScale: 1.15, barrageRate: 1.15 },
  /** 最初の大きな攻撃（出撃してからの秒数。ブリーフィングを読む間） */
  firstAttackDelay: 14,
  /** 被弾で白く光る秒数 */
  flashSeconds: 0.08,
  /** 倒した後: 傾きながら沈む速さ（m/s）・海面に着いてから消えるまでの秒数 */
  fallSpeed: 22,
  vanishSeconds: 3,
  /** ソロのブリーフィング（出撃の直後に画面の下に出す秒数） */
  briefingSeconds: 9,
  /**
   * 協力: hpScale は人数ごとの全体 HP の倍率（部位 HP も同じ割合）。人数が増えても 1 人より難しくならない値（ボットの表）。
   * focusSeconds: 大きな攻撃を向ける人（いちばん近い人）を選び直す間隔（攻撃の途中では変えない）。focusKeep: 今の人がいちばん近い人の
   * この倍の距離までなら変えない。eventSteps: 機銃の弾の知らせをまとめて送る固定ステップの数
   */
  coop: {
    hpScale: [1, 1.6, 2.2, 2.8] as readonly number[],
    focusSeconds: 2,
    focusKeep: 1.25,
    eventSteps: 3,
  },
} as const;

/** 人数ごとの全体 HP の倍率 */
export function gouraiCoopHpScale(players: number): number {
  const n = Math.max(1, Math.min(4, Math.round(players)));
  return GOURAI_RAID_CONFIG.coop.hpScale[n - 1] ?? 1;
}
