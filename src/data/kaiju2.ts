// 9-6a: 空を飛ぶ怪獣「ネフィルガ（Nephirga）」の数値（仮。9-6b / 9-6c で決める）。設計は docs/kaiju2.md。
// 動きは src/entities/kaiju2/（Three.js 非依存）、攻撃の判定は src/ai/kaiju2-attacks.ts、形は src/render/kaiju2-model/。
// 9-6c で公開（起動時には読まない。遅延チャンクと協力のチャンク）。
// 距離は m、時間は秒、角度は度、速さは m/s。座標はワールド（前方は forward の単位ベクトル）

/** 部位（壊すと動きが変わる） */
export const KAIJU2_PARTS = ['wingL', 'wingR', 'head', 'tail'] as const;
export type Kaiju2Part = (typeof KAIJU2_PARTS)[number];

/** 攻撃 4 種: 雷球 / 翼の突風 / 急降下 / 尾の打ち払い */
export const KAIJU2_ATTACKS = ['orbs', 'gust', 'dive', 'tail'] as const;
export type Kaiju2Attack = (typeof KAIJU2_ATTACKS)[number];

/** 動きの状態 */
export const KAIJU2_STATES = [
  'cruise',
  'windup',
  'attack',
  'recover',
  'landing',
  'perched',
  'takeoff',
] as const;
export type Kaiju2State = (typeof KAIJU2_STATES)[number];

export const KAIJU2_CONFIG = {
  /** 大きさ: 翼開長・頭から尾の先までの長さ（見た目。docs/kaiju2.md） */
  size: { wingspan: 240, length: 170 },
  /** 体の中心から地面・海面までに空ける最小の距離（翼を広げた半分は入らない。めり込まないための下限） */
  bodyClearance: 45,
  /** 地形を避ける: 先読みの秒数と、その先で欲しい高さ（地面・海面から） */
  avoid: { lookahead: [1, 2, 3.5] as readonly number[], clearance: 140, climbDeg: 35 },
  /** 戦域: 中心からの水平の半径。soft を超えたら中へ曲がり、hard は位置を押し戻す（島・港湾の戦域 6000m の内側） */
  arena: { soft: 4300, hard: 5000 },
  /** 高さの上限（海面から）。翼が壊れると下がる */
  ceiling: { normal: 1700, wingBroken: 550 },
  /** 9-6b: 天井より上にいるとき下げる速さ（m/s。翼が壊れたとき） */
  ceilingDrop: 70,
  /** 巡航: 周回の半径・地面からの高さ・速さ・旋回の角速度（度/秒）・加速度 */
  cruise: {
    orbitRadius: 900,
    altitude: 650,
    /** 高さのゆらぎ（周回の 1 周に 1 回、±m） */
    altitudeWave: 120,
    speed: 115,
    turnDegPerSec: 24,
    accel: 25,
    /** 周回の中心がプレイヤーへ寄る速さ（m/s） */
    anchorDrift: 60,
  },
  /** 羽ばたき（1 秒あたりの回数）: 巡航・上昇・ホバリング。急降下はたたむ */
  flap: { cruise: 0.32, climb: 0.6, hover: 0.85 },
  /** 体力の段階（全体 HP の割合。これ以下で次の段階） */
  phases: [0.7, 0.4] as readonly number[],
  /** 攻撃の間隔（段階ごと。巡航に戻ってから次の攻撃まで）と、最初の攻撃までの秒数 */
  /** 9-6d: 7 / 6 / 5 → 3.5 / 3 / 2.5（攻撃が少なく脅威に感じなかった。docs/kaiju2.md の 9-6d） */
  attackInterval: [3.5, 3, 2.5] as readonly number[],
  firstAttackDelay: 6,
  /** 段階ごとの速さの倍率 */
  phaseSpeed: [1, 1.1, 1.18] as readonly number[],
  /** 止まり木（羽を休める）: 飛び続けられる秒数（スタミナ）・休む秒数・降りる場所を探す範囲 */
  perch: {
    /** 9-6d: 55 → 75（降りる・休む・飛び立つで 3 割を超えていた） */
    stamina: 75,
    /** 翼が壊れているとスタミナの減りが速い */
    wingBrokenDrain: 1.8,
    restSeconds: [10, 8, 6] as readonly number[],
    searchRadius: 1600,
    /** 降りられる地面: 海面からこの高さ以上（陸）。候補の数（種から） */
    minGround: 25,
    candidates: 14,
    /** 地面から体の中心までの高さ（たたんだ脚で立つ） */
    standHeight: 22,
    /**
     * 9-6d: 降り方（上空から一瞬で移らない）: 近づく（巡航の速さで、止まり木の周り approachRadius m・上 approachAbove m へ。
     * 1 秒に approachDescent m まで下がる。approachSeconds で打ち切り）→ 旋回しながら降りる（半径を spiralEndRadius m へ縮め、
     * 上 spiralEndAbove m まで。秒数は下がる高さ / spiralDescent を spiralSeconds に収める。速さは spiralEndSpeed へ）→
     * 羽ばたいて止まり木へ寄せる（flareSeconds。速さ 0 へ）→ 着地して翼をたたむ
     */
    /** 9-6d: スタミナが尽きたら止まり木を選び、そこが pendingRange m より遠ければ巡航（攻撃も続ける）のまま周回の中心を寄せる */
    pendingRange: 600,
    pendingDrift: 90,
    approachRadius: 320,
    approachAbove: 240,
    approachDescent: 30,
    approachSeconds: 14,
    spiralEndRadius: 120,
    spiralEndAbove: 60,
    spiralDescent: 28,
    spiralSeconds: [4, 9] as readonly number[],
    spiralEndSpeed: 60,
    flareSeconds: 3,
    /** 地面からこの高さより下で、降りる途中の脚を出す・羽ばたく（協力の写しも高さで決める） */
    flareAgl: 90,
    /** 9-6d: 飛び立ち: 始めの liftSeconds は羽ばたいてほぼ真上へ（liftSpeed m/s まで）、その後は前へ上がる。全体 takeoffSeconds */
    liftSeconds: 1.2,
    liftSpeed: 18,
    takeoffSeconds: 3.5,
    /** 9-6b: 急降下の引き起こしの後、スタミナがこの割合より少なければそのまま止まり木へ（隙をつなげる） */
    perchAfterDive: 0.4,
  },
  /** 部位が壊れたときの動きの変化 */
  broken: {
    /** 翼: 速さ ×、旋回 ×（片翼。両方なら 2 回掛ける）。壊れた側へ傾く（度） */
    wingSpeed: 0.8,
    wingTurn: 0.85,
    wingListDeg: 12,
    /** 尾（舵）: 旋回 ×（大回りになる） */
    tailTurn: 0.6,
  },
  /** 攻撃の数値（仮）。秒数は 予兆 / 攻撃 / 硬直（recover） */
  attacks: {
    orbs: {
      windup: 1.8,
      active: 0.6,
      recover: 1.2,
      /** 段階ごとの数 */
      count: [3, 3, 5] as readonly number[],
      /** 9-6d: 150 → 210・発射 90 → 120・追う 28 → 45°/秒（自機の巡航 250 より遅く、強く曲がれば（75°/秒）振り切れる） */
      speed: 210,
      launchSpeed: 120,
      turnDegPerSec: 45,
      /**
       * 9-6d: 見越し: 届くまでの秒数 × lead だけ先の自機の位置へ向けて撃ち、追う（撃つときは 距離 / speed、
       * 飛んでいる間は 距離 / 近づく速さ）。扇の横の広がり（向きの成分）・
       * 上下の散らばり（交互）・乱れ（種から）。まっすぐ飛び続けると当たり、曲がれば外れる
       */
      lead: 0.9,
      fanSide: 0.4,
      fanUp: 0.1,
      jitter: 0.14,
      lifetime: 10,
      radius: 25,
      /**
       * 9-6b: 35 → 30、9-6d: 30 → 40。1 回の攻撃（扇の 3〜5 個）で当たるのは maxHits 個まで（2 個で 80。Swift の HP 140 で一撃で落ちない）
       */
      damage: 40,
      maxHits: 2,
      /** 使う距離（m）。9-6d: 近い 400 → 250（近くを飛ぶと攻撃が選ばれずに間が空いていた） */
      minRange: 250,
      maxRange: 2600,
      /** フレアに乗り換える: 視野（度）と距離 */
      decoyDeg: 50,
      decoyRange: 900,
    },
    gust: {
      windup: 1.5,
      active: 0.8,
      recover: 1.0,
      /** 前方の円錐: 長さ・半分の角度（度）。9-6d: 700 → 850・30 → 36 */
      range: 850,
      halfAngleDeg: 36,
      /** 9-6b: 30 → 25、9-6d: 25 → 30 */
      damage: 30,
      /** 煽られて操作できない秒数（咆哮のスタンの仕組みを使う）。9-6b: 1.0 → 0.6（短めに） */
      stun: 0.6,
      /** 9-6d: 押し流し: 当たると怪獣の向き（水平）へ push m/s で流す（pushSeconds で 0 へ弱まる） */
      push: 150,
      pushSeconds: 1,
      /** 使う条件: 前方 maxRange 以内・中心から pickAngle 以内。9-6d: 900 → 1050・45 → 50 */
      pickRange: 1050,
      pickAngleDeg: 50,
    },
    dive: {
      windup: 2.5,
      /** 予兆の上昇の角度（度）と速さ */
      climbDeg: 35,
      climbSpeed: 80,
      /** 上昇で目指す点: プレイヤーの手前（怪獣の側）setback m・上 above m */
      setback: 700,
      above: 550,
      /** 降下の始めに向きを合わせる秒数と角速度（度/秒） */
      aimSeconds: 0.8,
      aimDegPerSec: 90,
      /** 攻撃（降下）の最長秒数・速さ・追う角速度（度/秒）・予測の秒数 */
      active: 6,
      speed: 230,
      /**
       * 9-6d: 自機の進路に合わせる: 予兆の終わりに「届くまでの秒数 × leadScale」（leadMin〜leadMax 秒）先の自機の位置を狙い、
       * 降下の始めの retargetSeconds は自機の進路へ狙いを直す。追う角速度 8 → 11°/秒（直角に曲がれば外れる）
       */
      turnDegPerSec: 11,
      leadScale: 0.8,
      leadMin: 0.8,
      leadMax: 2.2,
      retargetSeconds: 1.2,
      hitRadius: 50,
      /** 9-6b: 80 → 70（高難度 ×1.15 で 80。Swift の HP 140 の 6 割弱） */
      damage: 70,
      /** 引き起こし（攻める隙）: 秒数と速さ */
      recover: 5,
      recoverSpeed: 70,
      /** 使う条件: 段階 2 から・プレイヤーが下に（高さの差 m 以上）・距離 */
      fromPhase: 2,
      minDrop: 100,
      minRange: 500,
      maxRange: 2200,
      /** 降下を止める地面からの高さ */
      pullUpClearance: 160,
      /**
       * 9-6c: 急降下が出にくかった（段階 2 が 30〜40 秒と短く、自機が 100m 以上下にいるときだけ）ので、段階 2 に入ってからと
       * 前の急降下から dueSeconds 経つと「出番」にする。出番の間は自機が dueMinDrop（上なら負）まで下・dueMinRange m から選べ、
       * 雷球より先に選ぶ（尾の打ち払い・突風は先）。段階 2 に入った最初の攻撃は出番（段階が変わった合図に見せる）
       */
      /** 9-6d: 20 → 14 */
      dueSeconds: 14,
      dueMinDrop: -250,
      dueMinRange: 200,
    },
    tail: {
      windup: 0.9,
      active: 0.5,
      recover: 0.8,
      /** 後ろの範囲: 距離・後ろの円錐の半分の角度（度） */
      pickRange: 320,
      pickAngleDeg: 50,
      /** 尾の先の振りの判定の球（半径）と尾の長さ */
      hitRadius: 140,
      reach: 110,
      /** 9-6b: 50 → 45、9-6d: 45 → 50 */
      damage: 50,
    },
  },
  /** 攻撃を選ぶ: 同じ攻撃を続ける上限 */
  maxRepeat: 2,
  /**
   * 9-6d: 攻撃を重ねる: 段階ごとに、1 回の攻撃の後に間を chainGap 秒だけ空けて続ける回数（段階 1 は 0）。続けた攻撃にも予兆はある
   */
  chain: [1, 1, 2] as readonly number[],
  chainGap: 1.2,
  /**
   * 9-6d: 狙われたら避ける（巡航の間だけ）: 自機の機首から coneDeg 以内・range m 以内に afterSeconds 続けて入ると、
   * seconds の間、自機の射線から横へ（旋回 ×turnScale・速さ ×speedScale）、上か下へ climb（向きの成分）だけ外れる。
   * 次に避けられるまで cooldown 秒
   */
  evade: {
    coneDeg: 10,
    range: 1500,
    afterSeconds: 0.8,
    seconds: 2.4,
    cooldown: 6,
    turnScale: 1.7,
    speedScale: 1.3,
    climb: 0.35,
  },
  /**
   * 9-6d: 部位を壊すと怯む（攻めどき）: seconds の間、攻撃せず（予兆は取り消す）、速さ ×speedScale で sink m/s 下がる。
   * 受けるダメージは止まり木と同じ倍率（kaiju2-raid.ts の perchedDamageScale）
   */
  flinch: { seconds: 3, speedScale: 0.6, sink: 15 },
} as const;

/** 確かめる場（?dev=kaiju2）の出し方: プレイヤーの開始位置からの距離・高さ */
export const KAIJU2_DEV_CONFIG = {
  spawnAhead: 2600,
  spawnAltitude: 750,
  /** 種の混ぜ物（飛行のシードと xor。ほかの乱数の列を変えない） */
  seedSalt: 0x6b616932,
} as const;
