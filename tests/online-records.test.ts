// 7-4: 記録の送信。不正値の事前チェック（SQL の check と同じ規則）・記録の形・キューの再送（最大 20）・送る条件
import { describe, expect, it } from 'vitest';
import { COURSES } from '../src/data/courses';
import { ONLINE_CLIENT_VERSION, rankedCourse } from '../src/data/online';
import { loadMeta } from '../src/online/meta';
import { defenseRecord, raceRecord, raidRecord } from '../src/online/outbox';
import { RecordQueue } from '../src/online/queue';
import {
  checkRecord,
  raceFloorMs,
  raceTheoreticalMinMs,
  type RecordInput,
} from '../src/online/records';
import { OnlineService, retryOutcome } from '../src/online/service';
import type { SaveAccess, SyncHooks } from '../src/online/sync';
import {
  MEMBER,
  ManualTimers,
  MemoryStorage,
  MockBackend,
  STRANGER,
  settle,
} from './online-helpers';

const race = (valueMs: number, key = 'coast'): RecordInput => ({
  kind: 'race',
  key,
  aircraftId: 'kestrel',
  valueMs,
  detail: {},
  clientVersion: ONLINE_CLIENT_VERSION,
});

describe('不正値の事前チェック', () => {
  it('レースはコースの理論最短 × 0.5 未満を拒否（ゴールドタイムよりずっと短い）', () => {
    for (const c of COURSES) {
      const floor = raceFloorMs(c.id) ?? 0;
      const min = raceTheoreticalMinMs(c.id) ?? 0;
      expect(floor).toBe(Math.floor(min * 0.5));
      expect(min, c.id).toBeLessThan(c.goldTimeSeconds * 1000);
      // 9-8: ランキングの準備ができていないコース（SQL 0004 の前）は key で拒否
      if (!rankedCourse(c.id)) {
        expect(checkRecord(race(floor, c.id)), c.id).toBe('key');
        continue;
      }
      expect(checkRecord(race(floor, c.id))).toBeNull();
      expect(checkRecord(race(floor - 1, c.id))).toBe('raceTooFast');
    }
    expect(checkRecord(race(30000, 'no-such-course'))).toBe('key');
  });

  it('防衛戦は 11 波以上・司令部の範囲外・波の無い記録を拒否', () => {
    const d = (detail: RecordInput['detail']): RecordInput => ({
      kind: 'defense',
      key: 'island:normal',
      aircraftId: 'kestrel',
      valueMs: 600000,
      detail,
      clientVersion: ONLINE_CLIENT_VERSION,
    });
    expect(checkRecord(d({ waves: 10, hq: 100 }))).toBeNull();
    expect(checkRecord(d({ waves: 0, hq: 0 }))).toBeNull();
    expect(checkRecord(d({ waves: 11, hq: 50 }))).toBe('waves');
    expect(checkRecord(d({ waves: 2.5, hq: 50 }))).toBe('waves');
    expect(checkRecord(d({ hq: 50 }))).toBe('waves');
    expect(checkRecord(d({ waves: 3, hq: 101 }))).toBe('hq');
    expect(checkRecord({ ...d({ waves: 3, hq: 5 }), key: 'moon:normal' })).toBe('key');
  });

  it('値の範囲（1 ミリ秒〜1 時間の整数）・機体 id・版', () => {
    const r: RecordInput = { ...race(20000), kind: 'raid', key: 'hard' };
    expect(checkRecord(r)).toBeNull();
    expect(checkRecord({ ...r, valueMs: 0 })).toBe('value');
    expect(checkRecord({ ...r, valueMs: 1.5 })).toBe('value');
    expect(checkRecord({ ...r, valueMs: 3600001 })).toBe('value');
    expect(checkRecord({ ...r, aircraftId: 'Kestrel!' })).toBe('aircraft');
    expect(checkRecord({ ...r, clientVersion: '' })).toBe('version');
  });
});

describe('記録の形', () => {
  it('レースは完走だけ（時間切れは送らない）。タイムはペナルティ・ボーナス込みのミリ秒', () => {
    const base = { courseId: 'coast', time: 50.1234, missed: 1, thinPassed: 2 };
    expect(raceRecord({ ...base, outcome: 'timeout' }, 'kestrel')).toBeNull();
    expect(raceRecord({ ...base, outcome: 'finished' }, 'kestrel')).toMatchObject({
      kind: 'race',
      key: 'coast',
      valueMs: 50123,
      detail: { missed: 1, thin: 2 },
    });
  });

  it('レイドは難易度ごと、防衛戦はマップ:難易度・波・司令部 %', () => {
    expect(raidRecord('hard', 245.5, 'swift', 'A')).toMatchObject({
      key: 'hard',
      valueMs: 245500,
      detail: { rank: 'A' },
    });
    const d = defenseRecord(
      {
        mapId: 'harbor',
        difficulty: 'normal',
        outcome: 'failed',
        wavesCleared: 6,
        hqHp: -10,
        hqMaxHp: 2000,
        kills: 30,
      },
      612.3,
      'kestrel',
    );
    expect(d).toMatchObject({
      key: 'harbor:normal',
      valueMs: 612300,
      detail: { waves: 6, hq: 0, cleared: false },
    });
    expect(checkRecord(d)).toBeNull();
  });
});

describe('再送キュー', () => {
  it('古い順に送り、retry で止める。drop（サーバーが拒否）は捨てる', async () => {
    const q = new RecordQueue([race(20001), race(20002), race(20003)]);
    const outcomes = ['sent', 'drop', 'retry'] as const;
    let i = 0;
    const res = await q.flush(() => Promise.resolve(outcomes[i++] ?? 'sent'));
    expect(res).toEqual({ sent: 1, dropped: 1, left: 1 });
    expect(q.list.map((r) => r.valueMs)).toEqual([20003]);
  });

  it('最大 20 件。超えたら古いものから捨てる', () => {
    const q = new RecordQueue([]);
    for (let k = 0; k < 25; k++) q.push(race(20000 + k));
    expect(q.size).toBe(20);
    expect(q.list[0]?.valueMs).toBe(20005);
  });

  it('不正値・権限は捨て、通信・レート制限・不明は後で送り直す', () => {
    expect(retryOutcome('invalid')).toBe('drop');
    expect(retryOutcome('denied')).toBe('drop');
    expect(retryOutcome('network')).toBe('retry');
    expect(retryOutcome('rate')).toBe('retry');
    expect(retryOutcome('unknown')).toBe('retry');
  });
});

function service(
  user: typeof MEMBER | null,
  storage = new MemoryStorage(),
  backend = new MockBackend(),
) {
  backend.user = user;
  const save: SaveAccess = {
    data: () => ({}),
    version: 8,
    apply: () => true,
    reload: () => undefined,
  };
  const hooks: SyncHooks = {
    ask: () => Promise.resolve(null),
    whenSafe: (fn) => {
      fn();
    },
    report: () => undefined,
  };
  return {
    backend,
    storage,
    svc: new OnlineService(backend, storage, save, hooks, () => 'ACE', new ManualTimers()),
  };
}

describe('記録の送信（OnlineService）', () => {
  it('通信に失敗した記録はキューに残り、端末にも保存され、次の起動で送り直す', async () => {
    const a = service(MEMBER);
    await a.svc.start();
    a.backend.recordFailures = ['network'];
    a.svc.submitRecord(race(20000));
    await settle();
    expect(a.backend.records).toHaveLength(0);
    expect(a.svc.queued).toBe(1);
    expect(loadMeta(a.storage).queue).toHaveLength(1);

    // 次の起動: 同じ端末の状態から始めて、ログイン済みなら送る
    const b = service(MEMBER, a.storage, a.backend);
    await b.svc.start();
    await settle();
    expect(b.backend.records.map((r) => r.valueMs)).toEqual([20000]);
    expect(b.svc.queued).toBe(0);
  });

  it('次の記録のときに、残っていた記録から順に送る', async () => {
    const a = service(MEMBER);
    await a.svc.start();
    await settle();
    a.backend.recordFailures = ['rate'];
    a.svc.submitRecord(race(20000));
    await settle();
    a.svc.submitRecord(race(20001));
    await settle();
    expect(a.backend.records.map((r) => r.valueMs)).toEqual([20000, 20001]);
  });

  it('サーバーが拒否した記録は捨てる。事前チェックに通らない記録は送らない', async () => {
    const a = service(MEMBER);
    await a.svc.start();
    a.backend.recordFailures = ['invalid'];
    a.svc.submitRecord(race(20000));
    a.svc.submitRecord(race(10));
    await settle();
    expect(a.svc.queued).toBe(0);
    expect(a.backend.records).toHaveLength(0);
  });

  it('未連携・承認待ち・オンライン連携 OFF のときは送らず、キューにも入れない', async () => {
    for (const user of [null, STRANGER]) {
      const a = service(user);
      await a.svc.start();
      a.svc.submitRecord(race(20000));
      await settle();
      expect(a.svc.queued).toBe(0);
      expect(a.backend.records).toHaveLength(0);
    }
    const off = service(MEMBER);
    await off.svc.start();
    off.svc.setEnabled(false);
    off.svc.submitRecord(race(20000));
    await settle();
    expect(off.svc.queued).toBe(0);
    expect(off.backend.records).toHaveLength(0);
  });

  it('ランキングは連携中で ON のときだけ取りに行き、5 分はキャッシュする', async () => {
    const a = service(MEMBER);
    await a.svc.start();
    const q = { kind: 'raid', key: 'normal' } as const;
    await a.svc.ranking(q);
    await a.svc.ranking(q);
    expect(a.backend.fetchRanking).toHaveBeenCalledTimes(1);
    a.svc.setEnabled(false);
    expect(await a.svc.ranking({ kind: 'raid', key: 'hard' })).toEqual([]);
    expect(a.backend.fetchRanking).toHaveBeenCalledTimes(1);
  });

  it('コードでログイン（違うコードは code のエラー）', async () => {
    const a = service(null);
    await a.svc.start();
    await expect(a.svc.verifyCode('pilot@example.com', '000000')).rejects.toMatchObject({
      kind: 'code',
    });
    await a.svc.verifyCode('pilot@example.com', '123456');
    expect(a.svc.status).toMatchObject({ state: 'linked', email: 'pilot@example.com' });
    await a.svc.signOut();
    expect(a.svc.status.state).toBe('signedOut');
  });
});
