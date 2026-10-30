import { describe, expect, it } from 'vitest';
import { MissionRunner } from '../src/missions/runner';
import { DT, FakeWorld, missionDef, record, run } from './mission-helpers';

describe('成功と失敗', () => {
  const survive = {
    id: 's',
    type: 'survive',
    required: true,
    start: 'withPrevious',
    seconds: 100,
  } as const;

  it('自機撃墜で失敗。報酬なし・ランクなし・未達成の目標は失敗', () => {
    const w = new FakeWorld();
    const r = new MissionRunner(missionDef({ objectives: [survive] }), w);
    const log = record(r);
    run((dt) => {
      r.step(dt);
    }, 1);
    w.playerDowns = 1;
    r.step(DT);
    expect(r.status).toBe('failed');
    expect(r.failReason).toBe('playerDown');
    expect(r.result?.credits).toBe(0);
    expect(r.result?.rank).toBeNull();
    expect(r.result?.objectives[0]?.status).toBe('failed');
    expect(log).not.toContain('mission:reward');
  });

  it('制限時間を過ぎると失敗。残り時間は 0 まで減る', () => {
    const w = new FakeWorld();
    const r = new MissionRunner(missionDef({ timeLimitSeconds: 3, objectives: [survive] }), w);
    run((dt) => {
      r.step(dt);
    }, 2.5);
    expect(r.timeLeft).toBeCloseTo(0.5, 5);
    run((dt) => {
      r.step(dt);
    }, 0.6);
    expect(r.failReason).toBe('timeUp');
    expect(r.result?.elapsedSeconds).toBeCloseTo(3, 5);
  });

  it('護衛対象の喪失で失敗', () => {
    const w = new FakeWorld();
    const r = new MissionRunner(missionDef({ objectives: [survive] }), w);
    r.step(DT);
    w.escortLost = true;
    r.step(DT);
    expect(r.failReason).toBe('escortLost');
  });

  it('戦域の外に 10 秒いると失敗。カウントの整数が変わるたびに知らせる', () => {
    const w = new FakeWorld();
    const r = new MissionRunner(missionDef({ objectives: [survive] }), w);
    const counts: number[] = [];
    r.bus.on('boundary:change', ({ outside, secondsLeft }) => {
      counts.push(outside ? Math.max(0, Math.ceil(secondsLeft - 1e-6)) : -1);
    });
    w.moveTo(0, 500, 6500);
    run((dt) => {
      r.step(dt);
    }, 9.9);
    expect(r.status).toBe('running');
    expect(r.boundary.outside).toBe(true);
    run((dt) => {
      r.step(dt);
    }, 0.2);
    expect(r.failReason).toBe('outOfBounds');
    expect(counts).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it('失敗条件に入っていなければ失敗しない（戦域離脱なし）', () => {
    const w = new FakeWorld();
    const r = new MissionRunner(missionDef({ failConditions: [], objectives: [survive] }), w);
    w.moveTo(0, 500, 9000);
    w.playerDowns = 3;
    run((dt) => {
      r.step(dt);
    }, 15);
    expect(r.status).toBe('running');
  });

  it('成功したらランクと報酬（基本額 × 倍率）を知らせる。終わってから 2 秒でリザルトへ', () => {
    const w = new FakeWorld();
    const r = new MissionRunner(
      missionDef({
        parTimeSeconds: 60,
        objectives: [{ ...survive, seconds: 2 }],
        reward: { baseCredits: 800 },
      }),
      w,
    );
    const rewards: number[] = [];
    r.bus.on('mission:reward', ({ credits }) => rewards.push(credits));
    run((dt) => {
      r.step(dt);
    }, 2.01);
    expect(r.result?.rank).toBe('S');
    expect(rewards).toEqual([1600]);
    expect(r.readyForResult).toBe(false);
    run((dt) => {
      r.step(dt);
    }, 2);
    expect(r.readyForResult).toBe(true);
    // 終わったあとは経過時間も止まる
    expect(r.result?.elapsedSeconds).toBeCloseTo(2, 1);
  });

  it('一時停止中は進まず、中断すると報酬もリザルトもない', () => {
    const w = new FakeWorld();
    const r = new MissionRunner(missionDef({ timeLimitSeconds: 5, objectives: [survive] }), w);
    const log = record(r);
    run((dt) => {
      r.step(dt);
    }, 1);
    r.pause();
    run((dt) => {
      r.step(dt);
    }, 10);
    expect(r.elapsed).toBeCloseTo(1, 5);
    r.resume();
    r.abort();
    expect(r.status).toBe('aborted');
    run((dt) => {
      r.step(dt);
    }, 5);
    expect(r.readyForResult).toBe(false);
    expect(log).toContain('mission:abort aborted');
    expect(log).not.toContain('mission:end failed');
  });
});
