// 互換性（8-3）: 最低動作環境と、機能が無い・失敗するときの案内の文面と時間。決め方は docs/compat.md・docs/decisions.md の 8-3

/**
 * 最低動作環境（情報画面の「版」・WebGL が無いときの案内・README に同じものを書く）。
 * 下限はビルドの出力（three の class の static ブロック = ES2022）と WebGL 2 で決まる。:has() を使う 1 か所（設定の選択欄の枠）は
 * 無くても見た目が少し変わるだけ
 */
export const MIN_ENVIRONMENT: readonly { readonly platform: string; readonly browser: string }[] = [
  { platform: 'iPhone / iPad', browser: 'iOS / iPadOS 16.4 以降の Safari' },
  { platform: 'Android', browser: 'Chrome 105 以降' },
  { platform: 'パソコン', browser: 'Chrome / Edge 105 以降・Safari 16.4 以降・Firefox 121 以降' },
];

/** 共通の条件（WebGL 2 と GPU） */
export const MIN_ENVIRONMENT_NOTE =
  'WebGL 2 が使えること（ブラウザのハードウェア アクセラレーションを ON）。推奨はノートパソコンの内蔵 GPU 以上・2020 年以降のスマホ';

export type CompatProblem = 'no-webgl' | 'no-webgl2' | 'start-failed';

/** 起動できないときの案内画面（真っ黒にしない）。見出しと本文 */
export const COMPAT_NOTICE: Readonly<Record<CompatProblem, { title: string; body: string }>> = {
  'no-webgl': {
    title: '3D の描画（WebGL）が使えません',
    body: 'このブラウザ・端末では WebGL が無効になっているため、SkyRaid を起動できません。ブラウザの設定でハードウェア アクセラレーション（GPU）を ON にするか、ブラウザを最新にしてから再読み込みしてください。',
  },
  'no-webgl2': {
    title: 'WebGL 2 に対応していません',
    body: 'このブラウザは WebGL 2 に対応していないため、SkyRaid を起動できません。ブラウザ（iPhone / iPad は iOS）を最新にするか、下の環境のブラウザで開いてください。',
  },
  'start-failed': {
    title: '起動できませんでした',
    body: 'このブラウザでは起動中にエラーが起きました。ブラウザを最新にしてから再読み込みするか、下の環境のブラウザで開いてください。',
  },
};

export const COMPAT_CONFIG = {
  /** WebGL のコンテキストを失ってから、この時間（ms）で戻らなければ「再読み込み」のお知らせを出す */
  contextRestoreTimeoutMs: 5000,
  contextLostNotice: '画面の描画を復帰できませんでした。再読み込みしてください',
  /** 保存できない（localStorage が使えない・容量超過）ときのお知らせ（起動中に 1 回だけ。0 秒 = 閉じるまで） */
  storageNotice:
    'この環境ではデータを保存できません（プライベートブラウズ・容量不足など）。遊べますが、進み具合・設定は閉じると消えます',
  storageNoticeSeconds: 0,
} as const;
