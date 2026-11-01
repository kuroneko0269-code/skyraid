// 表示の整形（7-4、DOM・Supabase 非依存）: 記録の値・日付・表示名・ランキングの行、メールと 6 桁のコードの入力
import { findAircraftModel } from '../data/aircraft';
import { ONLINE_CONFIG, type RecordKind } from '../data/online';
import type { RankingRow } from './backend';
import type { RecordDetail } from './records';

/** ミリ秒 → 「1:23.456」（1 分未満は「23.456」） */
export function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const frac = String(total % 1000).padStart(3, '0');
  return m > 0 ? `${String(m)}:${String(s).padStart(2, '0')}.${frac}` : `${String(s)}.${frac}`;
}

/** 記録の値の表示。防衛戦は「10 波・司令部 85%」 */
export function formatRecordValue(kind: RecordKind, valueMs: number, detail: RecordDetail): string {
  if (kind !== 'defense') return formatMs(valueMs);
  const waves = typeof detail.waves === 'number' ? detail.waves : 0;
  const hq = typeof detail.hq === 'number' ? detail.hq : 0;
  return `${String(waves)} 波・司令部 ${String(hq)}%`;
}

/** ISO の時刻 → ローカルの「2026-11-01」 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 表示名の整え: 制御文字を除き、前後の空白を落とし、16 文字（コードポイント）まで。空なら null */
export function sanitizeDisplayName(name: string): string | null {
  const cleaned = Array.from(name.replace(/\p{Cc}/gu, '').trim())
    .slice(0, ONLINE_CONFIG.displayName.max)
    .join('')
    .trim();
  return cleaned.length >= ONLINE_CONFIG.displayName.min ? cleaned : null;
}

/** メールの形（大まかに。正しさはメールが届くかで分かる） */
export function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) && s.trim().length <= 254;
}

/** 入力されたコード → 数字 6 桁（全角数字・空白・ハイフンは許す）。違えば null */
export function normalizeCode(s: string): string | null {
  const digits = s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s-]/g, '');
  return new RegExp(`^\\d{${String(ONLINE_CONFIG.otpLength)}}$`).test(digits) ? digits : null;
}

export interface RankingLine {
  readonly place: string;
  readonly name: string;
  readonly value: string;
  readonly aircraft: string;
  readonly date: string;
  /** 自分の行（ハイライト） */
  readonly self: boolean;
}

export function rankingLines(
  kind: RecordKind,
  rows: readonly RankingRow[],
  selfId: string | null,
): RankingLine[] {
  return rows.map((r) => ({
    place: String(r.place),
    name: r.displayName ?? '（名前なし）',
    value: formatRecordValue(kind, r.valueMs, r.detail),
    aircraft: findAircraftModel(r.aircraftId)?.name ?? r.aircraftId,
    date: formatDate(r.createdAt),
    self: selfId !== null && r.userId === selfId,
  }));
}

/** 自分の順位の一言（上位 100 に無ければ「圏外」） */
export function selfPlaceText(rows: readonly RankingRow[], selfId: string | null): string {
  const mine = selfId === null ? undefined : rows.find((r) => r.userId === selfId);
  return mine
    ? `あなたの順位: ${String(mine.place)} 位 / ${String(rows.length)} 人`
    : 'あなたの記録はまだありません（上位 100 位以内に入ると表示）';
}

export interface SaveSummary {
  readonly pilot: string;
  readonly credits: string;
  readonly cleared: string;
}

/** 競合のダイアログに出すセーブの要約（パイロット名・クレジット・クリアしたミッションの数）。形が違っても落ちない */
export function summarizeSave(data: unknown): SaveSummary {
  const o: Record<string, unknown> = typeof data === 'object' && data !== null ? { ...data } : {};
  const pilot = typeof o.pilotName === 'string' ? o.pilotName : '（未設定）';
  const credits = typeof o.credits === 'number' ? `${o.credits.toLocaleString('ja-JP')} CR` : '—';
  let cleared = 0;
  if (typeof o.missions === 'object' && o.missions !== null) {
    const missions: Record<string, unknown> = { ...o.missions };
    for (const m of Object.values(missions)) {
      if (typeof m === 'object' && m !== null && 'bestRank' in m && m.bestRank !== null) cleared++;
    }
  }
  return { pilot, credits, cleared: `クリア ${String(cleared)} 件` };
}

/** ISO → ローカルの「2026-11-01 14:05」（無ければ「不明」） */
export function formatDateTime(iso: string | null): string {
  if (iso === null) return '不明';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '不明';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${formatDate(iso)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
