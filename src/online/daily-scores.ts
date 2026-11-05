// 日替わりチャレンジ（9-9）のスコアの送信とその日のランキング（DOM・Supabase 非依存）。
// 送るのはセーブの records.daily にある「日ごとの最高」のうち、まだ送っていない（送った値と違う）もの。オフラインで遊んだ日も
// つながったとき（起動・ログイン・次の挑戦の後）に送る。サーバーの準備（SQL 0005）ができるまでは DAILY_RANKING_ENABLED で止める。
// 表は skyraid.daily_scores、ランキングはビュー skyraid.daily_best（supabase/migrations/skyraid_0005_daily.sql）
import { DAILY_CONFIG, DAILY_KINDS, type DailyKind } from '../data/daily';
import { ONLINE_CONFIG } from '../data/online';
import { isDailyPreset, type DailyEntry, type DailyPreset } from '../progression/daily-records';
import { OnlineError, errorKind } from './backend';
import { retryOutcome } from './record-sender';
import { raceFloorMs } from './records';

export interface DailyScoreInput {
  /** 日本時間の日付（YYYY-MM-DD） */
  readonly day: string;
  /** 条件の見出し（dailySpecKey） */
  readonly spec: string;
  readonly kind: DailyKind;
  readonly value: number;
  readonly preset: DailyPreset;
  readonly aircraftId: string;
  readonly clientVersion: string;
}

export interface DailyRankingRow {
  readonly userId: string;
  readonly displayName: string | null;
  readonly value: number;
  readonly preset: DailyPreset;
  readonly aircraftId: string;
  readonly createdAt: string;
  readonly place: number;
}

/** サーバーとのやり取り（OnlineBackend の一部） */
export interface DailyBackend {
  insertDailyScore(r: DailyScoreInput): Promise<void>;
  fetchDailyRanking(day: string, spec: string): Promise<DailyRankingRow[]>;
}

/** 条件の見出しの形（SQL の check と同じ） */
export const DAILY_SPEC_PATTERN = new RegExp(
  `^[0-9]{1,3}:(${DAILY_KINDS.join('|')}):[1-3]:[a-z0-9-]{1,32}:[a-z0-9-]{1,32}$`,
);

/** レースの下限（ミリ秒。海岸周回の下限（理論最短 × 0.5）× 2 周（いちばん少ない周回）。SQL の check と同じ） */
export const DAILY_RACE_FLOOR_MS =
  (raceFloorMs(DAILY_CONFIG.race.courseId) ?? 0) *
  Math.min(...Object.values(DAILY_CONFIG.race.laps));

/** 送る前の確かめ（SQL の check と同じ規則。通らなければ理由、通れば null） */
export function checkDailyScore(r: DailyScoreInput): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.day)) return 'day';
  if (!DAILY_SPEC_PATTERN.test(r.spec) || r.spec.split(':')[1] !== r.kind) return 'spec';
  if (!isDailyPreset(r.preset)) return 'preset';
  if (!/^[a-z0-9-]{1,32}$/.test(r.aircraftId)) return 'aircraft';
  if (!Number.isInteger(r.value)) return 'value';
  if (r.kind === 'race') {
    if (r.value < DAILY_RACE_FLOOR_MS || r.value > ONLINE_CONFIG.valueMaxMs) return 'value';
  } else if (r.value < 0 || r.value > DAILY_CONFIG.scoreMax) return 'value';
  return null;
}

/** セーブの 1 日分 → 送る形（最高が無い・条件が読めなければ null） */
export function dailyScoreOf(
  day: string,
  e: Readonly<DailyEntry>,
  clientVersion: string,
): DailyScoreInput | null {
  if (e.best === null) return null;
  const aircraftId = e.spec.split(':')[3] ?? '';
  const r: DailyScoreInput = {
    day,
    spec: e.spec,
    kind: e.kind,
    value: e.best,
    preset: e.preset ?? 'custom',
    aircraftId,
    clientVersion,
  };
  return checkDailyScore(r) === null ? r : null;
}

/** サーバーの行の形を確かめる（違えば例外） */
export function parseDailyRows(v: unknown): DailyRankingRow[] {
  if (!Array.isArray(v)) throw new OnlineError('unknown', 'bad rows');
  return v.map((row: unknown) => {
    if (typeof row !== 'object' || row === null) throw new OnlineError('unknown', 'bad row');
    const o: Record<string, unknown> = { ...row };
    const value = typeof o.value === 'string' ? Number(o.value) : o.value;
    const place = typeof o.place === 'string' ? Number(o.place) : o.place;
    if (
      typeof o.user_id !== 'string' ||
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      typeof place !== 'number' ||
      !Number.isFinite(place) ||
      typeof o.aircraft_id !== 'string' ||
      typeof o.created_at !== 'string'
    )
      throw new OnlineError('unknown', 'bad row');
    return {
      userId: o.user_id,
      displayName: typeof o.display_name === 'string' ? o.display_name : null,
      value,
      preset: isDailyPreset(o.preset) ? o.preset : 'custom',
      aircraftId: o.aircraft_id,
      createdAt: o.created_at,
      place,
    };
  });
}

/** 送るものの出どころ（セーブ）と、送れたときの印 */
export interface DailySource {
  /** まだ送っていない日ごとの最高（古い順） */
  unsent(): readonly { day: string; entry: Readonly<DailyEntry> }[];
  markSent(day: string, value: number): void;
}

/**
 * 送信とランキングのキャッシュ（5 分）。連携中で ON・サーバーの準備ができているときだけ動く。
 * 送れなかった最高はセーブに「未送信」のまま残るので、キューは持たない（次の flush で送り直す）
 */
export class DailySender {
  private flushing = false;
  private readonly cache = new Map<string, { at: number; rows: readonly DailyRankingRow[] }>();

  constructor(
    private readonly backend: DailyBackend,
    private readonly source: DailySource,
    /** 連携中かつ ON のユーザー id（それ以外は null = 送らない） */
    private readonly activeUser: () => string | null,
    /** サーバーの準備（SQL 0005）ができているか */
    private readonly enabled: () => boolean,
    private readonly clientVersion: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get active(): boolean {
    return this.enabled() && this.activeUser() !== null;
  }

  /** まだ送っていない最高を古い順に送る（失敗したら止める。不正値・拒否はその日を飛ばす） */
  async flush(): Promise<void> {
    if (this.flushing || !this.active) return;
    this.flushing = true;
    try {
      for (const { day, entry } of this.source.unsent()) {
        // 送っている間にログアウト・連携 OFF になったら止める
        if (this.activeUser() === null) return;
        const r = dailyScoreOf(day, entry, this.clientVersion);
        if (!r) continue;
        try {
          await this.backend.insertDailyScore(r);
          this.source.markSent(day, r.value);
          this.cache.delete(`${day}|${r.spec}`);
        } catch (e) {
          if (retryOutcome(errorKind(e)) === 'retry') return;
          // 拒否（期限切れの日・不正値）は送り直さない
          this.source.markSent(day, r.value);
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  /** その日のランキング（5 分キャッシュ。動いていなければ空） */
  async ranking(day: string, spec: string): Promise<readonly DailyRankingRow[]> {
    if (!this.active) return [];
    const key = `${day}|${spec}`;
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < ONLINE_CONFIG.rankingCacheMs) return hit.rows;
    const rows = await this.backend.fetchDailyRanking(day, spec);
    this.cache.set(key, { at: this.now(), rows });
    return rows;
  }
}
