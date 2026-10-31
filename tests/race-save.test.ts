// リングレース（7-1）のセーブ（v6）: v5 → v6 の移行、races の形の確認、結果の記録（ベスト 5・ゴースト・ランク・報酬・装備のハッシュ）
import { describe, expect, it } from 'vitest';
import { SAVE_CONFIG } from '../src/data/save';
import type { RaceResult } from '../src/missions/race/runner';
import {
  loadoutHash,
  localDate,
  raceRecord,
  recordRace,
  type RaceMachine,
} from '../src/progression/race-records';
import { createInitialSave, initialUpgrades, migrateSave } from '../src/progression/save';
import { SaveStore, type SaveStorage } from '../src/progression/save-store';

class FakeStorage implements SaveStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const KESTREL: RaceMachine = {
  aircraftId: 'kestrel',
  aircraftName: 'Kestrel',
  levels: initialUpgrades(),
};

function result(time: number, rank: RaceResult['rank'] = 'A', courseId = 'coast'): RaceResult {
  return {
    courseId,
    outcome: rank ? 'finished' : 'timeout',
    rawSeconds: time,
    time,
    missed: 0,
    thinPassed: 0,
    penaltySeconds: 0,
    bonusSeconds: 0,
    rank,
    ringTimes: [time / 2, time],
  };
}

function freshStore(): { store: SaveStore; storage: FakeStorage } {
  const storage = new FakeStorage();
  return { store: SaveStore.open(storage).store, storage };
}

describe('セーブ v5 → v6', () => {
  it('v5 のデータにレースの記録（空）を足す。ほかはそのまま', () => {
    expect(SAVE_CONFIG.version).toBe(6);
    const v6 = createInitialSave();
    const v5: Record<string, unknown> = { ...v6, version: 5, credits: 1234, pilotName: 'ACE' };
    delete v5.races;
    const save = migrateSave(v5);
    expect(save?.version).toBe(6);
    expect(save?.races).toEqual({});
    expect(save?.credits).toBe(1234);
    expect(save?.pilotName).toBe('ACE');
  });

  it('races の壊れた項目だけ捨てる（ランク・行・ゴースト）。ベストは速い順に 5 件まで', () => {
    const base = createInitialSave();
    const entry = (time: number): Record<string, unknown> => ({
      time,
      aircraftId: 'kestrel',
      aircraftName: 'Kestrel',
      date: '2026-10-31',
      loadoutHash: 'abcd1234',
      missed: 1,
    });
    const save = migrateSave({
      ...base,
      races: {
        coast: {
          bestRank: 'Z',
          clears: -3,
          times: [
            entry(70),
            'x',
            entry(50),
            { time: 'fast' },
            entry(60),
            entry(65),
            entry(80),
            entry(55),
          ],
          ghost: { time: 50, aircraftId: 'kestrel', hz: 15, data: 'AAAA', ringTimes: [1, 'x'] },
        },
        canyon: { bestRank: 'S', clears: 2, times: [], ghost: null },
        broken: 5,
      },
    });
    const coast = save?.races.coast;
    expect(coast?.bestRank).toBeNull();
    expect(coast?.clears).toBe(0);
    expect(coast?.times.map((t) => t.time)).toEqual([50, 55, 60, 65, 70]);
    expect(coast?.ghost).toBeNull();
    expect(save?.races.canyon?.bestRank).toBe('S');
    expect(save?.races.broken).toBeUndefined();
    // races が無い・形が違っても骨組みは壊れていない扱い（空にする）
    expect(migrateSave({ ...base, races: 'x' })?.races).toEqual({});
  });
});

describe('レースの結果の記録', () => {
  it('初クリア: ランクの額（A 2500 CR）、ベスト 1 位、ゴーストを保存。保存した文字列から読み直せる', () => {
    const { store, storage } = freshStore();
    const now = new Date(2026, 9, 31, 12);
    const out = recordRace(store, result(60, 'A'), KESTREL, 'GHOST', now);
    expect(out).toMatchObject({ credits: 2500, newBest: true, place: 1, previousRank: null });
    expect(store.credits).toBe(2500);
    const rec = raceRecord(store, 'coast');
    expect(rec.bestRank).toBe('A');
    expect(rec.clears).toBe(1);
    expect(rec.times[0]).toEqual({
      time: 60,
      aircraftId: 'kestrel',
      aircraftName: 'Kestrel',
      date: '2026-10-31',
      loadoutHash: loadoutHash('kestrel', initialUpgrades()),
      missed: 0,
    });
    expect(rec.ghost).toEqual({
      time: 60,
      aircraftId: 'kestrel',
      hz: 15,
      data: 'GHOST',
      ringTimes: [30, 60],
    });
    const reopened = SaveStore.open(storage).store;
    expect(raceRecord(reopened, 'coast').times).toHaveLength(1);
  });

  it('ランク更新は差額、更新なしは 300 CR。ゴーストはベスト更新のときだけ差し替え', () => {
    const { store } = freshStore();
    recordRace(store, result(70, 'B'), KESTREL, 'G1');
    expect(store.credits).toBe(2000);
    const slower = recordRace(store, result(72, 'B'), KESTREL, 'G2');
    expect(slower).toMatchObject({ credits: 300, newBest: false, place: 2, previousRank: 'B' });
    expect(raceRecord(store, 'coast').ghost?.data).toBe('G1');
    const faster = recordRace(store, result(55, 'S'), KESTREL, 'G3');
    expect(faster).toMatchObject({ credits: 1000, newBest: true, place: 1, previousRank: 'B' });
    expect(store.credits).toBe(2000 + 300 + 1000);
    expect(raceRecord(store, 'coast').ghost?.data).toBe('G3');
    expect(raceRecord(store, 'coast').bestRank).toBe('S');
  });

  it('ベストは 5 件まで（遅い記録は入らない）。コースごとに別', () => {
    const { store } = freshStore();
    for (const t of [60, 61, 62, 63, 64]) recordRace(store, result(t, 'C'), KESTREL, 'G');
    const out = recordRace(store, result(70, 'C'), KESTREL, 'G');
    expect(out.place).toBeNull();
    expect(raceRecord(store, 'coast').times.map((e) => e.time)).toEqual([60, 61, 62, 63, 64]);
    recordRace(store, result(59.5, 'C'), KESTREL, 'G');
    expect(raceRecord(store, 'coast').times.map((e) => e.time)).toEqual([59.5, 60, 61, 62, 63]);
    expect(raceRecord(store, 'canyon').times).toEqual([]);
  });

  it('時間切れは記録しない（報酬 0）', () => {
    const { store } = freshStore();
    const out = recordRace(store, result(80, null), KESTREL, 'G');
    expect(out.credits).toBe(0);
    expect(raceRecord(store, 'coast').clears).toBe(0);
    expect(store.credits).toBe(0);
  });

  it('装備のハッシュ: 機体と強化 Lv で決まる（ランキングは機体別・強化別に分けられる）', () => {
    const lv = initialUpgrades();
    const h = loadoutHash('kestrel', lv);
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(loadoutHash('kestrel', { ...lv })).toBe(h);
    expect(loadoutHash('swift', lv)).not.toBe(h);
    expect(loadoutHash('kestrel', { ...lv, engine: 1 })).not.toBe(h);
    expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
