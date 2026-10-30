// 敵機 AI（2-3）の数値。ロジックは src/ai/、敵機の飛行パラメータは src/data/aircraft.ts の ENEMY_FIGHTER
// 距離は m、時間は秒、角度は度。docs/spec.md「5. 戦闘」の「敵機AI」に各数値の意味を書いている

export const DIFFICULTIES = ['rookie', 'easy', 'normal', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  rookie: '入門',
  easy: 'やさしい',
  normal: 'ふつう',
  hard: 'むずかしい',
};

/** ミッション一覧に出す難易度の短い表記（4-12） */
export const DIFFICULTY_SHORT_LABELS: Record<Difficulty, string> = {
  rookie: '入門',
  easy: '易',
  normal: '普',
  hard: '難',
};

/** ポーズメニューの設定「敵」「難易度」の保存先（localStorage） */
export const ENEMY_SETTINGS_KEYS = {
  enabled: 'skyraid.enemies',
  difficulty: 'skyraid.difficulty',
} as const;

/** 難易度ごとに変える数値 */
export interface DifficultySpec {
  /** 判断の間隔（反応時間）。状態の遷移・目標の見直し・発射の判断はこの間隔でしか行わない */
  readonly reactionSeconds: number;
  /** 機銃の狙いのずれ（命中率）。判断ごとに向きを引き直す */
  readonly aimErrorDeg: number;
  /** 予測照準で相手の旋回（加速度）をどれだけ見込むか（0 = 等速直線の予測、1 = 加速度をそのまま） */
  readonly leadAccelWeight: number;
  /** 機首と予測照準点のなす角がこれ以内で撃つ */
  readonly gunConeDeg: number;
  /** 機銃は「撃つ → 休む」をくり返す（オーバーヒートさせない） */
  readonly gunBurstSeconds: number;
  readonly gunPauseSeconds: number;
  /** ロック完了中、判断ごとにミサイルを撃つ確率と、撃ってから次に撃てるまでの時間（ミサイル使用頻度） */
  readonly missileChance: number;
  readonly missileIntervalSeconds: number;
  /** 搭載数（撃墜されて再出現すると満タン） */
  readonly missileAmmo: number;
  /** 引ける最大 G（ゲーム内の G = 速度 × ピッチ角速度 / 9.8）。ピッチ入力をこれで頭打ちにする */
  readonly maxG: number;
  /** ミサイルに追われていると気づいたとき・被弾が続いたときに回避へ移る確率（判断ごと） */
  readonly evadeMissileChance: number;
  readonly evadeHitChance: number;
  /** 回避中（ミサイルに追われている間）、判断ごとにフレアを撒く確率と、搭載回数 */
  readonly flareChance: number;
  readonly flareCharges: number;
}

/**
 * 難易度。初期機のプレイヤーは巡航で約 33G（ピッチ 75°/秒）まで引けるので、easy（11G）の敵は旋回で必ず振り切れる。
 * 数値はシード固定のシミュレーション（tests/ai-simulation.test.ts）で決めた:
 * - easy 1 機 vs 初心者役のボット 60 秒: 被撃墜 0/20・撃墜 18/20（2-3 の easy の値で）
 * - normal 2 機 vs 平均的なボット 150 秒: 被撃墜 9/12・撃墜 8/12・両方 6/12
 * - hard 1 機 vs 初心者役 60 秒: 被撃墜 18/20（熟練者役でも 6/20）
 * 4-12: 実機のスマホで「敵が強すぎる」と評価されたので easy を緩め（maxG 14 → 11・ミサイル 0.08 → 0.04・反応 0.8 → 1.0 秒）、
 * その下に rookie（入門。機銃だけ・maxG 9・狙いのずれ 2.5°。M1 の敵）を足した。normal / hard は 2-3 のまま
 */
export const DIFFICULTY_PRESETS: Record<Difficulty, DifficultySpec> = {
  rookie: {
    reactionSeconds: 1.0,
    aimErrorDeg: 2.5,
    leadAccelWeight: 0,
    gunConeDeg: 5,
    gunBurstSeconds: 0.6,
    gunPauseSeconds: 1.6,
    missileChance: 0,
    missileIntervalSeconds: 25,
    missileAmmo: 0,
    maxG: 9,
    evadeMissileChance: 0.35,
    evadeHitChance: 0.3,
    flareChance: 0.25,
    flareCharges: 2,
  },
  easy: {
    reactionSeconds: 1.0,
    aimErrorDeg: 1.4,
    leadAccelWeight: 0,
    gunConeDeg: 5,
    gunBurstSeconds: 0.6,
    gunPauseSeconds: 1.6,
    missileChance: 0.04,
    missileIntervalSeconds: 25,
    missileAmmo: 1,
    maxG: 11,
    evadeMissileChance: 0.35,
    evadeHitChance: 0.3,
    flareChance: 0.25,
    flareCharges: 2,
  },
  normal: {
    reactionSeconds: 0.3,
    aimErrorDeg: 0.5,
    leadAccelWeight: 0.8,
    gunConeDeg: 4,
    gunBurstSeconds: 0.8,
    gunPauseSeconds: 1.0,
    missileChance: 0.2,
    missileIntervalSeconds: 12,
    missileAmmo: 2,
    maxG: 24,
    evadeMissileChance: 0.65,
    evadeHitChance: 0.5,
    flareChance: 0.5,
    flareCharges: 4,
  },
  hard: {
    reactionSeconds: 0.15,
    aimErrorDeg: 0.35,
    leadAccelWeight: 1,
    gunConeDeg: 3,
    gunBurstSeconds: 1.0,
    gunPauseSeconds: 0.6,
    missileChance: 0.45,
    missileIntervalSeconds: 7,
    missileAmmo: 4,
    maxG: 30,
    evadeMissileChance: 0.95,
    evadeHitChance: 0.8,
    flareChance: 0.8,
    flareCharges: 6,
  },
};

/** 状態の遷移条件・時間・確率と操縦の係数（難易度によらない） */
export const AI_CONFIG = {
  /** 発見: 距離 range 以内かつ機首から ±fovDeg、または closeRange 以内（向きによらない）。loseRange より離れたら見失う */
  detection: { range: 4500, fovDeg: 70, closeRange: 1200, loseRange: 7000 },
  patrol: {
    /** 経路点の水平距離がこれ以内で次の点へ */
    arriveRadius: 500,
    throttle: 0.7,
  },
  engage: {
    /** 追尾の狙い: 相手の予測位置から相手の後ろへ rearOffset ずらした点。予測は最大 maxPredictSeconds 先まで */
    rearOffset: 250,
    maxPredictSeconds: 3,
    /** これより遠いとアフターバーナー（ゲージが afterburnerMinGauge 以上のとき） */
    afterburnerDistance: 3000,
    afterburnerMinGauge: 0.4,
    /** 後方を取った: 相手の尾部から ±rearConeDeg・rearRange 以内。取れないまま timeoutSeconds 続くと離脱を考える */
    rearConeDeg: 50,
    rearRange: 1800,
    timeoutSeconds: 25,
    /** タイムアウトしたとき、判断ごとに離脱へ移る確率 */
    disengageChance: 0.5,
  },
  attack: {
    /** 攻撃へ移る: 距離 range 以内・機首と予測照準点のなす角 coneDeg 以内。exit* 倍を超えたら追尾へ戻る */
    range: 1400,
    coneDeg: 25,
    exitRangeFactor: 1.3,
    exitConeFactor: 1.8,
    /** 機銃を撃つ最大距離（射程 1500m より手前） */
    gunRange: 1100,
    /** これより近いとスロットルを closeThrottle に絞って追い越さない */
    closeDistance: 450,
    closeThrottle: 0.35,
  },
  evade: {
    /** 回避を続ける時間。ミサイルに追われ続けていれば maxSeconds まで延ばす */
    seconds: 3.5,
    maxSeconds: 7,
    /** 被弾の「続いている」度合い: 受けたダメージを halfLifeSeconds で半減させながら足し、damageThreshold を超えたら回避を考える */
    damageHalfLifeSeconds: 1.5,
    damageThreshold: 20,
    /** 回避の種類: バレルロール（ロールし続けながら引く）を選ぶ確率。残りは急旋回（脅威を真横に置いて最大 G） */
    barrelRollChance: 0.4,
    barrelRollPitch: 0.6,
  },
  disengage: {
    /** HP がこの割合を下回ると離脱する */
    hpRatio: 0.3,
    seconds: 8,
    /** 相手と反対へ飛ぶときの上向きの成分 */
    climb: 0.25,
  },
  /**
   * 地面の回避: 地表から minAgl を切る（または lookAheadSeconds 後に切りそう）と、何より先に上昇する。
   * 引き起こしだけは難易度の maxG が minPullG より小さくても minPullG まで引く（4-12。rookie 9G・easy 11G では
   * 山の斜面で引き起こしが間に合わず衝突した。normal / hard は maxG がこれより大きいので変わらない）
   */
  ground: { minAgl: 150, lookAheadSeconds: 3, climb: 1.5, minPullG: 14 },
  /** 操縦（方向へ機首を向ける比例 + 角速度のダンピング）の係数。誤差は rad、角速度は rad/s */
  steer: {
    rollGain: 3,
    rollDamping: 0.25,
    pitchGain: 4,
    pitchDamping: 0.3,
    yawGain: 3,
    /** 下向きに押す（マイナス G）入力の上限 */
    pushLimit: 0.3,
    /** 機首と狙いのなす角がこれ未満では、ロールで狙いを頭上に置くのをやめ、ピッチとヨーで細かく合わせる */
    fineAngleDeg: 8,
  },
} as const;

export interface EnemySpawn {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** 機首の向き（-Z から右回り、度） */
  readonly headingDeg: number;
}

export interface PatrolPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** 敵の出し方（機数・出現地点・巡航経路・再出現） */
export interface EnemyForceConfig {
  readonly count: number;
  /** 同時に出せる上限（性能の予算: 4 機 + 各ミサイルで AI の処理 1ms 以内） */
  readonly maxCount: number;
  readonly defaultDifficulty: Difficulty;
  readonly respawnSeconds: number;
  readonly spawns: readonly EnemySpawn[];
  /** 巡航の経路（機体ごと。i 番目の機体は patrols[i % 長さ]） */
  readonly patrols: readonly (readonly PatrolPoint[])[];
}

/**
 * フリーフライトの敵（2-3）。島の上空を回る 2 機。撃墜されると respawnSeconds 後に、
 * 出現候補のうちプレイヤーから最も遠い地点へ再出現する。起動位置は (0, 500, 4500) で -Z 向き
 */
export const FREE_FLIGHT_ENEMIES: EnemyForceConfig = {
  count: 2,
  maxCount: 4,
  /** 4-12 で normal → easy（セーブに保存済みの難易度はそのまま） */
  defaultDifficulty: 'easy',
  respawnSeconds: 12,
  spawns: [
    { x: -1500, y: 1000, z: -800, headingDeg: 90 },
    { x: 1600, y: 1100, z: 300, headingDeg: 270 },
    { x: 0, y: 1200, z: -3000, headingDeg: 180 },
    { x: -3000, y: 900, z: 1500, headingDeg: 60 },
  ],
  patrols: [
    [
      { x: -2000, y: 1000, z: -2000 },
      { x: 2000, y: 1100, z: -2000 },
      { x: 2000, y: 1000, z: 2000 },
      { x: -2000, y: 900, z: 2000 },
    ],
    [
      { x: 2500, y: 1200, z: 0 },
      { x: 0, y: 1100, z: -2500 },
      { x: -2500, y: 1200, z: 0 },
      { x: 0, y: 1000, z: 2500 },
    ],
  ],
};

/**
 * 輸送機を優先して狙う敵機（M3。2-5）の相手の選び方。ふだんは最も近い輸送機を狙うが、
 * プレイヤー機が playerAggroRange より近づくとプレイヤー機に切り替え、playerReleaseRange より離れると輸送機に戻る
 * （行き来しないよう 2 つの距離に差をつける）。プレイヤーが割って入って輸送機から引きはがす、護衛らしい駆け引きにする
 */
export const ESCORT_ATTACK_CONFIG = {
  playerAggroRange: 1500,
  playerReleaseRange: 2500,
} as const;
