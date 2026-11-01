// セーブ v6 → v7（7-B）: レースのゴーストを入力の記録に変えたので、古いゴースト（15Hz の位置）を捨てる。
// ベストタイム・ランク・完走回数は残す。新しいゴーストはベストを更新した走行の記録（base64）
import { describe, expect, it } from 'vitest';
import { SAVE_CONFIG } from '../src/data/save';
import { createInitialSave, migrateSave } from '../src/progression/save';

describe('セーブ v6 → v7', () => {
  it('古いゴーストを捨て、ベスト・ランク・完走回数は残す', () => {
    expect(SAVE_CONFIG.version).toBe(8);
    const v7 = createInitialSave();
    const entry = {
      time: 50.5,
      aircraftId: 'kestrel',
      aircraftName: 'Kestrel',
      date: '2026-10-31',
      loadoutHash: 'abcd',
      missed: 0,
    };
    const v6: Record<string, unknown> = {
      ...v7,
      version: 6,
      credits: 4321,
      races: {
        coast: {
          bestRank: 'A',
          clears: 3,
          times: [entry],
          ghost: {
            time: 50.5,
            aircraftId: 'kestrel',
            hz: 15,
            data: 'AAAABBBB',
            ringTimes: [10, 20],
          },
        },
        canyon: { bestRank: null, clears: 0, times: [], ghost: null },
      },
    };
    const save = migrateSave(v6);
    expect(save?.version).toBe(8);
    expect(save?.credits).toBe(4321);
    const coast = save?.races.coast;
    expect(coast?.ghost).toBeNull();
    expect(coast?.bestRank).toBe('A');
    expect(coast?.clears).toBe(3);
    expect(coast?.times).toEqual([entry]);
    expect(save?.races.canyon?.ghost).toBeNull();
  });

  it('v5 からも v7 まで通る', () => {
    const v5: Record<string, unknown> = { ...createInitialSave(), version: 5 };
    delete v5.races;
    const save = migrateSave(v5);
    expect(save?.version).toBe(8);
    expect(save?.races).toEqual({});
  });

  it('v7 の新しいゴースト（hz なし）はそのまま読む', () => {
    const save = migrateSave({
      ...createInitialSave(),
      races: {
        coast: {
          bestRank: 'S',
          clears: 1,
          times: [],
          ghost: { time: 40, aircraftId: 'kestrel', data: 'U0tZUg==', ringTimes: [20, 40] },
        },
      },
    });
    expect(save?.races.coast?.ghost).toEqual({
      time: 40,
      aircraftId: 'kestrel',
      data: 'U0tZUg==',
      ringTimes: [20, 40],
    });
  });
});
