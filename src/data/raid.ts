// 協力レイドの仕上げ（6-6）の数値: 復帰・難易度・報酬・ブリーフィング・レイドの定型文。
// 報酬の式は src/progression/raid-reward.ts、難易度は src/entities/kaiju.ts（HP・最終フェーズ）と src/ai/kaiju-ai.ts（予兆）が読む
import { t, tList } from '../core/i18n';

/** レイドの難易度（ロビーのホスト設定・ソロの開始前に選ぶ） */
export const RAID_DIFFICULTIES = ['normal', 'hard'] as const;
export type RaidDifficulty = (typeof RAID_DIFFICULTIES)[number];

export const RAID_DIFFICULTY_LABELS: Readonly<Record<RaidDifficulty, string>> = {
  get normal() {
    return t('raid.difficulty.normal');
  },
  get hard() {
    return t('raid.difficulty.hard');
  },
};

export const RAID_RULES = {
  /** 協力の撃墜から復帰までの秒数（PvP は PVP_CONFIG.respawnSeconds の 3 秒）。復帰の位置は街の北の開始位置（ID ごとの横一列） */
  respawnSeconds: 5,
  /** 高難度: 全体 HP（部位 HP も）の倍率・予兆の短縮（秒。最短 minWindup）・最終フェーズの秒数・報酬の倍率 */
  hard: { hpScale: 1.4, windupCut: 0.5, minWindup: 0.3, finalSeconds: 210, rewardScale: 1.8 },
  /**
   * 報酬（全員同じ。貢献度で差をつけない）: 基礎額 × 時間ボーナス（× 高難度の倍率）。失敗は failCredits（難易度によらない）。
   * 時間ボーナスはクリア時間（カウントダウンの後から）が underSeconds 未満なら scale。上から順に見る
   */
  reward: {
    coopBase: 3000,
    soloBase: 2000,
    failCredits: 300,
    timeBonus: [
      { underSeconds: 420, scale: 1.5 },
      { underSeconds: 540, scale: 1.2 },
    ],
  },
  /**
   * 8-6: レイド（ソロ・協力。M5 の遭遇は変えない）の強さ。人数によらず同じ倍率（協力も人数に応じて同じ割合で上がる）。
   * 8-6b で通常と高難度に分けた（8-6 の値は通常には厳しすぎたので、高難度だけに残す）。
   * - toughness: 怪獣が受けるダメージを割る（全体 HP と部位 HP を ×toughness にしたのと同じ。協力の通信は HP を u16 で
   *   送り、4 人・高難度で 65,535 を超えるので、HP の数値は変えずにダメージの側で効かせる）
   * - attackInterval: 攻撃の間隔（KAIJU_ATTACK_CONFIG.intervalSeconds）の倍率。attackDamage: 攻撃のダメージの倍率
   * - downDamageScale: ダウン中のダメージの倍率（KAIJU_CONFIG.down.damageScale の代わり。8-6b）
   * 値は tests/kaiju-raid-bots.ts の熟練・平均的なボットで決めた（docs/decisions.md の 8-6 / 8-6b）
   */
  tuning: {
    normal: { toughness: 1.35, attackInterval: 1, attackDamage: 1, downDamageScale: 1 },
    hard: { toughness: 2.3, attackInterval: 0.85, attackDamage: 1.15, downDamageScale: 2 },
  },
  /** 協力の開始前のブリーフィング（カウントダウンの前。2 回目以降は全員がスキップを押すと早く終わる） */
  briefingSeconds: 5,
} as const;

/** ブリーフィングの文（怪獣の弱点と協力のヒント） */
export const RAID_BRIEFING: { readonly title: string; readonly lines: readonly string[] } = {
  get title() {
    return t('raid.briefing.title');
  },
  get lines() {
    return tList('raid.briefing.lines');
  },
};

/** レイドだけの定型文（PVP_QUICK_PHRASES の後ろに続く番号で送る。レイドのときだけ出す） */
export const RAID_QUICK_PHRASES: readonly string[] = lazyList([
  'raid.phrases.head',
  'raid.phrases.legs',
  'raid.phrases.crystal',
  'raid.phrases.evade',
]);

/** 要素を読むたびに今の言語の文を返す配列（最上位で t() を呼ばないため） */
function lazyList(keys: readonly string[]): readonly string[] {
  const list: string[] = [];
  keys.forEach((key, i) => {
    Object.defineProperty(list, i, { get: () => t(key), enumerable: true });
  });
  return list;
}

/** レイドの強さ（8-6b: 難易度ごと。RAID_RULES.tuning） */
export function raidTuning(hard: boolean): (typeof RAID_RULES.tuning)[RaidDifficulty] {
  return RAID_RULES.tuning[hard ? 'hard' : 'normal'];
}
