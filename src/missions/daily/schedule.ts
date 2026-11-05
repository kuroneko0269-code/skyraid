// 日替わりチャレンジ（9-9）の条件を日付から決める（Three.js・DOM 非依存）。日本時間の日付（YYYY-MM-DD）だけを入力にし、
// 整数の演算（Math.imul と >>> 0）だけで選ぶので、端末・ブラウザ・言語・時間帯によらず全員が同じ条件になる
// （Math.random・浮動小数の三角関数・Intl・端末の時間帯は使わない）
import {
  DAILY_CONFIG,
  DAILY_KINDS,
  DAILY_TIERS,
  isDailyKind,
  isDailyTier,
  type DailyKind,
  type DailyTier,
} from '../../data/daily';

const DAY_MS = 24 * 60 * 60 * 1000;

/** その日の条件（リプレイのヘッダにもこの形で入る） */
export interface DailySpec {
  /** 日本時間の日付（YYYY-MM-DD） */
  readonly day: string;
  readonly kind: DailyKind;
  readonly tier: DailyTier;
  readonly aircraftId: string;
  readonly weatherId: string;
  /** 条件の計算の版（DAILY_CONFIG.version） */
  readonly version: number;
}

/** 時刻（UTC のミリ秒）→ 日本時間の通し日数（1970-01-01 が 0） */
export function dailyDayNumber(ms: number): number {
  return Math.floor((ms + DAILY_CONFIG.dayOffsetMs) / DAY_MS);
}

/** 通し日数 → YYYY-MM-DD（UTC の暦で数える。日本時間のずれは通し日数に入っている） */
export function dailyDayKey(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** YYYY-MM-DD → 通し日数（読めなければ null） */
export function parseDailyDayKey(key: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const ms = Date.parse(`${key}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  const day = Math.round(ms / DAY_MS);
  return dailyDayKey(day) === key ? day : null;
}

/** 今の日本時間の日付 */
export function todayKey(nowMs: number): string {
  return dailyDayKey(dailyDayNumber(nowMs));
}

/** 文字列の 32 ビットのハッシュ（FNV-1a。UTF-16 の単位ごと） */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 整数だけの乱数（mulberry32 の整数の出力）。同じシードなら同じ並び */
function intRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let z = a;
    z = Math.imul(z ^ (z >>> 15), z | 1) >>> 0;
    z = (z ^ (z + Math.imul(z ^ (z >>> 7), z | 61))) >>> 0;
    return (z ^ (z >>> 14)) >>> 0;
  };
}

/** 4 日ごとのまとまりの種類の並び（シャッフル。前のまとまりの最後と同じ種類で始まらないようにずらす） */
function blockKinds(block: number, depth = 0): DailyKind[] {
  const rnd = intRandom(
    hash32(`skyraid-daily:v${String(DAILY_CONFIG.version)}:kinds:${String(block)}`),
  );
  const order = [...DAILY_KINDS];
  for (let i = order.length - 1; i > 0; i--) {
    const j = rnd() % (i + 1);
    const a = order[i];
    const b = order[j];
    if (a !== undefined && b !== undefined) {
      order[i] = b;
      order[j] = a;
    }
  }
  // 前のまとまりは 1 つ前だけを見る（その前は見ない: 計算が日付の数だけ深くならない）
  if (depth === 0) {
    const prevLast = blockKinds(block - 1, 1).at(-1);
    if (order[0] === prevLast) {
      const first = order[0];
      const second = order[1];
      if (first !== undefined && second !== undefined) {
        order[0] = second;
        order[1] = first;
      }
    }
  }
  return order;
}

const mod = (n: number, m: number): number => ((n % m) + m) % m;

/** 重み付きで 1 つ選ぶ（整数） */
function pickTier(r: number): DailyTier {
  const w = DAILY_CONFIG.tierWeights;
  const total = DAILY_TIERS.reduce((s, tier) => s + w[tier], 0);
  let x = r % total;
  for (const tier of DAILY_TIERS) {
    if (x < w[tier]) return tier;
    x -= w[tier];
  }
  return 2;
}

/** その日（通し日数）の条件。種類は 4 日で 4 種類を一巡し、難しさ・機体・天候は日付のハッシュから */
export function dailySpecOf(day: number): DailySpec {
  const kinds = blockKinds(Math.floor(day / DAILY_KINDS.length));
  const kind = kinds[mod(day, DAILY_KINDS.length)] ?? 'targets';
  const key = dailyDayKey(day);
  const rnd = intRandom(hash32(`skyraid-daily:v${String(DAILY_CONFIG.version)}:${key}`));
  const tier = pickTier(rnd());
  const aircraft = DAILY_CONFIG.aircraft;
  const aircraftId = aircraft[rnd() % aircraft.length] ?? 'kestrel';
  const weathers = DAILY_CONFIG.weathers[kind];
  const weatherId = weathers[rnd() % weathers.length] ?? 'day-clear';
  return { day: key, kind, tier, aircraftId, weatherId, version: DAILY_CONFIG.version };
}

/** 今の時刻の日の条件 */
export function dailySpecAt(nowMs: number): DailySpec {
  return dailySpecOf(dailyDayNumber(nowMs));
}

/**
 * 条件を 1 つの文字列にする（ランキング・セーブの見出し。サーバーの check と同じ形）:
 * 「版:種類:難しさ:機体:天候」（例 1:race:2:swift:night-clear）
 */
export function dailySpecKey(
  s: Pick<DailySpec, 'version' | 'kind' | 'tier' | 'aircraftId' | 'weatherId'>,
): string {
  return [String(s.version), s.kind, String(s.tier), s.aircraftId, s.weatherId].join(':');
}

/** ヘッダ・セーブから読んだ値を確かめる（壊れていれば null） */
export function parseDailySpec(raw: unknown): DailySpec | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const { day, kind, tier, aircraftId, weatherId, version } = o;
  if (typeof day !== 'string' || parseDailyDayKey(day) === null) return null;
  if (!isDailyKind(kind) || !isDailyTier(tier)) return null;
  if (typeof aircraftId !== 'string' || typeof weatherId !== 'string') return null;
  if (typeof version !== 'number' || !Number.isInteger(version)) return null;
  return { day, kind, tier, aircraftId, weatherId, version };
}
