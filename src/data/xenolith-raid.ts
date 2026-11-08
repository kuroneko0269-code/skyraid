// 10-5b: UFO ゼノリスのレイド（ソロ・協力）の数値: 制限時間・高難度・出し方・撃破・協力の人数の補正。
// 動き・光線・バリア・瞬間移動・部位の数値は src/data/xenolith.ts。値は tests/xenolith-raid-bots.ts・tests/xenolith-coop-bots.ts の
// ボットの表と、人の手応えの目安（docs/kaiju-roster.md の「10-5b」）で決めた。Three.js・DOM 非依存（起動時には読まない。遅延チャンク xenolith-runtime）
import type { RaidDifficulty } from './raid';

export const XENOLITH_RAID_CONFIG = {
  /** 制限時間（秒）。空へ去る（失敗の理由は「時間切れ」） */
  totalSeconds: { normal: 1200, hard: 1080 } satisfies Record<RaidDifficulty, number>,
  /** 高難度: 体力・光線の間隔・当たりのダメージの倍率 */
  hard: { hpScale: 1.3, intervalScale: 0.85, damageScale: 1.15 },
  /** 最初の光線・瞬間移動（出撃してからの秒数。ブリーフィングを読む間） */
  firstAttackDelay: 12,
  firstWarpDelay: 18,
  /** 出す位置: 開始位置の前方 ahead m・上 up m（自機の方を向く） */
  spawn: { ahead: 2200, up: 150 },
  /** 被弾で白く光る秒数 */
  flashSeconds: 0.08,
  /** 倒した後: 光が消えて傾きながら落ちる速さ（m/s）・海面に着いてから消えるまでの秒数 */
  fallSpeed: 40,
  vanishSeconds: 2.5,
  /** ソロのブリーフィング（出撃の直後に画面の下に出す秒数） */
  briefingSeconds: 10,
  /**
   * 協力: hpScale は人数ごとの全体 HP の倍率（部位 HP も同じ割合）。人数が増えても 1 人より難しくならない値（ボットの表）。
   * focusSeconds: 回る中心・光線・瞬間移動を向ける人（いちばん近い人）を選び直す間隔（光線・瞬間移動の予兆の途中では変えない）。
   * focusKeep: 今の人がいちばん近い人のこの倍の距離までなら変えない
   */
  coop: {
    hpScale: [1, 1.4, 1.8, 2.2] as readonly number[],
    focusSeconds: 4,
    focusKeep: 1.4,
  },
} as const;

/** 人数ごとの全体 HP の倍率 */
export function xenolithCoopHpScale(players: number): number {
  const n = Math.max(1, Math.min(4, Math.round(players)));
  return XENOLITH_RAID_CONFIG.coop.hpScale[n - 1] ?? 1;
}
