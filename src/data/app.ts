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

/** manifest.webmanifest（vite.config.ts の vite-plugin-pwa が書き出す） */
export const APP_MANIFEST = {
  name: 'SkyRaid: Titan Skies',
  shortName: 'SkyRaid',
  description: 'ブラウザで動く 3D フライトシューティング',
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
} as const;
