// 日替わりチャレンジ（9-9）のリプレイ: 条件（ヘッダの daily）から同じ課題・同じコースを組み立て、記録と 2 回の再生で全ステップの状態ハッシュと
// 結果（スコア・タイム）が一致する。条件は本当に効いている（長さ・的の数・ドローンの速さ・敵の飛び方・周回）
import { describe, expect, it, vi } from 'vitest';
import { DAILY_CONFIG } from '../src/data/daily';
import { PRACTICE_CONFIG } from '../src/data/practice';
import type { DailySpec } from '../src/missions/daily/schedule';
import { decodeReplay, encodeReplay } from '../src/replay/codec';
import { startFromHeader } from '../src/replay/sim';
import type { ReplayStart } from '../src/replay/types';
import { BASE_START, createWorld, record, replay } from './replay-helpers';

const spec = (kind: DailySpec['kind'], tier: DailySpec['tier']): DailySpec => ({
  day: '2026-11-05',
  kind,
  tier,
  aircraftId: 'swift',
  weatherId: 'day-clear',
  version: DAILY_CONFIG.version,
});

const DRILLS = { targets: 'static', drones: 'moving', gauntlet: 'bandit' } as const;

/** 本番の flight-start.ts と同じ形のヘッダ（機体は条件の機体・強化なし） */
function header(d: DailySpec, seed = 99): ReplayStart {
  const base: ReplayStart = {
    ...BASE_START,
    aircraftId: d.aircraftId,
    upgrades: { engine: 0, airframe: 0, weapons: 0, avionics: 0 },
    weatherId: d.weatherId,
    seed,
    daily: d,
  };
  if (d.kind === 'race')
    return {
      ...base,
      mode: 'race',
      mapId: 'island',
      courseId: 'daily-coast-2',
      raceReference: null,
    };
  return {
    ...base,
    mode: 'practice',
    mapId: 'island',
    practiceDrill: DRILLS[d.kind],
    practiceAspect: 2.16,
  };
}

const firstMismatch = (a: readonly string[], b: readonly string[]): number => {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  return a.findIndex((h, i) => h !== b[i]);
};

describe('日替わりの条件が課題に効く', () => {
  it('的あて・動く的・敵機の連戦・周回レース', () => {
    const w = createWorld();
    startFromHeader(w, header(spec('targets', 3)));
    const p = w.play.practice;
    expect(p?.duration).toBe(120);
    const active = w.play.session.combat.targets.balloons.filter((b) => b.active).length;
    expect(active).toBe(DAILY_CONFIG.targetCount[3]);

    startFromHeader(w, header(spec('drones', 3)));
    const drones = w.play.session.combat.drones.filter((d) => d.active);
    expect(drones.length).toBe(PRACTICE_CONFIG.dronePaths.length);
    const first = PRACTICE_CONFIG.dronePaths[0];
    if (!first) throw new Error('path');
    // 1 秒進めると、速さ × 1.4 の分だけ動く
    const d0 = drones[0];
    if (!d0) throw new Error('drone');
    const x0 = d0.position.x;
    for (let i = 0; i < 60; i++) d0.step(1 / 60);
    expect(d0.position.x - x0).toBeCloseTo(first.speed * DAILY_CONFIG.droneSpeed[3], 0);

    const deploy = vi.spyOn(w.play.session.squadron, 'deploy');
    startFromHeader(w, header(spec('gauntlet', 2)));
    expect(w.play.practice?.duration).toBe(150);
    expect(deploy).toHaveBeenCalled();
    expect(deploy.mock.calls.at(-1)?.[2]).toBe(DAILY_CONFIG.gauntletDifficulty[2]);
    deploy.mockRestore();

    startFromHeader(w, header(spec('race', 1)));
    expect(w.play.practice).toBeNull();
    expect(w.play.race?.rings.length).toBe(24);
    expect(w.play.race?.course.weatherId).toBe('day-clear');
  });

  it('日替わりの条件と課題が合わないヘッダは読まない', () => {
    const w = createWorld();
    expect(() => {
      startFromHeader(w, { ...header(spec('targets', 1)), practiceDrill: 'bandit' });
    }).toThrow();
  });
});

describe('同じ記録を 2 回再生すると全ステップの状態ハッシュが一致する（日替わり）', () => {
  for (const [kind, tier] of [
    ['targets', 3],
    ['drones', 3],
    ['gauntlet', 3],
    ['race', 1],
  ] as const) {
    it(`${kind} ★${String(tier)}`, () => {
      const w = createWorld();
      // 前に別のモードを飛んだ世界で記録する
      record(
        w,
        { ...BASE_START, mode: 'practice', practiceDrill: 'static', seed: 5 },
        { seconds: 2 },
      );
      const rec = record(w, header(spec(kind, tier)), { seconds: 10, hashes: true, pilotSeed: 3 });
      // ファイルに書き出して読み直しても同じ（daily がヘッダに残る）
      const data = decodeReplay(encodeReplay(rec.data));
      expect(data.header.daily).toEqual(spec(kind, tier));
      const a = replay(createWorld(), data);
      const b = replay(createWorld(), data);
      expect(a.player.startMatches).toBe(true);
      expect(firstMismatch(rec.hashes, a.hashes)).toBe(-1);
      expect(firstMismatch(a.hashes, b.hashes)).toBe(-1);
    }, 120_000);
  }

  it('最後まで飛んだ回（的あて 2 分）は、再生しても同じスコア', () => {
    const start = header(spec('targets', 2), 4242);
    const w = createWorld();
    const seconds = PRACTICE_CONFIG.countdownSeconds + DAILY_CONFIG.durations.targets + 0.5;
    record(w, start, { seconds, pilotSeed: 8 });
    const result = w.play.practice?.result;
    expect(result).not.toBeNull();
    expect(result?.seconds).toBe(DAILY_CONFIG.durations.targets);
    const again = createWorld();
    replay(again, record(createWorld(), start, { seconds, pilotSeed: 8 }).data);
    expect(again.play.practice?.result?.score).toBe(result?.score);
    expect(again.play.practice?.result?.shots).toBe(result?.shots);
  }, 180_000);
});
