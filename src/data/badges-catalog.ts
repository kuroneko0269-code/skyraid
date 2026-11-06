// 勲章（9-10・9-10b・9-10c）の型と報酬と、組み合わせの勲章の id の作り方。並び（＝番号）と中身の表は src/data/badges-order.ts、
// 名前（「〜した」の条件の文）と補足は src/data/badges-text.ts が表の badges.items / ladder / combo から組み立てる。
// 9-10c: 段階（銅・銀・金）をやめて 1 段ずつ別の勲章にした。番号（No.001〜）は並びの順の表示だけで、取った記録は id で持つ。
// 決定は docs/decisions.md の 9-10b・9-10c

/** カテゴリ（一覧の左の列の順。9-10c で並べ直した。レイドの中は怪獣ごと） */
export const BADGE_GROUPS = [
  'career',
  'flight',
  'combat',
  'campaign',
  'race',
  'defense',
  'practice',
  'daily',
  'coop',
  'pvp',
  'raid',
  'collect',
] as const;
export type BadgeGroup = (typeof BADGE_GROUPS)[number];

/** 数えの単位（表示の換算: 時間は秒 → 時間、距離は m → km） */
export type StatUnit = 'count' | 'hours' | 'km';

export interface BadgeStat {
  /** 段階の数えの id（表の badges.ladder.<id>） */
  readonly ladder: string;
  /** 合計する stats のキー */
  readonly keys: readonly string[];
  /** しきい値（stats の単位: 秒・m・数） */
  readonly goal: number;
  /** 表示のしきい値（時間・km・数） */
  readonly shown: number;
  readonly unit: StatUnit;
}

/** 組み合わせ（文の作り方。params は表の値の id） */
export interface BadgeCombo {
  readonly family: string;
  readonly params: Readonly<Record<string, string>>;
}

/**
 * 「同じ段の勲章」の中での段の短い名前（詳細の右の欄）: 数（単位つき）・表の値の名前（難易度・機体・補助の組）・決まった文
 */
export type BadgeStep =
  | { readonly n: number; readonly unit: StatUnit | 'days' | 'pct' }
  | { readonly word: string; readonly id: string }
  | { readonly key: string };

export interface BadgeDef {
  /** セーブの badges.earned のキー（変えない。番号が変わっても記録はこの id で残る） */
  readonly id: string;
  /** 番号（No.001〜。並びの順の表示だけ。版で変わってよい） */
  readonly no: number;
  readonly group: BadgeGroup;
  /** 報酬（CR）。取ったときに 1 回だけ払う */
  readonly reward: number;
  /** 同じ種類の段のまとまり（詳細の「同じ段の勲章」。1 つだけのものは id） */
  readonly chain: string;
  /** まとまりの中の段の短い名前 */
  readonly step?: BadgeStep;
  /** 補助の組「ふつう」以上（自動射撃・速度合わせ・狙いの補助「強」を使わない）で取ったときだけ */
  readonly skill?: boolean;
  /** 隠し勲章（取るまで名前と条件が「？？？」。番号は見せる） */
  readonly hidden?: boolean;
  /** 段階の数え（9-10b） */
  readonly stat?: BadgeStat;
  /** 組み合わせ（9-10b） */
  readonly combo?: BadgeCombo;
  /** 収集: 収集以外の勲章のうち取った割合（0〜1） */
  readonly collect?: number;
}

/** 報酬（9-10b）: 9-10b からの勲章は 1 つずつは小さく、10 個ごとの節目と収集でまとめて */
export const BADGE_REWARDS = {
  /** 9-10b で足した勲章 1 つ（段階の数え・組み合わせ） */
  each: 100,
  /** 勲章（収集も含む）を milestoneEvery 個取るごと */
  milestoneEvery: 10,
  milestone: 500,
  /** 収集の割合ごと */
  collect: [
    { fraction: 0.25, credits: 1000 },
    { fraction: 0.5, credits: 2000 },
    { fraction: 0.75, credits: 4000 },
    { fraction: 1, credits: 8000 },
  ],
} as const;

/** 組み合わせの勲章の id（判定と表で同じ作り方） */
export const comboId = {
  raidClear: (kaiju: string, diff: string) => `c.raidClear.${kaiju}.${diff}`,
  raidTimed: (kaiju: string, diff: string) => `c.raidTimed.${kaiju}.${diff}`,
  raidNoHit: (kaiju: string, diff: string) => `c.raidNoHit.${kaiju}.${diff}`,
  raidNoDown: (kaiju: string, diff: string) => `c.raidNoDown.${kaiju}.${diff}`,
  raidAssistHard: (kaiju: string, diff: string) => `c.raidAssistHard.${kaiju}.${diff}`,
  missionS: (mission: string, aircraft: string) => `c.missionS.${mission}.${aircraft}`,
  missionSAssist: (mission: string, assist: string) => `c.missionSAssist.${mission}.${assist}`,
  courseGold: (course: string, aircraft: string) => `c.courseGold.${course}.${aircraft}`,
  defenseClear: (map: string, diff: string) => `c.defenseClear.${map}.${diff}`,
} as const;

/** 補助の組の S を数える組（かんたんは S と同じなので数えない） */
export const MISSION_S_ASSISTS = ['normal', 'hard'] as const;

/**
 * 9-10c: 段階付きだった 3 つ（銅・銀・金）を 1 段ずつ別の勲章に分けた。セーブの古い id の段階ごとの時刻を、ここの順の id に移す
 */
export const SPLIT_BADGES: Readonly<Record<string, readonly string[]>> = {
  campaign: ['campaign', 'campaignA', 'campaignS'],
  raceMedals: ['raceMedals', 'raceMedalsA', 'raceMedalsS'],
  dailyStreak: ['dailyStreak', 'dailyStreak7', 'dailyStreak30'],
};

/**
 * 9-10c: 重なっていたので消した勲章（同じ条件が組み合わせの勲章にある。どれも記録からさかのぼれるので、取っていた人は組み合わせの方が付いている）
 */
export const REMOVED_BADGES: readonly string[] = [
  'vorgas',
  'nephirga',
  'raidHard',
  'defenseAll',
  'defenseHard',
];
