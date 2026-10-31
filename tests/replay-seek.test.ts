// リプレイ（7-B）のシーク: 1 秒ごとのキーフレーム（丸ごと + 差分）から計算し直した状態が、最初から通して再生した状態と一致する
import { describe, expect, it } from 'vitest';
import { createRandom } from '../src/core/random';
import { ReplayPlayer } from '../src/replay/player';
import { simHash } from '../src/replay/sim';
import type { ReplayStart } from '../src/replay/types';
import { BASE_START, createWorld, record } from './replay-helpers';

const CASES: readonly [string, ReplayStart, boolean][] = [
  ['フリーフライト', BASE_START, false],
  [
    'ソロレイド（街の建物が壊れる）',
    { ...BASE_START, mode: 'raid', mapId: 'harbor', raidDifficulty: 'normal' },
    false,
  ],
  [
    '防衛戦',
    { ...BASE_START, mode: 'defense', mapId: 'island', defenseDifficulty: 'normal' },
    true,
  ],
];

describe('シークはキーフレームからの計算が通常の再生と一致する', () => {
  for (const [name, start, autoSkip] of CASES) {
    it(
      name,
      () => {
        const seconds = 150;
        const { data } = record(createWorld(), start, { seconds, autoSkip, pilotSeed: 9 });
        // 通常の再生で、確かめる時刻のハッシュを取る
        const r = createRandom(5);
        const ticks = Array.from({ length: 8 }, () => Math.floor(r() * seconds * 60));
        ticks.push(0, 60, 61, seconds * 60);
        const want = new Map<number, string>();
        const w1 = createWorld();
        const straight = new ReplayPlayer(w1, data, w1.controls);
        straight.begin();
        if (ticks.includes(0)) want.set(0, simHash(w1));
        while (straight.step())
          if (ticks.includes(straight.tick)) want.set(straight.tick, simHash(w1));
        // 先へ（計算していない）・後ろへ・同じ秒の中・10 秒スキップの順にシークする
        const w2 = createWorld();
        const p = new ReplayPlayer(w2, data, w2.controls);
        p.begin();
        for (const t of [...ticks, ...ticks.slice().reverse()]) {
          if (!p.seek(t)) while (!p.advanceSeek(500));
          expect(p.tick).toBe(t);
          expect(simHash(w2), `tick ${String(t)}`).toBe(want.get(t));
        }
        // 差分のキーフレームは丸ごとより十分小さい
        expect(p.keyframes.count).toBe(seconds + 1);
        expect(p.keyframes.size / p.keyframes.count).toBeLessThan(40_000);
      },
      120_000,
    );
  }

  it('範囲の外へのシークは端に止まる。終わりで止まる', () => {
    const { data } = record(createWorld(), BASE_START, { seconds: 4 });
    const w = createWorld();
    const p = new ReplayPlayer(w, data, w.controls);
    p.begin();
    p.seek(-100);
    expect(p.tick).toBe(0);
    p.seek(99999);
    expect(p.tick).toBe(240);
    expect(p.ended).toBe(true);
    expect(p.step()).toBe(false);
  });
});
