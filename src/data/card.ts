// 記録カード（8-5）の数値: 大きさ・余白・文字の大きさ・色・フォント・共有の文面のハッシュタグ。
// 中身は src/core/card-model.ts、配置は src/core/card-layout.ts（DOM 非依存）、描画は src/ui/card/card-canvas.ts

/** カードの大きさ（px）。wide = 1200×630（OGP・X・Discord のプレビューと同じ比）、square = 1080×1080 */
export const CARD_SIZES = {
  wide: { width: 1200, height: 630 },
  square: { width: 1080, height: 1080 },
} as const;
export type CardSizeId = keyof typeof CARD_SIZES;

/** 結果画面から作るカードの大きさ */
export const CARD_SIZE: CardSizeId = 'wide';

export const CARD_CONFIG = {
  /** 外側の余白（短辺に対する割合） */
  margin: 0.065,
  /** 文字の大きさ（カードの高さ 630px のときの px。ほかの大きさは短辺で比例） */
  font: {
    brand: 30,
    brandSub: 17,
    mode: 22,
    stage: 52,
    stageMin: 26,
    headline: 30,
    metricLabel: 18,
    metric: 76,
    metricMin: 40,
    fact: 22,
    footer: 21,
    footerMin: 14,
    rank: 210,
  },
  /** 下の帯の高さ（px。高さ 630px のとき） */
  footerHeight: 76,
  /** フォントの読み込みを待つ上限（ms。オフラインで読めなくてもこの後は代わりのフォントで描く） */
  fontWaitMs: 2500,
  /** 場面の画像の上に重ねる暗さ（左 = 文字の側 → 右） */
  shade: { left: 0.88, right: 0.25, footer: 0.72 },
  /** 固定のデザインの空（上 → 地平線） */
  sky: ['#0b2440', '#123a5c', '#1d5a7a'],
  color: {
    background: '#050a12',
    accent: 'rgb(110, 240, 255)',
    text: '#ffffff',
    sub: 'rgba(255, 255, 255, 0.72)',
    success: 'rgb(120, 255, 170)',
    fail: 'rgb(255, 120, 110)',
    rankS: 'rgb(255, 214, 90)',
    rank: 'rgba(255, 255, 255, 0.9)',
    line: 'rgba(110, 240, 255, 0.55)',
  },
  /** フォント（見出し・数値は Rajdhani、無い字（日本語）は端末のフォント） */
  fontFamily: {
    display:
      "Rajdhani, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Noto Sans CJK JP', 'Yu Gothic', Meiryo, system-ui, sans-serif",
    body: "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Noto Sans CJK JP', 'Yu Gothic', Meiryo, system-ui, sans-serif",
  },
  /** 読み込みを待つフォント（index.html の Google Fonts） */
  waitFonts: ['600 48px Rajdhani'],
  /** 共有の文面のハッシュタグ */
  hashtag: '#SkyRaid',
  /** 保存するファイル名の頭（skyraid-card-YYYYMMDD-HHMMSS.png） */
  filePrefix: 'skyraid-card',
} as const;
