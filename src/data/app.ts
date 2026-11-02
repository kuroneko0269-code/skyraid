// アプリとしての体裁（4-10）: ブランド素材の置き場所、PWA の manifest、更新のお知らせ、iOS の「ホーム画面に追加」の案内

/** ブランド素材（public/brand/ に置くと使われる。README の「ブランド素材の差し替え」） */
export const BRAND_ASSETS = {
  /** タイトルのロゴ画像。無ければテキストのロゴ */
  logo: 'brand/logo.png',
  icon192: 'brand/icon-192.png',
  icon512: 'brand/icon-512.png',
  /** maskable（角丸なしの全面。中央 80% に絵を収める） */
  iconMaskable: 'brand/icon-maskable-512.png',
  /** iOS のホーム画面（180px。iOS が角を丸めるので全面） */
  appleTouchIcon: 'brand/apple-touch-icon.png',
  favicon: 'brand/favicon.ico',
} as const;

/**
 * manifest.webmanifest（vite.config.ts の vite-plugin-pwa が書き出す）。説明文は文言の表の app.description（8-4。manifest には
 * vite.config.ts が ja.json から入れ、情報画面は今の言語で引く）
 */
export const APP_MANIFEST = {
  name: 'SkyRaid: Titan Skies',
  shortName: 'SkyRaid',
  /** アドレスバー・ステータスバーの色（読み込み画面の背景と同じ濃紺） */
  themeColor: '#050a12',
  backgroundColor: '#000000',
} as const;

export const APP_SHELL_CONFIG = {
  /** タイトルの HUD 展開アニメ（起動して最初にタイトルを出したときだけ）の長さ（秒） */
  titleDeploySeconds: 0.6,
  /** 「新しいバージョンがあります」を出しておく秒数（0 なら閉じるまで出す） */
  updateToastSeconds: 12,
  /** 「ホーム画面に追加」の案内: この回数目以降の起動で 1 度だけ（iOS の Safari、ブラウザで開いたとき） */
  installHint: {
    minLaunches: 2,
    /** 案内を出しておく秒数 */
    toastSeconds: 10,
    /** 起動回数と表示済みの記録（端末ごと。セーブデータとは別のキー） */
    launchKey: 'skyraid.launches',
    shownKey: 'skyraid.installHintShown',
  },
  /** 遅延読み込み（8-2）: 読み込みがこの時間を超えたら「読み込み中…」を出す（ms。キャッシュから読むときは出さない） */
  lazyIndicatorDelayMs: 300,
  /** 読み込みに失敗したお知らせを出しておく秒数（0 なら閉じるまで出す） */
  lazyErrorToastSeconds: 0,
} as const;

/** ゲームの描画の大きさ（8-6。src/core/viewport.ts） */
export const VIEWPORT_CONFIG = {
  /** resize・向きの変更の後に測り直す時刻（ms。iOS は向きの変更の後に大きさが遅れて変わる） */
  recheckMs: [120, 400, 1000],
  /** 起動から測り直す時刻（ms。8-6d: iOS の横向きの起動で、初期包含ブロックの大きさが遅れて正しくなることがある） */
  startupRecheckMs: [100, 300, 600, 1000, 1500, 2000, 3000, 5000],
  /**
   * 画面の大きさの表示（?debug=viewport）をホーム画面のアプリでも出す: タイトルの版の表示を tapCount 回（tapWindowMs 以内）
   * 押すと出す / 消す。端末に保存する（storageKey）。ホーム画面のアプリは URL を変えられず、iOS は Safari と保存領域が別のため
   */
  /**
   * 8-6e: iOS のホーム画面から横向きで起動して描かれる高さが足りないとき、viewport-fit を auto にして restoreMs 後に cover に戻す
   * （atMs の時刻に、最大 maxTries 回。checkMs 後に測り直す。8-6f: 2 回目以降は前の試みが終わってから）
   */
  nudge: {
    atMs: [600, 2500],
    maxTries: 2,
    restoreMs: 150,
    checkMs: 400,
    /**
     * 8-6f: 切り替えの間の黒い幕を外すまでの上限（ms。ふつうは試みが終わったときに外す。試みのたびに延ばす安全策）と、消えるまでのフェード（ms。index.html の
     * .viewport-cover と同じ）。試みは順番に、前の試みの後 atMs の間隔をあけて
     */
    coverMaxMs: 6000,
    coverFadeMs: 250,
  },
  debugToggle: { tapCount: 5, tapWindowMs: 3000, storageKey: 'skyraid.debugViewport' },
} as const;
