// 勲章・実績（9-10）の決めた数値: 勲章 28 個の並び・まとまり・段階（銅・銀・金）・報酬・「補助ふつう以上」の印と、
// 判定のしきい値（宙返り・インメルマン・低空飛行・背面飛行・最高速・エースなど）。
// 判定は src/missions/badges/（飛行の決まった計算の中の値だけを読む。Three.js・DOM 非依存）、記録からの判定・セーブは
// src/progression/badges.ts、画面は src/ui/badge-*.ts。名前と条件の文は表の badges.items.<id>。決定は docs/decisions.md の 9-10
import { t } from '../core/i18n';

/** まとまり（一覧の見出しの順） */
export const BADGE_GROUPS = [
  'flight',
  'combat',
  'campaign',
  'raid',
  'race',
  'defense',
  'practice',
  'daily',
  'coop',
  'pvp',
] as const;
export type BadgeGroup = (typeof BADGE_GROUPS)[number];

export interface BadgeDef {
  readonly id: string;
  readonly group: BadgeGroup;
  /** 段階ごとの報酬（CR。1 つなら段階なし、3 つなら銅・銀・金）。取ったときに 1 回だけ払う */
  readonly rewards: readonly number[];
  /** 補助の組「ふつう」以上（自動射撃・速度合わせ・狙いの補助「強」を使わない）で取ったときだけ */
  readonly skill?: boolean;
}

/**
 * 勲章の一覧（並びは一覧の画面の順）。id はセーブの badges.earned のキーなので変えない（足すのは可・消すと読み捨てる）。
 * 報酬は 1 回だけ（同じ勲章は 2 回取れない）なので稼ぎ場にならない。合計 46,500 CR（キャンペーン 8 本を全部 S にした報酬の合計 44,000 CR と同じくらい）
 */
export const BADGES: readonly BadgeDef[] = [
  // 操縦（記録する飛行ならどのモードでも）
  { id: 'loop', group: 'flight', rewards: [300] },
  { id: 'immelmann', group: 'flight', rewards: [500] },
  { id: 'lowPass', group: 'flight', rewards: [500] },
  { id: 'inverted', group: 'flight', rewards: [300] },
  { id: 'topSpeed', group: 'flight', rewards: [300] },
  // 戦い
  { id: 'firstKill', group: 'combat', rewards: [300] },
  { id: 'ace', group: 'combat', rewards: [1000] },
  { id: 'gunsOnly', group: 'combat', rewards: [1500], skill: true },
  { id: 'flawless', group: 'combat', rewards: [1500], skill: true },
  // キャンペーン・チュートリアル（記録からさかのぼれる）
  { id: 'campaign', group: 'campaign', rewards: [1000, 2000, 4000] },
  { id: 'tutorial', group: 'campaign', rewards: [500] },
  // レイド
  { id: 'vorgas', group: 'raid', rewards: [1000] },
  { id: 'nephirga', group: 'raid', rewards: [1500] },
  { id: 'nephirgaParts', group: 'raid', rewards: [2000] },
  { id: 'raidNoLoss', group: 'raid', rewards: [2000], skill: true },
  { id: 'raidHard', group: 'raid', rewards: [2000] },
  // リングレース
  { id: 'raceMedals', group: 'race', rewards: [1000, 2000, 4000] },
  { id: 'cleanRun', group: 'race', rewards: [500] },
  // 防衛戦
  { id: 'defenseAll', group: 'defense', rewards: [1500] },
  { id: 'defenseHard', group: 'defense', rewards: [2500] },
  // 練習場
  { id: 'practiceAll', group: 'practice', rewards: [300] },
  { id: 'sharpshooter', group: 'practice', rewards: [1000], skill: true },
  // 日替わり
  { id: 'dailyStreak', group: 'daily', rewards: [500, 1500, 4000] },
  { id: 'dailyAll', group: 'daily', rewards: [500] },
  // 協力
  { id: 'coopClear', group: 'coop', rewards: [1000] },
  { id: 'coopFour', group: 'coop', rewards: [1500] },
  // PvP
  { id: 'pvpWin', group: 'pvp', rewards: [1000] },
  { id: 'pvpKills', group: 'pvp', rewards: [1500] },
];

export function findBadge(id: string): BadgeDef | undefined {
  return BADGES.find((b) => b.id === id);
}

/** 段階の数（1 か 3） */
export function badgeTiers(def: Pick<BadgeDef, 'rewards'>): number {
  return def.rewards.length;
}

/** 判定のしきい値（src/missions/badges/・src/progression/badges.ts） */
export const BADGE_CONFIG = {
  /**
   * 宙返り: 機体の上下の向きの回転（機首を上げる向き）を足し合わせて pitchDeg 以上、その間に機首がほぼ真上（前の向きの上の成分
   * noseUp 以上）・背面（上の向きの上の成分 inverted 以下）・機首が下（noseDown 以下）を通る。windowSeconds 以内に。
   * 水平の旋回（バンク 90° の引き）は機首が真上を向かないので数えない
   */
  loop: { pitchDeg: 330, noseUp: 0.8, inverted: -0.5, noseDown: -0.5, windowSeconds: 30 },
  /**
   * インメルマン: 宙返りの前半（機首を上げる回転 pitchDeg 以上・真上と背面を通る）の後、上を向いた水平（上の向きの上の成分
   * upright 以上・前の向きの上下 level 以内）に戻り、向きが始めの逆（水平の向きの内積 reverse 以下）で climbM 以上高い。windowSeconds 以内に
   */
  immelmann: {
    pitchDeg: 140,
    upright: 0.8,
    level: 0.3,
    reverse: -0.7,
    climbM: 150,
    windowSeconds: 20,
  },
  /** 低空飛行: 地表・海面から maxAglM 未満（0 より上）を minSpeed 以上で seconds 続ける */
  lowPass: { maxAglM: 30, minSpeed: 200, seconds: 8 },
  /** 背面飛行: 上の向きの上の成分 upY 以下を seconds 続ける（地表から minAglM 以上） */
  inverted: { upY: -0.8, seconds: 10, minAglM: 100 },
  /** 最高速: 速さ（m/s）。アフターバーナーの 400 では届かず、降下で加速する */
  topSpeed: 430,
  /** 1 ステップでこれより大きく動いたら（復帰・置き直し）操縦の判定をやり直す（m） */
  teleportM: 60,
  /** エース: 1 回の出撃（キャンペーン・レイド・防衛戦）で落とす敵機の数 */
  aceKills: 5,
  /** 機銃だけ・無傷: 数えないミッション（M1 訓練。撃たれず・ミサイルなしで終えられる） */
  easyMissions: ['training'] as readonly string[],
  /** 名射手: 練習場（日替わりは除く）の 1 回で撃墜 kills 以上・命中率 accuracy 以上 */
  sharpshooter: { kills: 10, accuracy: 0.5 },
  /** 日替わりの連続日数（銅・銀・金） */
  dailyStreak: [3, 7, 30] as readonly number[],
  /** PvP の撃墜の累計 */
  pvpKills: 25,
  /** 4 人で: 協力の人数 */
  coopPlayers: 4,
  /** 取ったお知らせに名前を並べる数（ほかは「ほか N 個」） */
  toastNames: 3,
  /** お知らせを出す秒数 */
  toastSeconds: 6,
} as const;

/** 名前（表の badges.items.<id>.name） */
export function badgeName(id: string): string {
  return t(`badges.items.${id}.name`);
}

/** 条件の文（段階付きは段階ごと。tier は 1〜3） */
export function badgeCondition(id: string, tier = 1): string {
  const def = findBadge(id);
  if (def && badgeTiers(def) > 1) return t(`badges.items.${id}.tier${String(tier)}`);
  return t(`badges.items.${id}.note`);
}

/** 段階の名前（銅・銀・金） */
export function badgeTierName(tier: number): string {
  return t(`badges.tier.${String(tier)}`);
}
