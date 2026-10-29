// 武装の数値（2-1: 機銃 / 2-2: ロックオン・ミサイル・フレア）。ロジックは src/combat/
// 距離は m、時間は秒、速度は m/s

export interface GunHeatSpec {
  /** 1 発で上がる熱（上限 1） */
  readonly perShot: number;
  /** 冷える速さ（1/秒） */
  readonly coolRate: number;
  /** 最後に撃ってから冷え始めるまでの時間 */
  readonly coolDelay: number;
  /** オーバーヒートが解除される熱 */
  readonly recoverBelow: number;
}

export interface GunSpec {
  /** 連射速度（発/秒） */
  readonly fireRate: number;
  /** 機体に対する弾の初速。撃った機体の速度に足す */
  readonly muzzleSpeed: number;
  /** 弾が消えるまでに飛ぶ距離（ワールドでの移動距離） */
  readonly range: number;
  /** 弾にかかる重力（m/s²） */
  readonly gravity: number;
  /** 1 発のダメージ */
  readonly damage: number;
  /** 弾のばらつき（度。機首方向からの最大のずれ） */
  readonly spreadDeg: number;
  /** 銃口の位置（機体ローカル。前方 -Z・上 +Y・右 +X） */
  readonly muzzleOffset: { readonly x: number; readonly y: number; readonly z: number };
  /** 同時に飛べる弾の上限（プールの大きさ）。満杯のときは撃っても弾が出ない */
  readonly maxBullets: number;
  readonly heat: GunHeatSpec;
}

/**
 * 初期機の機銃。
 * - 15 発/秒 × 4 秒（60 発）撃ち続けるとオーバーヒート。1.25 秒冷えると（熱 0.5）また撃てる
 * - 初速 900 + 機速（巡航 250）で約 1150 m/s。射程 1500m を約 1.3 秒で飛び、その間に約 8m 落ちる
 * - 的（HP 120）は 12 発で落ちる。連射で 0.8 秒、外れを含めて 2〜3 秒
 */
export const GUN_CONFIG: GunSpec = {
  fireRate: 15,
  muzzleSpeed: 900,
  range: 1500,
  gravity: 9.8,
  damage: 10,
  spreadDeg: 0.3,
  // 機首の先端（胴体 9m の半分 + 機首 3.5m）より少し後ろ・下
  muzzleOffset: { x: 0, y: -0.3, z: -7.5 },
  maxBullets: 256,
  heat: {
    perShot: 1 / 60,
    coolRate: 0.4,
    coolDelay: 0.3,
    recoverBelow: 0.5,
  },
};

// ---- 2-2: ロックオン・誘導ミサイル・フレア。ロジックは src/combat/targeting.ts / missile.ts / flare.ts ----

export interface TargetingSpec {
  /** 索敵範囲: 距離（m）と機首方向からの角度（度、片側） */
  readonly sensorRange: number;
  readonly sensorConeDeg: number;
  /** 選択中の対象は角度に関係なく、この距離まで選んだままにする（画面外なら矢印で示す） */
  readonly keepRange: number;
  /** ロック円錐: 距離と機首方向からの角度（度、片側） */
  readonly lockRange: number;
  readonly lockConeDeg: number;
  /** 円錐に入り続けてロック完了までの時間（秒） */
  readonly lockSeconds: number;
  /** 円錐から外れたとき、満タンのゲージが 0 になるまでの時間（秒） */
  readonly lockDecaySeconds: number;
}

/**
 * 索敵とロック。
 * - 索敵 5km・機首 ±60° の対象に四角を出す。HUD のマーカーは最大 12 個（src/data/hud.ts）
 * - ロック円錐は ±12°・2.5km（ミサイルの燃焼中の到達距離 約 3km より手前）。1.2 秒入り続けるとロック
 * - 外れると 0.8 秒で満タンから 0 へ（少しはみ出しただけならすぐ戻せる）
 */
export const TARGETING_CONFIG: TargetingSpec = {
  sensorRange: 5000,
  sensorConeDeg: 60,
  keepRange: 6000,
  lockRange: 2500,
  lockConeDeg: 12,
  lockSeconds: 1.2,
  lockDecaySeconds: 0.8,
};

export interface MissileSpec {
  /** 初期機の搭載数。補給はミッション間（今はフリーフライト開始時に満タン） */
  readonly ammo: number;
  /** 連続して撃てる間隔（秒） */
  readonly fireInterval: number;
  /** 発射位置（機体ローカル。左右交互に使う。x は右側の値で、左は符号を反転） */
  readonly hardpoint: { readonly x: number; readonly y: number; readonly z: number };
  /** 発射から誘導を始めるまでの時間（秒）。この間は直進して母機から離れる */
  readonly straightSeconds: number;
  /** 近接信管が働き始めるまでの時間（秒） */
  readonly armSeconds: number;
  /** ロケットの加速（m/s²）と最高速度（m/s）。初速は母機の速度 */
  readonly thrust: number;
  readonly maxSpeed: number;
  /** 燃焼時間（秒）。燃焼中だけ誘導し、燃焼後は誘導せず慣性で落ちる */
  readonly burnSeconds: number;
  /** 寿命（秒）。過ぎたら消える */
  readonly lifeSeconds: number;
  /** 燃焼後の重力（m/s²）と空気抵抗（1/秒、速度に比例して減速） */
  readonly gravity: number;
  readonly drag: number;
  /** 比例航法の航法定数（視線角速度に掛ける倍率） */
  readonly navConstant: number;
  /** 最大旋回率（度/秒） */
  readonly maxTurnDeg: number;
  /** シーカーの視野（度、片側）。目標がこれより外れると見失って直進する。フレアもこの中だけ見る */
  readonly seekerConeDeg: number;
  /** 近接信管: 対象の当たり判定の半径 + fuseMargin 以内で起爆 */
  readonly fuseMargin: number;
  /** 範囲ダメージ: 中心（対象の表面までの距離 0）で maxDamage、blastRadius で edgeFraction 倍、外は 0 */
  readonly blastRadius: number;
  readonly maxDamage: number;
  readonly edgeFraction: number;
}

/**
 * 初期機の誘導ミサイル。
 * - 母機の速度（巡航 250）から 220 m/s² で加速、約 2 秒で最高 700 m/s。燃焼 5 秒で約 3km 飛ぶ
 * - 最大旋回 30°/秒（700 m/s で半径約 1.3km）。周回ドローン（120 m/s・半径 2km 前後）は確実に追える。
 *   巡航の戦闘機（宙返り 1 周 約 5 秒 = 72°/秒）なら急旋回で振り切れる
 * - 近接信管 半径 + 6m。範囲ダメージ 25m、中心 150・縁 45。的（HP 120）・ドローン（HP 100）は信管が働けば 1 発
 */
export const MISSILE_CONFIG: MissileSpec = {
  ammo: 4,
  fireInterval: 0.4,
  hardpoint: { x: 2.6, y: -0.6, z: 0.5 },
  straightSeconds: 0.5,
  armSeconds: 0.3,
  thrust: 220,
  maxSpeed: 700,
  burnSeconds: 5,
  lifeSeconds: 10,
  gravity: 9.8,
  drag: 0.08,
  navConstant: 4,
  maxTurnDeg: 30,
  seekerConeDeg: 50,
  fuseMargin: 6,
  blastRadius: 25,
  maxDamage: 150,
  edgeFraction: 0.3,
};

export interface FlareSpec {
  /** 回数（1 回で perBurst 個まとめて放出） */
  readonly charges: number;
  readonly cooldownSeconds: number;
  readonly perBurst: number;
  /** 漂う時間（秒） */
  readonly lifeSeconds: number;
  /** 放出位置（機体ローカル。尾部の下） */
  readonly offset: { readonly x: number; readonly y: number; readonly z: number };
  /** 機体に対して後ろ・下・左右へ放出する速さ（m/s） */
  readonly ejectSpeed: number;
  /** 空気抵抗（1/秒）。母機の速度を引き継いだあと減速して後ろへ流れる（1 秒で約 50m、3 秒で約 360m 遅れる） */
  readonly drag: number;
  readonly gravity: number;
  /** 誘導中のミサイルが視野内（seekerConeDeg）・この距離以内のフレアを初めて見たとき、乗り換える確率（1 回の放出ごと） */
  readonly decoyRange: number;
  readonly decoyChance: number;
}

/**
 * フレア。6 回・クールダウン 2 秒。1 回に 4 個を後方へ放ち、3 秒漂う。
 * 乗り換え確率 60%（1 回の放出につき 1 回判定）。2 回続けて撒けば約 84% で外せる
 */
export const FLARE_CONFIG: FlareSpec = {
  charges: 6,
  cooldownSeconds: 2,
  perBurst: 4,
  lifeSeconds: 3,
  offset: { x: 0, y: -0.6, z: 4.5 },
  ejectSpeed: 40,
  drag: 0.6,
  gravity: 4,
  decoyRange: 2000,
  decoyChance: 0.6,
};

// ---- 2-3: 敵機の武装。ミサイル・フレアは初期機と同じ仕様（MISSILE_CONFIG / FLARE_CONFIG）で、搭載数は難易度（src/data/ai.ts） ----

/**
 * 敵機の機銃。初期機と同じ弾道で、ばらつきを 0.5° に広げ、1 発 5（プレイヤーの HP 200 を 40 発）。
 * 同時に飛ぶ弾は 1 機 64 発まで（バースト 1 秒 = 15 発なので十分）
 */
export const ENEMY_GUN_CONFIG: GunSpec = {
  ...GUN_CONFIG,
  damage: 5,
  spreadDeg: 0.5,
  maxBullets: 64,
};

/** 同時に飛べるミサイルの数（自機と敵機で共有のプール）。自機 4 発 + 敵 4 機 × 2 発に余裕 */
export const MISSILE_POOL_SIZE = 16;
