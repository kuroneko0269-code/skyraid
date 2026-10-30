// セーブデータの決めた値（3-1）。スキーマと読み書きは src/progression/save.ts

export const SAVE_CONFIG = {
  /** localStorage のキー（値は JSON 1 つ） */
  storageKey: 'skyraid.save',
  /** 今のスキーマの版。上げたら progression/save.ts の SAVE_MIGRATIONS に「1 つ前の版 → この版」を足す */
  version: 4,
  /** パイロット名の最大文字数（コードポイント単位。絵文字・漢字も 1 文字） */
  pilotNameMaxLength: 8,
  /** 空のまま決定したときのパイロット名 */
  defaultPilotName: 'PILOT',
  /** 壊れたセーブデータを初期値に戻したときのお知らせと表示秒数 */
  resetNotice: 'セーブデータを初期化しました',
  noticeSeconds: 3,
  /** クレジット残高の上限（表示とオーバーフロー対策。普通に遊んで届かない値） */
  maxCredits: 999_999_999,
} as const;
