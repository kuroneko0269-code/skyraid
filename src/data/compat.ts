// 互換性（8-3）: 最低動作環境と、機能が無い・失敗するときの案内の文面と時間。決め方は docs/compat.md・docs/decisions.md の 8-3
import { t } from '../core/i18n';

/**
 * 最低動作環境（情報画面の「版」・WebGL が無いときの案内・README に同じものを書く）。
 * 下限はビルドの出力（three の class の static ブロック = ES2022）と WebGL 2 で決まる。:has() を使う 1 か所（設定の選択欄の枠）は
 * 無くても見た目が少し変わるだけ。文面は文言の表（compat.*。8-4）。古いブラウザの案内（src/legacy/legacy-check.js）にも
 * ビルド時に同じ表から埋め込む（scripts/vite-legacy-check.ts）
 */
export const MIN_ENVIRONMENT: readonly { readonly platform: string; readonly browser: string }[] = [
  {
    platform: 'iPhone / iPad',
    get browser() {
      return t('compat.env.ios');
    },
  },
  {
    platform: 'Android',
    get browser() {
      return t('compat.env.android');
    },
  },
  {
    get platform() {
      return t('compat.env.pcPlatform');
    },
    get browser() {
      return t('compat.env.pc');
    },
  },
];

/** 共通の条件（WebGL 2 と GPU） */
export function minEnvironmentNote(): string {
  return t('compat.note');
}

export type CompatProblem = 'no-webgl' | 'no-webgl2' | 'start-failed';

/** 案内の見出しと本文（表のキー compat.<id>.title / body） */
function notice(id: string): { readonly title: string; readonly body: string } {
  return {
    get title() {
      return t(`compat.${id}.title`);
    },
    get body() {
      return t(`compat.${id}.body`);
    },
  };
}

/** 起動できないときの案内画面（真っ黒にしない）。見出しと本文 */
export const COMPAT_NOTICE: Readonly<Record<CompatProblem, { title: string; body: string }>> = {
  'no-webgl': notice('noWebgl'),
  'no-webgl2': notice('noWebgl2'),
  'start-failed': notice('startFailed'),
};

export const COMPAT_CONFIG = {
  /** WebGL のコンテキストを失ってから、この時間（ms）で戻らなければ「再読み込み」のお知らせを出す */
  contextRestoreTimeoutMs: 5000,
  get contextLostNotice(): string {
    return t('compat.contextLost');
  },
  /** 保存できない（localStorage が使えない・容量超過）ときのお知らせ（起動中に 1 回だけ。0 秒 = 閉じるまで） */
  get storageNotice(): string {
    return t('compat.storage');
  },
  storageNoticeSeconds: 0,
} as const;
