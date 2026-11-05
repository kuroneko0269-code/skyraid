// オンライン連携（7-4）の決めた数値。仕組みは src/online/、SQL は supabase/migrations/skyraid_0001_init.sql、
// 設計は docs/supabase-design.md。SQL と同じ値を使うものは tests/online-sql.test.ts で突き合わせる
import { t } from '../core/i18n';
import type { RaidKaijuId } from './raid-kaiju';

export const ONLINE_CONFIG = {
  /** Supabase のスキーマ（規約 1.1。アプリ名と同じ） */
  schema: 'skyraid',
  /** 端末に残す連携の状態（オンライン連携の ON/OFF・同期の記録・送信待ちの記録）。セーブとは別のキー */
  storageKey: 'skyraid.online',
  /** 保存イベントから送信までのデバウンス（ミリ秒）。連続した保存は最後の 1 回だけ送る */
  pushDebounceMs: 3000,
  /** 送信できなかった記録を残す数（超えたら古いものから捨てる） */
  queueMax: 20,
  /** ランキングのキャッシュ（ミリ秒） */
  rankingCacheMs: 5 * 60 * 1000,
  /** ランキングに出す数（ビューの上位と同じ） */
  rankingTop: 100,
  /** 表示名の文字数（コードポイント。SQL の char_length と同じ数え方） */
  displayName: { min: 1, max: 16 },
  /** セーブの JSON の上限（バイト。SQL の check と同じ） */
  saveMaxBytes: 256 * 1024,
  /** 1 ユーザーが 1 分に送れる記録の数（SQL のトリガと同じ） */
  recordsPerMinute: 20,
  /** kind × key × ユーザーごとに残す記録の数（SQL の間引きのトリガと同じ） */
  keepPerKey: 3,
  /** 記録の値の範囲（ミリ秒。1 時間を超える記録は受け付けない） */
  valueMaxMs: 60 * 60 * 1000,
  /** レースは「コースの理論最短 × この倍率」未満を拒否する */
  raceFloorRatio: 0.5,
  /** 防衛戦の波数の上限（これを超える記録は拒否） */
  defenseMaxWaves: 10,
  /**
   * メールのコードの桁数（7-4c: Supabase の設定で 6〜10 桁に変えられるので幅を持たせる。今のプロジェクトは 8 桁）。
   * expirySec は Supabase の「Email OTP Expiration」と同じ値（不一致と期限切れは同じエラーで返るので、送ってからの時間で分ける）
   */
  otp: { minLength: 4, maxLength: 10, expirySec: 3600 },
  /** 承認待ちの間、トークンを取り直して承認を確かめる間隔（ミリ秒。7-4b） */
  pendingRecheckMs: 5 * 60 * 1000,
} as const;

/**
 * 9-6c: オンラインのランキングに載せるレイドの怪獣。ネフィルガの記録のキー（nephirga:normal / nephirga:hard）は
 * supabase/migrations/skyraid_0003_raid_kaiju.sql を流してからサーバーが受け付ける（README の「ネフィルガのランキング」）。
 * 9-5d の事前修正: 0003 を流したので 'nephirga' を足した（送る・ランキングの選択に出す）
 */
export const RANKED_RAID_KAIJU: readonly RaidKaijuId[] = ['vorgas', 'nephirga'];

export function rankedRaidKaiju(id: RaidKaijuId): boolean {
  return RANKED_RAID_KAIJU.includes(id);
}

/**
 * 9-8: オンラインのランキングに載せるリングレースのコース。9-8 の新しいコース（night-harbor・peak-spiral）の記録のキーは
 * supabase/migrations/skyraid_0004_race_courses.sql を流してからサーバーが受け付ける（README の「新しいコースのランキング」）。
 * 流すまでは送らない・ランキングのコースの選択に出さない（ローカルの自己ベスト・ゴーストには残る）。
 * 9-9 の事前修正: 0004 を流したので 2 つを足した（送る・ランキングのコースの選択に出す）
 */
export const RANKED_COURSES: readonly string[] = [
  'coast',
  'canyon',
  'harbor-speed',
  'acro',
  'night-harbor',
  'peak-spiral',
];

export function rankedCourse(id: string): boolean {
  return RANKED_COURSES.includes(id);
}

/**
 * 9-9: 日替わりチャレンジのランキング（表 skyraid.daily_scores・ビュー daily_best）。
 * supabase/migrations/skyraid_0005_daily.sql を流すまでは false（送らない・画面のランキングの欄は「準備中」）。
 * 流したら true にする（README の「日替わりチャレンジのランキング」）。遊んだ日の最高はセーブに残り、true にした後につながったとき
 * 送る（今日を含めて 7 日以内の日だけ）
 */
export const DAILY_RANKING_ENABLED: boolean = false;

/** 記録の種類 */
export const RECORD_KINDS = ['race', 'raid', 'defense'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const RECORD_KIND_LABELS: Readonly<Record<RecordKind, string>> = {
  get race() {
    return t('ranking.kind.race');
  },
  get raid() {
    return t('ranking.kind.raid');
  },
  get defense() {
    return t('ranking.kind.defense');
  },
};

/** records.client_version（記録の形を変えたら上げる） */
export const ONLINE_CLIENT_VERSION = 'skyraid-web/1';
