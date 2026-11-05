// 日替わりチャレンジ（9-9）のスコアの送信とランキング: まだ送っていない最高だけを送る・失敗は残して送り直す・拒否は飛ばす・
// サーバーの準備（SQL 0005）までは送らない・オフラインで遊んだ日もつながったら送る。SQL 0005 の静的な確認（値の範囲をクライアントと突き合わせる）
import { describe, expect, it } from 'vitest';
import sqlRaw from '../supabase/migrations/skyraid_0005_daily.sql?raw';
import { DAILY_CONFIG, DAILY_KINDS } from '../src/data/daily';
import { DAILY_RANKING_ENABLED, ONLINE_CLIENT_VERSION, ONLINE_CONFIG } from '../src/data/online';
import { dailySpecKey, dailySpecOf, parseDailyDayKey } from '../src/missions/daily/schedule';
import { dailyChannel } from '../src/online/daily-channel';
import {
  DAILY_RACE_FLOOR_MS,
  DAILY_SPEC_PATTERN,
  DailySender,
  checkDailyScore,
  dailyScoreOf,
  parseDailyRows,
  type DailyScoreInput,
} from '../src/online/daily-scores';
import { raceFloorMs } from '../src/online/records';
import {
  DAILY_PRESETS,
  defaultDailyRecords,
  markDailySent,
  recordDaily,
  unsentDaily,
  type DailyRecords,
} from '../src/progression/daily-records';
import { MockBackend } from './online-helpers';

const sql = sqlRaw.replace(/--[^\n]*/g, '');

const score = (o: Partial<DailyScoreInput> = {}): DailyScoreInput => ({
  day: '2026-11-05',
  spec: '1:targets:2:kestrel:day-clear',
  kind: 'targets',
  value: 1234,
  preset: 'normal',
  aircraftId: 'kestrel',
  clientVersion: ONLINE_CLIENT_VERSION,
  ...o,
});

function setup(today = '2026-11-05') {
  const records: DailyRecords = defaultDailyRecords();
  const backend = new MockBackend();
  let user: string | null = 'u1';
  let enabled = true;
  let now = 0;
  const sender = new DailySender(
    backend,
    {
      unsent: () => unsentDaily(records, today),
      markSent: (day, value) => {
        markDailySent(records, day, value);
      },
    },
    () => user,
    () => enabled,
    ONLINE_CLIENT_VERSION,
    () => now,
  );
  const play = (day: string, value: number | null, kind: 'targets' | 'race' = 'targets') =>
    recordDaily(records, {
      day,
      spec: `1:${kind}:2:kestrel:day-clear`,
      kind,
      value,
      preset: 'easy',
      at: 0,
    });
  return {
    records,
    backend,
    sender,
    play,
    setUser: (u: string | null) => {
      user = u;
    },
    setEnabled: (e: boolean) => {
      enabled = e;
    },
    tick: (ms: number) => {
      now += ms;
    },
  };
}

describe('送る前の確かめ（SQL の check と同じ）', () => {
  it('正しい形は通る・壊れた値は理由を返す', () => {
    expect(checkDailyScore(score())).toBeNull();
    expect(checkDailyScore(score({ day: '2026/11/05' }))).toBe('day');
    expect(checkDailyScore(score({ spec: '1:race:2:kestrel:day-clear' }))).toBe('spec');
    expect(checkDailyScore(score({ spec: '1:targets:4:kestrel:day-clear' }))).toBe('spec');
    expect(checkDailyScore(score({ value: -1 }))).toBe('value');
    expect(checkDailyScore(score({ value: DAILY_CONFIG.scoreMax + 1 }))).toBe('value');
    expect(checkDailyScore(score({ value: 1.5 }))).toBe('value');
    const race = score({ kind: 'race', spec: '1:race:1:kestrel:day-clear' });
    expect(checkDailyScore({ ...race, value: DAILY_RACE_FLOOR_MS })).toBeNull();
    expect(checkDailyScore({ ...race, value: DAILY_RACE_FLOOR_MS - 1 })).toBe('value');
    expect(checkDailyScore({ ...race, value: ONLINE_CONFIG.valueMaxMs + 1 })).toBe('value');
  });

  it('計算で選ばれる条件の見出しは、どれも SQL の形に合う', () => {
    const start = parseDailyDayKey('2026-11-01') ?? 0;
    for (let i = 0; i < 400; i++)
      expect(dailySpecKey(dailySpecOf(start + i))).toMatch(DAILY_SPEC_PATTERN);
  });

  it('サーバーの行の形を確かめる', () => {
    const rows = parseDailyRows([
      {
        user_id: 'a',
        display_name: 'A',
        value: '120',
        preset: 'hard',
        aircraft_id: 'swift',
        created_at: 'x',
        place: 1,
      },
      {
        user_id: 'b',
        display_name: null,
        value: 99,
        preset: '??',
        aircraft_id: 'swift',
        created_at: 'x',
        place: '2',
      },
    ]);
    expect(rows[0]).toMatchObject({ value: 120, preset: 'hard', place: 1 });
    expect(rows[1]).toMatchObject({ displayName: null, preset: 'custom', place: 2 });
    expect(() => parseDailyRows([{ user_id: 1 }])).toThrow();
    expect(() => parseDailyRows({})).toThrow();
  });
});

describe('送信（まだ送っていない最高だけ）', () => {
  it('つながったら、オフラインで遊んだ日も含めて古い順に送り、送った印を付ける', async () => {
    const s = setup();
    s.setUser(null);
    s.play('2026-11-03', 500);
    s.play('2026-11-05', 800);
    await s.sender.flush();
    expect(s.backend.dailyScores).toHaveLength(0);
    s.setUser('u1');
    await s.sender.flush();
    expect(s.backend.dailyScores.map((r) => [r.day, r.value, r.preset])).toEqual([
      ['2026-11-03', 500, 'easy'],
      ['2026-11-05', 800, 'easy'],
    ]);
    // 2 回目は何も送らない。最高を更新したらその日だけ送る
    await s.sender.flush();
    expect(s.backend.dailyScores).toHaveLength(2);
    s.play('2026-11-05', 700);
    await s.sender.flush();
    expect(s.backend.dailyScores).toHaveLength(2);
    s.play('2026-11-05', 900);
    await s.sender.flush();
    expect(s.backend.dailyScores.at(-1)).toMatchObject({ day: '2026-11-05', value: 900 });
  });

  it('通信の失敗は送った印を付けずに止める（次に送り直す）。拒否は飛ばす', async () => {
    const s = setup();
    s.play('2026-11-04', 10);
    s.play('2026-11-05', 20);
    s.backend.dailyFailures = ['network'];
    await s.sender.flush();
    expect(s.backend.dailyScores).toHaveLength(0);
    expect(unsentDaily(s.records, '2026-11-05')).toHaveLength(2);
    s.backend.dailyFailures = ['invalid'];
    await s.sender.flush();
    expect(s.backend.dailyScores.map((r) => r.day)).toEqual(['2026-11-05']);
    expect(unsentDaily(s.records, '2026-11-05')).toHaveLength(0);
  });

  it('サーバーの準備（SQL 0005）ができるまでは送らない・ランキングも読まない', async () => {
    const s = setup();
    s.setEnabled(false);
    s.play('2026-11-05', 20);
    await s.sender.flush();
    expect(s.backend.dailyScores).toHaveLength(0);
    expect(await s.sender.ranking('2026-11-05', 'k')).toEqual([]);
    expect(s.backend.fetchDailyRanking).not.toHaveBeenCalled();
    // 9-10 の事前修正: SQL 0005 を流したので今の版は送る
    expect(DAILY_RANKING_ENABLED).toBe(true);
  });

  it('時間切れのレース（最高なし）・完走していない日は送らない', async () => {
    const s = setup();
    s.play('2026-11-05', null, 'race');
    await s.sender.flush();
    expect(s.backend.dailyScores).toHaveLength(0);
    const e = s.records.days['2026-11-05'];
    if (!e) throw new Error('entry');
    expect(dailyScoreOf('2026-11-05', e, ONLINE_CLIENT_VERSION)).toBeNull();
  });

  it('ランキングは 5 分キャッシュ・自分が送った後は取り直す', async () => {
    const s = setup();
    await s.sender.ranking('2026-11-05', '1:targets:2:kestrel:day-clear');
    await s.sender.ranking('2026-11-05', '1:targets:2:kestrel:day-clear');
    expect(s.backend.fetchDailyRanking).toHaveBeenCalledTimes(1);
    s.play('2026-11-05', 5);
    await s.sender.flush();
    await s.sender.ranking('2026-11-05', '1:targets:2:kestrel:day-clear');
    expect(s.backend.fetchDailyRanking).toHaveBeenCalledTimes(2);
    s.tick(ONLINE_CONFIG.rankingCacheMs + 1);
    await s.sender.ranking('2026-11-05', '1:targets:2:kestrel:day-clear');
    expect(s.backend.fetchDailyRanking).toHaveBeenCalledTimes(3);
  });

  it('つなぎ（dailyChannel）: つながる前は何もしない・出どころは後から差し込める', async () => {
    expect(dailyChannel.active).toBe(false);
    expect(await dailyChannel.ranking('2026-11-05', 'x')).toEqual([]);
    await dailyChannel.flush();
    const records = defaultDailyRecords();
    recordDaily(records, {
      day: '2026-11-05',
      spec: '1:targets:1:kestrel:day-clear',
      kind: 'targets',
      value: 3,
      preset: 'hard',
      at: 0,
    });
    dailyChannel.setSource({
      unsent: () => unsentDaily(records, '2026-11-05'),
      markSent: (d, v) => {
        markDailySent(records, d, v);
      },
    });
    expect(dailyChannel.source.unsent()).toHaveLength(1);
    dailyChannel.source.markSent('2026-11-05', 3);
    expect(dailyChannel.source.unsent()).toHaveLength(0);
  });
});

describe('マイグレーション 0005（日替わりのランキング）', () => {
  const statements = sql
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);

  it('begin / commit・skyraid の中だけ・RLS の enable と force・anon に権限なし・適用の記録', () => {
    expect(statements[0]).toBe('begin');
    expect(statements.at(-1)).toBe('commit');
    expect(sql).not.toMatch(/\b(public|storage)\./);
    expect(sql).not.toMatch(/auth\.users/);
    expect(sql).toContain('alter table skyraid.daily_scores enable row level security');
    expect(sql).toContain('alter table skyraid.daily_scores force row level security');
    expect(sql).toContain('revoke all on table skyraid.daily_scores from anon');
    expect(sql).toContain('revoke all on table skyraid.daily_best from anon');
    expect(sql).not.toMatch(/grant[^;]*to anon/);
    expect(sql).toContain('with (security_invoker = true)');
    expect(sql).toContain(
      "insert into skyraid.schema_migrations (version) values ('skyraid_0005_daily') on conflict do nothing",
    );
    // authenticated のポリシーはすべて has_app_access を確かめる
    const policies =
      sql.match(/create policy \w+ on skyraid\.daily_scores[^;]*to authenticated[^;]*/g) ?? [];
    expect(policies).toHaveLength(2);
    for (const p of policies) expect(p).toContain('skyraid.has_app_access()');
    // トリガの関数は API から呼べない
    for (const f of ['daily_scores_before_insert', 'daily_scores_after_insert'])
      expect(sql).toContain(`revoke all on function skyraid.${f}() from anon, authenticated`);
  });

  it('クライアントと同じ値: 種類・補助の組・スコアの上限・レースの下限・送り直す日数・上位の数', () => {
    expect(sql).toContain(`kind in (${DAILY_KINDS.map((k) => `'${k}'`).join(', ')})`);
    expect(sql).toContain(`preset in (${DAILY_PRESETS.map((k) => `'${k}'`).join(', ')})`);
    expect(sql).toContain(`value between 0 and ${String(DAILY_CONFIG.scoreMax)}`);
    expect(DAILY_RACE_FLOOR_MS).toBe((raceFloorMs('coast') ?? 0) * 2);
    expect(sql).toContain(
      `value between ${String(DAILY_RACE_FLOOR_MS)} and ${String(ONLINE_CONFIG.valueMaxMs)}`,
    );
    expect(sql).toContain(`new.day < today - ${String(DAILY_CONFIG.sendDays - 1)}`);
    expect(sql).toContain(`x.n <= ${String(DAILY_CONFIG.rankingTop)}`);
    expect(sql).toContain(`>= ${String(ONLINE_CONFIG.recordsPerMinute)} then`);
    expect(sql).toContain("(now() at time zone 'Asia/Tokyo')::date");
    expect(DAILY_CONFIG.dayOffsetMs).toBe(9 * 3600 * 1000);
  });
});
