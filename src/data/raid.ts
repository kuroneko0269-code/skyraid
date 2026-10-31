// 協力レイドの仕上げ（6-6）の数値: 復帰・難易度・報酬・ブリーフィング・レイドの定型文。
// 報酬の式は src/progression/raid-reward.ts、難易度は src/entities/kaiju.ts（HP・最終フェーズ）と src/ai/kaiju-ai.ts（予兆）が読む

/** レイドの難易度（ロビーのホスト設定・ソロの開始前に選ぶ） */
export const RAID_DIFFICULTIES = ['normal', 'hard'] as const;
export type RaidDifficulty = (typeof RAID_DIFFICULTIES)[number];

export const RAID_DIFFICULTY_LABELS: Readonly<Record<RaidDifficulty, string>> = {
  normal: '通常',
  hard: '高難度',
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
  /** 協力の開始前のブリーフィング（カウントダウンの前。2 回目以降は全員がスキップを押すと早く終わる） */
  briefingSeconds: 5,
} as const;

/** ブリーフィングの文（怪獣の弱点と協力のヒント） */
export const RAID_BRIEFING = {
  title: 'ブリーフィング：ヴォルガス',
  lines: [
    '結晶を壊すと熱線、尾は薙ぎ払い、頭は咆哮を封じる',
    '脚を壊すと 15 秒ダウン（全部位のダメージ ×2）',
    'ブレイクは 2 人で同じ部位を 3 秒以内に撃つ（その部位 ×3）',
  ],
} as const;

/** レイドだけの定型文（PVP_QUICK_PHRASES の後ろに続く番号で送る。レイドのときだけ出す） */
export const RAID_QUICK_PHRASES = ['頭を狙って', '脚を狙って', '結晶を狙って', '回避！'] as const;
