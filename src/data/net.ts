// P2P 通信（5-1）の数値。仕組みは src/net/、決定は docs/decisions.md

export const NET_CONFIG = {
  /**
   * プロトコルの版。join に入れ、ホストと違えば参加を断る（5-3 で 2: 戦闘の入力・ミサイル・成績。
   * 5-4 で 3: ロビーの準備・機体変更・定型文・チーム・再接続・最長連続撃墜。6-2 で 4: レイドのモード・怪獣の状態・スタン）
   */
  protocolVersion: 4,
  /** 部屋の最大人数（ホストを含む） */
  maxPlayers: 4,
  room: {
    /** 部屋コードの長さ */
    codeLength: 6,
    /** 部屋コードの文字。紛らわしい 0 / O / 1 / I を除いた英大文字と数字（32 文字） */
    codeAlphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
    /** PeerJS の ID の接頭辞（ホスト: 接頭辞 + 部屋コード。クライアント: 接頭辞 + "c-" + 乱数） */
    peerIdPrefix: 'skyraid-titan-',
    /** 部屋コードが使用中だったときに作り直す回数 */
    createRetries: 4,
    /** 参加（接続 → welcome）を待つ秒数 */
    joinTimeoutSeconds: 15,
    /** この秒数なにも届かなければ相手が切断したとみなす（PeerJS の切断の検知は遅いことがある） */
    silenceTimeoutSeconds: 6,
  },
  /**
   * クライアントの一時的な切断（5-4）。ホストは切断に気づいてから graceSeconds の間その人の枠と機体を残し
   * （機体は止めて無敵・対象外）、同じ ID と合言葉（welcome の token）で戻れば続ける。過ぎたら離脱扱い。
   * クライアントは気づいてから graceSeconds の間、retrySeconds ごとにつなぎ直す（ホストの ID が消えていれば即終了）
   */
  reconnect: {
    graceSeconds: 10,
    retrySeconds: 1,
  },
  /** パイロット名の最大文字数（送るとき切る。セーブの上限 8 より余裕を持たせる） */
  nameMaxLength: 16,
  rates: {
    /** 固定ステップ（core/loop.ts と同じ 60Hz） */
    tickHz: 60,
    /** 入力の送信（クライアント → ホスト）。2 ステップに 1 回 */
    inputHz: 30,
    /** 状態の送信（ホスト → 全員）。4 ステップに 1 回 */
    stateHz: 15,
    /** ping（RTT の計測と生存確認） */
    pingHz: 1,
  },
  input: {
    /** 1 回の入力メッセージに入れる直近のステップ数。30Hz で送るので各ステップを 3 回送る（ロスに強い） */
    redundancyTicks: 6,
    /**
     * ホストが溜めておくクライアントの入力のステップ数（この数そろってから使い始める。揺らぎの吸収）。
     * 入力は 2 ステップずつ届き、1 つ失われると次の 2 ステップと一緒に 33ms 遅れて届くので、
     * 2（届く単位）+ 2（1 つのロス）+ 2（揺らぎ）。切れたら直前の操作で進め、クライアントの補正で直す
     */
    jitterBufferTicks: 6,
    /** これより溜まったら 1 ステップに 2 つ使って追いつく */
    maxBacklogTicks: 12,
    /** 届いた入力がホストの使う位置よりこれだけ古ければ（クライアントが止まっていた）すぐ溜め直す */
    resyncTicks: 30,
    /** 丸ごと間に合わなかった（全部もう推測で使った seq の）メッセージがこの数続いたら溜め直す（約 100ms） */
    lateMessagesToResync: 3,
  },
  sync: {
    /** 他機の表示をホストの時刻より遅らせる秒数（その間の 2 つの状態を補間する） */
    interpolationDelaySeconds: 0.1,
    /** 状態が途切れたとき速度で外挿する最大秒数（その先は止める） */
    maxExtrapolationSeconds: 0.5,
    /** 外挿に使う加速度の上限（m/s²。リスポーンの飛びなどで大きく外れないように） */
    maxExtrapolationAccel: 150,
    /** 補間に使う状態の保持数（15Hz で約 2 秒） */
    bufferSize: 32,
    /** 時刻のずれの推定に使う直近の受信数 */
    clockWindow: 30,
    /** 時刻のずれをなめらかに直す速さ（1 秒あたりの割合） */
    clockSlewPerSecond: 0.1,
    /** これ以上ずれたら一度に合わせる（秒） */
    clockSnapSeconds: 0.25,
  },
  prediction: {
    /** 自機の先行計算とホストの位置がこれ（m）以上ずれたら補正する */
    correctThreshold: 0.5,
    /** これ（m）以上のずれは「飛び」として数える（?netdebug。補正のしかたは同じ） */
    snapThreshold: 60,
    /** 自機の過去のステップの記録数（60Hz で約 2 秒） */
    historyTicks: 128,
  },
  /**
   * 開始位置: 島の沖合（WORLD_CONFIG.start の x・z）に横一列。5-4 の事前修正で高度 500m・機首 -Z（島の方）・間隔 80m から
   * 高度 800m・機首 +Z（海側）・間隔 150m に（操作しなくても 30 秒は山・海面・隣の機体にぶつからない）
   */
  spawn: {
    /** 隣の機体との間隔（m） */
    spacing: 150,
    /** 高度（m） */
    altitude: 800,
    /** 機首の方位（-Z から右回り、度）。180 = +Z（島の外の海の方） */
    headingDeg: 180,
  },
  /** プレイヤーの色（機体のアクセント色・名札・ロビーの印。ID 0〜3: 赤・青・黄・緑） */
  playerColors: [0xe0402a, 0x2a8fe0, 0xe0b82a, 0x3cc46a],
  /** 機体の胴体の色をプレイヤーの色へ寄せる割合（0 = 元の色。遠くからも見分けられるように） */
  playerBodyTint: 0.3,
  /**
   * ホストのゲーム設定の初期値（welcome で配る。撃墜数と制限時間は 5-3 から、モード・強化の無効・初心者保護は 5-4 から
   * ロビーでホストが選ぶ）。強化の無効は公平のため初期 ON
   */
  defaultSettings: {
    mapId: 'island',
    timeLimitSeconds: 300,
    scoreLimit: 10,
    mode: 'ffa',
    noUpgrades: true,
    rookieGuard: false,
  },
  /** ?netdebug の表示を書き換える間隔（秒） */
  debugRefreshSeconds: 0.25,
} as const;
