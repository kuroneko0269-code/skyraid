// P2P 通信（5-1）の数値。仕組みは src/net/、決定は docs/decisions.md

export const NET_CONFIG = {
  /** プロトコルの版。join に入れ、ホストと違えば参加を断る */
  protocolVersion: 1,
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
  /** 開始位置: 島の沖合（WORLD_CONFIG.start）に横一列。機首は -Z（島の方） */
  spawn: {
    /** 隣の機体との間隔（m） */
    spacing: 80,
  },
  /** プレイヤーの色（機体のアクセント色・名札・ロビーの印。ID 0〜3: 赤・青・黄・緑） */
  playerColors: [0xe0402a, 0x2a8fe0, 0xe0b82a, 0x3cc46a],
  /** 機体の胴体の色をプレイヤーの色へ寄せる割合（0 = 元の色。遠くからも見分けられるように） */
  playerBodyTint: 0.3,
  /** ホストのゲーム設定の初期値（welcome で配る。撃ち合いと勝敗は 5-3 / 5-4） */
  defaultSettings: {
    mapId: 'island',
    timeLimitSeconds: 300,
    scoreLimit: 10,
  },
  /** ?netdebug の表示を書き換える間隔（秒） */
  debugRefreshSeconds: 0.25,
} as const;
