// 日替わりチャレンジ（9-9）: 日付から決まる条件（日本時間の 0 時の切り替え・端末の時間帯・言語によらない・決まった値）、
// 条件 → 練習場の課題 / 周回のコース、その日の最高と連続日数のセーブ
import { afterEach, describe, expect, it } from 'vitest';
import { findAircraftModel } from '../src/data/aircraft';
import { findCourse } from '../src/data/courses';
import { DAILY_CONFIG, DAILY_KINDS } from '../src/data/daily';
import { findWeather } from '../src/data/weather';
import { useLocale } from './i18n-helpers';
import {
  dailyDayKey,
  dailyDayNumber,
  dailySpecAt,
  dailySpecKey,
  dailySpecOf,
  hash32,
  parseDailyDayKey,
  parseDailySpec,
  todayKey,
} from '../src/missions/daily/schedule';
import {
  dailyBetter,
  dailyCourse,
  dailyLaps,
  dailyPractice,
  dailyRaceValue,
} from '../src/missions/daily/setup';
import {
  currentStreak,
  defaultDailyRecords,
  markDailySent,
  normalizeDailyRecords,
  recordDaily,
  unsentDaily,
} from '../src/progression/daily-records';
import './i18n-setup';

const at = (iso: string): number => Date.parse(iso);

describe('日の切り替え（日本時間の 0 時）', () => {
  it('UTC の 15:00 で次の日になる（日本時間の 0 時）', () => {
    expect(todayKey(at('2026-11-04T14:59:59.999Z'))).toBe('2026-11-04');
    expect(todayKey(at('2026-11-04T15:00:00.000Z'))).toBe('2026-11-05');
    expect(todayKey(at('2026-11-05T00:00:00+09:00'))).toBe('2026-11-05');
    expect(todayKey(at('2026-11-05T23:59:59+09:00'))).toBe('2026-11-05');
    // 年・閏年の境目
    expect(todayKey(at('2026-12-31T15:00:00Z'))).toBe('2027-01-01');
    expect(todayKey(at('2028-02-28T15:00:00Z'))).toBe('2028-02-29');
  });

  it('日付の文字列と通し日数は行き来できる・壊れた日付は読まない', () => {
    for (const d of [0, 20000, 20762, 30000]) expect(parseDailyDayKey(dailyDayKey(d))).toBe(d);
    for (const bad of ['2026-02-30', '2026-13-01', '26-11-05', 'x', '2026-11-5'])
      expect(parseDailyDayKey(bad), bad).toBeNull();
    expect(dailyDayNumber(at('2026-11-05T00:00:00+09:00'))).toBe(parseDailyDayKey('2026-11-05'));
  });
});

describe('条件は端末・言語・時間帯をまたいで同じ', () => {
  const tz = process.env.TZ;
  afterEach(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
    useLocale('ja');
  });

  it('端末の時間帯を変えても、同じ時刻なら同じ日・同じ条件', () => {
    const times = [
      '2026-11-04T14:59:59Z',
      '2026-11-04T15:00:00Z',
      '2026-11-05T08:30:00Z',
      '2026-11-05T14:59:00Z',
    ].map(at);
    const zones = [
      'Asia/Tokyo',
      'UTC',
      'America/Los_Angeles',
      'Pacific/Kiritimati',
      'Pacific/Pago_Pago',
    ];
    const base = times.map((ms) => JSON.stringify(dailySpecAt(ms)));
    for (const z of zones) {
      process.env.TZ = z;
      // 端末の時間帯が効いていることを確かめる（getTimezoneOffset が変わる）
      expect(
        times.map((ms) => JSON.stringify(dailySpecAt(ms))),
        z,
      ).toEqual(base);
    }
  });

  it('言語を変えても条件（と見出し）は同じ', () => {
    const ms = at('2026-11-05T03:00:00Z');
    useLocale('ja');
    const ja = dailySpecKey(dailySpecAt(ms));
    useLocale('en');
    expect(dailySpecKey(dailySpecAt(ms))).toBe(ja);
  });

  it('決まった値（計算を変えたら版を上げる。整数の演算だけなので端末で変わらない）', () => {
    expect(hash32('')).toBe(0x811c9dc5);
    expect(hash32('skyraid')).toBe(hash32('skyraid'));
    const keys = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2027-01-01'].map((k) =>
      dailySpecKey(dailySpecOf(parseDailyDayKey(k) ?? 0)),
    );
    expect(keys).toEqual([
      '1:drones:2:vector:day-clear',
      '1:gauntlet:2:kestrel:evening-clear',
      '1:drones:3:kestrel:evening-clear',
      '1:gauntlet:3:bastion:day-overcast',
      '1:drones:3:swift:dawn-clear',
    ]);
  });
});

describe('条件の選び方', () => {
  const days = Array.from({ length: 730 }, (_, i) => (parseDailyDayKey('2026-11-01') ?? 0) + i);
  const specs = days.map((d) => dailySpecOf(d));

  it('種類は 4 日ごとに 4 種類が一巡し、続けて同じ種類にならない', () => {
    specs.forEach((s, i) => {
      const prev = specs[i - 1];
      if (prev) expect(s.kind, s.day).not.toBe(prev.kind);
      const day = days[i] ?? 0;
      if (day % 4 === 0) {
        const block = specs.slice(i, i + 4).map((x) => x.kind);
        if (block.length === 4) expect(new Set(block).size).toBe(4);
      }
    });
  });

  it('難しさ・機体・天候は候補の中から、どれも出る', () => {
    for (const s of specs) {
      expect(DAILY_KINDS).toContain(s.kind);
      expect(DAILY_CONFIG.aircraft).toContain(s.aircraftId);
      expect(findAircraftModel(s.aircraftId)).not.toBeNull();
      expect(DAILY_CONFIG.weathers[s.kind]).toContain(s.weatherId);
      expect(findWeather(s.weatherId).id).toBe(s.weatherId);
      expect(s.version).toBe(DAILY_CONFIG.version);
    }
    expect(new Set(specs.map((s) => s.tier)).size).toBe(3);
    expect(new Set(specs.map((s) => s.aircraftId)).size).toBe(4);
    for (const k of DAILY_KINDS)
      expect(new Set(specs.filter((s) => s.kind === k).map((s) => s.weatherId)).size).toBe(
        DAILY_CONFIG.weathers[k].length,
      );
  });

  it('見出しと読み直し（壊れた値は null）', () => {
    const s = dailySpecOf(days[3] ?? 0);
    expect(dailySpecKey(s).split(':')).toHaveLength(5);
    expect(parseDailySpec(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(parseDailySpec({ ...s, kind: 'x' })).toBeNull();
    expect(parseDailySpec({ ...s, tier: 4 })).toBeNull();
    expect(parseDailySpec({ ...s, day: '2026-02-31' })).toBeNull();
    expect(parseDailySpec(null)).toBeNull();
  });
});

describe('条件 → 今ある仕組み', () => {
  it('的の課題は練習場の課題の長さ・的の数・速さ・敵の飛び方を差し替える（2〜2.5 分）', () => {
    expect(dailyPractice({ kind: 'targets', tier: 3 })).toEqual({
      drill: 'static',
      options: { duration: 120, targetCount: 5 },
    });
    expect(dailyPractice({ kind: 'drones', tier: 2 })).toEqual({
      drill: 'moving',
      options: { duration: 120, droneSpeedScale: 1.2 },
    });
    expect(dailyPractice({ kind: 'gauntlet', tier: 1 })).toEqual({
      drill: 'bandit',
      options: { duration: 150, banditDifficulty: 'rookie' },
    });
    expect(dailyPractice({ kind: 'race', tier: 1 })).toBeNull();
    for (const d of Object.values(DAILY_CONFIG.durations)) {
      expect(d).toBeGreaterThanOrEqual(120);
      expect(d).toBeLessThanOrEqual(300);
    }
  });

  it('レースは海岸周回のリングを周回の数だけ並べる（ゴールドタイムで 1.6〜3.2 分、制限時間は 5 分以上）', () => {
    const coast = findCourse('coast');
    if (!coast) throw new Error('coast');
    for (const tier of [1, 2, 3] as const) {
      const c = dailyCourse({ kind: 'race', tier, weatherId: 'night-clear' });
      if (!c) throw new Error('course');
      const laps = dailyLaps({ kind: 'race', tier });
      expect(laps).toBe(tier + 1);
      expect(c.rings).toHaveLength(coast.rings.length * laps);
      expect(c.rings[coast.rings.length]).toEqual(coast.rings[0]);
      expect(c.weatherId).toBe('night-clear');
      expect(c.start).toEqual(coast.start);
      expect(c.goldTimeSeconds / 60).toBeGreaterThanOrEqual(1.5);
      expect(c.goldTimeSeconds / 60).toBeLessThanOrEqual(5);
      expect(c.timeLimitSeconds).toBe(coast.timeLimitSeconds * laps);
    }
    // 最後のリングから最初のリングへは前向きにまっすぐ（周回のつなぎ目。約 1.7km）
    const last = coast.rings.at(-1);
    const first = coast.rings[0];
    if (!last || !first) throw new Error('rings');
    const dist = Math.hypot(first.x - last.x, first.z - last.z);
    expect(dist).toBeGreaterThan(1200);
    expect(dist).toBeLessThan(2500);
    const heading = (Math.atan2(first.x - last.x, -(first.z - last.z)) * 180) / Math.PI;
    expect(Math.abs(heading - last.headingDeg)).toBeLessThan(45);
    expect(dailyCourse({ kind: 'targets', tier: 1, weatherId: 'day-clear' })).toBeNull();
  });

  it('スコアの数え方: 的の課題は大きいほど、レースは短いほど良い。時間切れのレースは記録なし', () => {
    expect(dailyBetter('targets', 500, 400)).toBe(true);
    expect(dailyBetter('targets', 400, 400)).toBe(false);
    expect(dailyBetter('race', 90000, 95000)).toBe(true);
    expect(dailyRaceValue({ outcome: 'timeout', time: 300 })).toBeNull();
    expect(dailyRaceValue({ outcome: 'finished', time: 101.2345 })).toBe(101235);
  });
});

describe('その日の最高と連続日数（records.daily）', () => {
  const play = (day: string, value: number | null, kind: 'targets' | 'race' = 'targets') => ({
    day,
    spec: `1:${kind}:2:kestrel:day-clear`,
    kind,
    value,
    preset: 'normal' as const,
    at: 1,
  });

  it('その日の最高だけを残す（的の課題は大きい方、レースは小さい方）・挑戦の回数', () => {
    const r = defaultDailyRecords();
    expect(recordDaily(r, play('2026-11-05', 300)).newBest).toBe(true);
    expect(recordDaily(r, play('2026-11-05', 200)).newBest).toBe(false);
    const o = recordDaily(r, { ...play('2026-11-05', 450), preset: 'easy' });
    expect(o.newBest).toBe(true);
    expect(o.previous).toBe(300);
    expect(r.days['2026-11-05']).toMatchObject({ best: 450, preset: 'easy', attempts: 3 });
    // 完走しなかった回は回数だけ
    recordDaily(r, play('2026-11-05', null));
    expect(r.days['2026-11-05']).toMatchObject({ best: 450, attempts: 4 });
    const race = defaultDailyRecords();
    recordDaily(race, play('2026-11-06', 120000, 'race'));
    expect(recordDaily(race, play('2026-11-06', 110000, 'race')).newBest).toBe(true);
    expect(recordDaily(race, play('2026-11-06', 115000, 'race')).newBest).toBe(false);
    expect(race.days['2026-11-06']?.best).toBe(110000);
  });

  it('連続日数: 次の日なら +1、同じ日は数えない、間が空いたら 1 から。昨日まで続いていれば今日も表示する', () => {
    const r = defaultDailyRecords();
    recordDaily(r, play('2026-11-05', 1));
    recordDaily(r, play('2026-11-05', 2));
    recordDaily(r, play('2026-11-06', null));
    expect(recordDaily(r, play('2026-11-07', 3)).streak).toBe(3);
    expect(currentStreak(r, '2026-11-07')).toBe(3);
    expect(currentStreak(r, '2026-11-08')).toBe(3);
    expect(currentStreak(r, '2026-11-09')).toBe(0);
    expect(recordDaily(r, play('2026-11-09', 3)).streak).toBe(1);
    // 月・年をまたぐ
    const y = defaultDailyRecords();
    recordDaily(y, play('2026-12-31', 1));
    expect(recordDaily(y, play('2027-01-01', 1)).streak).toBe(2);
  });

  it('古い日は keepDays を超えたら捨てる（連続日数は残る）', () => {
    const r = defaultDailyRecords();
    const start = parseDailyDayKey('2026-10-01') ?? 0;
    for (let i = 0; i < 30; i++) recordDaily(r, play(dailyDayKey(start + i), i));
    expect(Object.keys(r.days)).toHaveLength(DAILY_CONFIG.keepDays);
    expect(r.streak.count).toBe(30);
  });

  it('まだ送っていない最高（7 日以内・最高が送った値と違う日）と送った印', () => {
    const r = defaultDailyRecords();
    recordDaily(r, play('2026-10-20', 9));
    recordDaily(r, play('2026-11-01', 100));
    recordDaily(r, play('2026-11-05', 300));
    recordDaily(r, play('2026-11-04', null));
    expect(unsentDaily(r, '2026-11-05').map((u) => u.day)).toEqual(['2026-11-01', '2026-11-05']);
    markDailySent(r, '2026-11-05', 300);
    expect(unsentDaily(r, '2026-11-05').map((u) => u.day)).toEqual(['2026-11-01']);
    recordDaily(r, play('2026-11-05', 400));
    expect(unsentDaily(r, '2026-11-05').map((u) => u.day)).toEqual(['2026-11-01', '2026-11-05']);
  });

  it('読み込み: 壊れた日・値は捨てる、無ければ空', () => {
    expect(normalizeDailyRecords(undefined)).toEqual(defaultDailyRecords());
    const r = normalizeDailyRecords({
      days: {
        '2026-11-05': {
          spec: '1:race:2:kestrel:day-clear',
          kind: 'race',
          best: 1e5,
          preset: 'hard',
          attempts: 2,
        },
        '2026-02-31': { spec: 'x', kind: 'race' },
        '2026-11-04': { spec: '1:x', kind: 'nope' },
      },
      streak: { last: '2026-11-05', count: 4 },
    });
    expect(Object.keys(r.days)).toEqual(['2026-11-05']);
    expect(r.days['2026-11-05']).toMatchObject({
      best: 100000,
      preset: 'hard',
      attempts: 2,
      sent: null,
    });
    expect(r.streak).toEqual({ last: '2026-11-05', count: 4 });
  });
});
