// 怪獣「ヴォルガス（Vorgas）」（6-1 / 6-2）の数値。ロジックは src/entities/kaiju.ts（部位 HP・ダウン・ブレイク・フェーズ）と
// src/ai/kaiju-ai.ts（上陸 → 歩行 → 攻撃選択 → 予兆 → 攻撃）、形は src/render/kaiju-model/。決定は docs/decisions.md の 6-1。
// 距離は m、時間は秒、角度は度。怪獣のローカル座標は足元が原点・前方 -Z・右 +X・上 +Y

/** 部位（ロック・HUD の並び順。Tab で機首に近い順に切り替わる） */
export const KAIJU_PARTS = ['head', 'crystal', 'leftLeg', 'rightLeg', 'tail'] as const;
export type KaijuPartId = (typeof KAIJU_PARTS)[number];

/** 攻撃 4 種 */
export const KAIJU_ATTACKS = ['sweep', 'roar', 'beam', 'throw'] as const;
export type KaijuAttack = (typeof KAIJU_ATTACKS)[number];

export interface KaijuPartSpec {
  /** HUD の名前 */
  readonly label: string;
  /** 部位 HP（全体 HP に対する割合。全体 HP と一緒に人数で増える） */
  readonly hpShare: number;
  /** 当たり判定の球（静止姿勢のローカル座標の中心と半径） */
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  readonly radius: number;
}

export const KAIJU_CONFIG = {
  name: 'ヴォルガス',
  /** 全高（首の付け根の結晶の先まで。6-1b で背中の棘をやめ、見た目の最も高い所は約 145m） */
  height: 150,
  /**
   * 全体 HP の基礎値（人数スケールの 1 人分）。全体 HP = base × (0.55 + 0.45 × 人数)。
   * 「4 人・Kestrel Lv0・平均的な命中率で 8 分前後」になるよう tests/kaiju-raid-bots.ts のボットで決めた（docs/decisions.md の 6-1）
   */
  baseHp: 13000,
  /**
   * 2〜4 人は base × (constant + perPlayer × 人数)。1 人は base × solo（6-1b。それまでは式のまま 1.0）。
   * 部位ダメージ倍率を ×5.3 → ×3.8 に下げた分、1 人の HP だけを下げてソロの所要時間を保つ（2〜4 人の HP は変えない）
   */
  hpScale: { constant: 0.55, perPlayer: 0.45, solo: 0.78 },
  /**
   * 人数ごとの部位ダメージ倍率（添字 = 人数 − 1）。1 人はブレイクが成立しない代わり（指示は ×1.3）。人数スケールの式では
   * 1 人の HP が 4 人の 1/2.35 しかなく、しかも怪獣の攻撃が全部 1 人に来るので、ボットで 5〜7 分に入るよう ×5.3 にした
   * （ユーザー確認済み）。6-1b の指示で ×3.8 に下げ、1 人の HP を hpScale.solo（0.78 = 10,140）で下げて所要時間を保った
   * （ボット 20 シードの中央値 約 6.4 分。docs/decisions.md の 6-1b）。2・3 人は式のままだと 4 人より遅く（2 人は 12 分超で最終フェーズに間に合わない）、
   * 1 人より大幅に遅くなるので、ボットで 4 人と同じくらいになるよう足した（docs/decisions.md の 6-1）
   */
  partyDamageScale: [3.8, 1.75, 1.25, 1],
  parts: {
    head: { label: '頭', hpShare: 0.1, center: { x: 0, y: 100, z: -62 }, radius: 20 },
    // 6-1b: 結晶を肩・首の付け根へ移したので、判定の球も (0, 108, −4) → (0, 100, −30) へ（半径は同じ）
    crystal: { label: '結晶', hpShare: 0.14, center: { x: 0, y: 100, z: -30 }, radius: 38 },
    leftLeg: { label: '左脚', hpShare: 0.1, center: { x: -18, y: 32, z: 4 }, radius: 19 },
    rightLeg: { label: '右脚', hpShare: 0.1, center: { x: 18, y: 32, z: 4 }, radius: 19 },
    tail: { label: '尾', hpShare: 0.1, center: { x: 0, y: 26, z: 82 }, radius: 26 },
  } satisfies Record<KaijuPartId, KaijuPartSpec>,
  /** 見た目の半径（破片・爆発の大きさ） */
  visualRadius: 60,
  /** 脚の破壊でダウンする秒数と、その間の全部位のダメージ倍率 */
  down: { seconds: 15, damageScale: 2, bodyDrop: 38 },
  /** ブレイク: 同じ部位に 3 秒以内に minAttackers 人以上がダメージ → 5 秒間その部位のダメージ ×3 */
  break: { windowSeconds: 3, minAttackers: 2, seconds: 5, damageScale: 3, cooldownSeconds: 8 },
  /** フェーズ（全体 HP の割合）。2: 歩行が速くなり攻撃間隔 −20%。3: 熱線 2 連射・制限時間 */
  phases: {
    phase2Ratio: 0.7,
    phase3Ratio: 0.4,
    phase2WalkScale: 1.3,
    phase2IntervalScale: 0.8,
    finalSeconds: 270,
  },
  /** 歩行: 1 歩 2.5 秒・歩幅 15m（6 m/s）。止まる距離（島の中心からの水平距離） */
  walk: { stepSeconds: 2.5, strideLength: 15, turnDegPerSecond: 12, stopRadius: 450 },
  /** 海から上陸する（足元が海面の height 下 → 海面か地表）時間 */
  riseSeconds: 8,
  /** M5（遭遇）の撤退: 速さと沈みきるまでの時間 */
  retreat: { speed: 10, sinkSeconds: 12 },
  hitFlashSeconds: 0.08,
} as const;

export interface KaijuAttackSpec {
  readonly label: string;
  /** 予兆・攻撃・硬直の秒数 */
  readonly windup: number;
  readonly active: number;
  readonly recover: number;
}

/** 攻撃の数値。予兆中は HUD に攻撃名と残り秒を出す */
export const KAIJU_ATTACK_CONFIG = {
  /** 攻撃の間隔（前の攻撃が終わってから次を選ぶまで。フェーズ 2 から ×0.8） */
  intervalSeconds: 7,
  /** 選べる攻撃がない・相手がいないときに選び直す間隔 */
  retrySeconds: 1,
  /** 同じ攻撃を続けて使える回数（3 回連続しない） */
  maxRepeat: 2,
  /** 狙う相手を探す距離（水平） */
  aggroRange: 3000,
  sweep: {
    label: '薙ぎ払い',
    windup: 1.5,
    active: 1.2,
    recover: 1.0,
    /** 足元から水平 radius 以内・高さ maxAltitude 以下が 1 回転の間に当たる（1 人 1 回） */
    radius: 250,
    maxAltitude: 200,
    damage: 100,
    /** 選ぶ条件: 最も近い機体がこの距離・高さ以内 */
    pickRange: 320,
    pickAltitude: 240,
  },
  roar: {
    label: '咆哮',
    windup: 2.0,
    active: 1.2,
    recover: 1.0,
    /** 頭から radius 以内の機体を stunSeconds 操作不能に。高度 immuneAltitude 以上・フレアを撒いて flareSeconds 以内は無効 */
    radius: 800,
    stunSeconds: 2,
    immuneAltitude: 600,
    flareSeconds: 2.5,
    pickRange: 800,
  },
  beam: {
    label: '熱線',
    windup: 2.5,
    active: 3.0,
    recover: 1.5,
    /** 口から range まで、幅 width の直線。ロック中の機体へ向き、trackDegPerSecond で追う（横に逃げれば外れる） */
    range: 2600,
    width: 30,
    damagePerSecond: 80,
    trackDegPerSecond: 9,
    /** 最終フェーズの 2 射目の予兆 */
    repeatWindup: 1.0,
    pickMinRange: 280,
    pickMaxRange: 2400,
  },
  throw: {
    label: '投擲',
    windup: 1.2,
    active: 0.5,
    recover: 1.0,
    /** 岩: 半径・重力・飛ぶ時間（距離 / speed を min〜max に）・ダメージ。狙うのは投げた瞬間の位置（先読みしない） */
    rockRadius: 16,
    gravity: 9.8,
    speed: 320,
    minFlightSeconds: 1.6,
    maxFlightSeconds: 6,
    damage: 120,
    /** 選ぶ条件: 高さ pickAltitude 以上か、距離 pickRange 以上 */
    pickAltitude: 300,
    pickRange: 800,
    minRange: 200,
    maxRange: 2800,
  },
} as const;

/** 攻撃ごとの予兆・攻撃・硬直（型の確認用） */
export const KAIJU_ATTACK_TIMINGS: Readonly<Record<KaijuAttack, KaijuAttackSpec>> =
  KAIJU_ATTACK_CONFIG;

/** レイド（ソロ）の怪獣の出現と開始位置。島の南東の海（海岸線から 約 1.2km 沖）から島の中心へ */
export const RAID_CONFIG = {
  kaijuFrom: { x: 2800, z: 2800 },
  cityCenter: { x: 0, z: 0 },
  /** 開始位置（島の南東の沖、高度 700m、上陸する怪獣の方を向く。約 2.6km 先）。協力は PvP の開始位置 */
  start: { x: 3700, y: 700, z: 5200, headingDeg: -21 },
  /** 報酬（全員同じ。貢献度で差をつけない） */
  reward: 5000,
  parTimeSeconds: 420,
} as const;
