// 7-4: 表示の整形（記録の値・日付・表示名・ランキングの行・入力）とランキングの 5 分キャッシュ
import { describe, expect, it, vi } from 'vitest';
import type { RankingRow } from '../src/online/backend';
import {
  formatDate,
  formatMs,
  formatRecordValue,
  isEmail,
  rankingLines,
  sanitizeDisplayName,
  selfPlaceText,
  summarizeSave,
} from '../src/online/format';
import { RankingCache } from '../src/online/ranking-cache';

const row = (userId: string, place: number, valueMs: number): RankingRow => ({
  userId,
  displayName: userId === 'c' ? null : userId.toUpperCase(),
  aircraftId: 'kestrel',
  valueMs,
  detail: {},
  createdAt: '2026-11-01T03:00:00Z',
  place,
});

describe('記録の値と日付', () => {
  it('ミリ秒 → 1:23.456 / 23.456', () => {
    expect(formatMs(83456)).toBe('1:23.456');
    expect(formatMs(23456)).toBe('23.456');
    expect(formatMs(60000)).toBe('1:00.000');
    expect(formatMs(5)).toBe('0.005');
  });

  it('防衛戦は波と司令部の残り、ほかはタイム', () => {
    expect(formatRecordValue('defense', 600000, { waves: 10, hq: 85 })).toBe('10 波・司令部 85%');
    expect(formatRecordValue('race', 48123, {})).toBe('48.123');
    expect(formatRecordValue('raid', 245000, {})).toBe('4:05.000');
  });

  it('日付はローカルの YYYY-MM-DD。読めなければ空', () => {
    expect(formatDate('2026-11-01T12:00:00')).toBe('2026-11-01');
    expect(formatDate('x')).toBe('');
  });
});

describe('入力の整え', () => {
  it('表示名: 制御文字を除き前後の空白を落とし 16 文字まで、空は null', () => {
    expect(sanitizeDisplayName('  エース\u0007 ')).toBe('エース');
    expect(sanitizeDisplayName('a'.repeat(20))).toBe('a'.repeat(16));
    expect(sanitizeDisplayName('   ')).toBeNull();
    // コードポイントで数える（SQL の char_length と同じ）
    expect(sanitizeDisplayName('😀'.repeat(17))).toBe('😀'.repeat(16));
  });

  it('メールの形', () => {
    expect(isEmail('pilot@example.com')).toBe(true);
    expect(isEmail('pilot@example')).toBe(false);
    expect(isEmail('a b@example.com')).toBe(false);
  });
});

describe('ランキングの行', () => {
  const rows = [row('a', 1, 40000), row('b', 2, 41000), row('c', 2, 41000)];

  it('自分の行に印、名前が無ければ（名前なし）、機体名を出す', () => {
    const lines = rankingLines('race', rows, 'b');
    expect(lines.map((l) => l.self)).toEqual([false, true, false]);
    expect(lines[0]).toMatchObject({ place: '1', name: 'A', value: '40.000', aircraft: 'Kestrel' });
    expect(lines[2]?.name).toBe('（名前なし）');
    expect(rankingLines('race', rows, null).some((l) => l.self)).toBe(false);
  });

  it('自分の順位の一言', () => {
    expect(selfPlaceText(rows, 'b')).toBe('あなたの順位: 2 位 / 3 人');
    expect(selfPlaceText(rows, 'z')).toContain('まだありません');
  });

  it('競合のダイアログのセーブの要約（形が違っても落ちない）', () => {
    const s = summarizeSave({
      pilotName: 'ACE',
      credits: 12345,
      missions: { m1: { bestRank: 'S' }, m2: { bestRank: null } },
    });
    expect(s).toEqual({ pilot: 'ACE', credits: '12,345 CR', cleared: 'クリア 1 件' });
    expect(summarizeSave(null)).toEqual({
      pilot: '（未設定）',
      credits: '—',
      cleared: 'クリア 0 件',
    });
  });
});

describe('ランキングの 5 分キャッシュ', () => {
  it('5 分以内は取り直さない。過ぎたら取り直す。記録を送ったら invalidate', async () => {
    let now = 0;
    const cache = new RankingCache(() => now);
    const fetch = vi.fn(() => Promise.resolve([row('a', 1, 1)]));
    const q = { kind: 'race', key: 'coast', aircraftId: 'kestrel' } as const;
    await cache.get(q, fetch);
    now = 4 * 60 * 1000;
    await cache.get(q, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    // 機体が違えば別のランキング
    await cache.get({ ...q, aircraftId: 'falcon' }, fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
    now = 5 * 60 * 1000 + 1;
    await cache.get(q, fetch);
    expect(fetch).toHaveBeenCalledTimes(3);
    cache.invalidate(q);
    await cache.get(q, fetch);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('取得に失敗したらキャッシュしない（例外はそのまま）', async () => {
    const cache = new RankingCache(() => 0);
    const q = { kind: 'raid', key: 'normal' } as const;
    await expect(cache.get(q, () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    const ok = vi.fn(() => Promise.resolve([]));
    await cache.get(q, ok);
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
