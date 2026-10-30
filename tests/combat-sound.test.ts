// 戦闘の手応えの音（4-12）: 機銃の命中音（コンプ）・発射音の低域・ミサイル発射の 3 層とドップラー・撃墜の音。
// 実音は鳴らさず、モックの AudioContext に作られたノードと周波数の予定を確かめる
import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../src/audio/engine';
import {
  createHitCompressor,
  hitCompression,
  missileDoppler,
  missileSweep,
} from '../src/audio/params';
import { OneShots } from '../src/audio/sfx/oneshots';
import { GUN_HIT_SOUND, GUN_SOUND, KILL_SOUND, MISSILE_SOUND } from '../src/data/audio';
import { MISSIONS } from '../src/data/missions';
import { missionDifficultyText } from '../src/ui/mission-text';
import { asContext, MockAudioContext } from './audio-mock';

function setup(): { shots: OneShots; ctx: MockAudioContext; engine: AudioEngine } {
  const ctx = new MockAudioContext();
  const engine = new AudioEngine(() => asContext(ctx));
  engine.unlock();
  ctx.sources.length = 0;
  return { shots: new OneShots(engine, { x: 0, y: 0, z: 0 }), ctx, engine };
}

interface OscLike {
  type?: string;
  frequency?: { events: { type: string; value: number; time: number }[] };
}

/** 作られたオシレーターの [種類, 最初の周波数, 最後の周波数] */
function oscillators(ctx: MockAudioContext): [string, number, number][] {
  return ctx.sources
    .map((s) => s as OscLike)
    .filter((s) => s.frequency)
    .map((s) => {
      const ev = s.frequency?.events ?? [];
      return [s.type ?? '', ev[0]?.value ?? 0, ev[ev.length - 1]?.value ?? 0];
    });
}

describe('命中音のコンプ', () => {
  it('1 発目は 1 倍。続けて当たるほど下がり、間が空くと戻る', () => {
    const c = createHitCompressor();
    expect(hitCompression(c, 0)).toBe(1);
    // 15 発/秒で 2 秒当て続ける
    const gains: number[] = [];
    for (let i = 1; i <= 30; i++) gains.push(hitCompression(c, i / 15));
    expect(gains[0]).toBeLessThan(1);
    // 落ち着いた音量（約 0.45）より下がり続けない。音の重なり（0.12 秒 ≒ 2 発）を足しても 1 発目と同程度
    const steady = gains[gains.length - 1] ?? 0;
    expect(steady).toBeGreaterThan(0.4);
    expect(steady).toBeLessThan(0.5);
    expect(steady * (GUN_HIT_SOUND.metal.decay * 15)).toBeLessThan(1.1);
    // 1 秒空けばほぼ戻る
    expect(hitCompression(c, 3)).toBeGreaterThan(0.95);
  });

  it('minInterval より詰めては鳴らさない（0 を返し、量も増やさない）', () => {
    const c = createHitCompressor();
    hitCompression(c, 1);
    expect(hitCompression(c, 1 + GUN_HIT_SOUND.minInterval / 2)).toBe(0);
    expect(c.level).toBe(1);
  });
});

describe('機銃の命中音・発射音', () => {
  it('命中音: 200〜400Hz の部分音 3 つ + 低域のドン（90 → 60Hz）。ノイズは共鳴とクラックの 2 本', () => {
    const { shots, ctx } = setup();
    shots.gunHit();
    const osc = oscillators(ctx);
    const partials = osc.filter(([type]) => type === 'triangle').map(([, f]) => f);
    expect(partials).toEqual([...GUN_HIT_SOUND.metal.partials]);
    for (const f of partials) {
      expect(f).toBeGreaterThanOrEqual(200);
      expect(f).toBeLessThanOrEqual(400);
    }
    expect(osc.filter(([type]) => type === 'sine')).toEqual([['sine', 90, 60]]);
    expect(ctx.sources.length - osc.length).toBe(2);
  });

  it('発射音: 4-4 のノイズ + クリックに、80〜120Hz の短いパルスを足した', () => {
    const { shots, ctx } = setup();
    shots.gun();
    const osc = oscillators(ctx);
    expect(osc).toEqual([
      ['sine', GUN_SOUND.clickFreq, GUN_SOUND.clickEndFreq],
      ['sine', 120, 80],
    ]);
  });

  it('ボイスを使い回すとき、前の音の層（フィルタ・音量）を外す', () => {
    const { shots, ctx } = setup();
    const made: { connections: unknown[] }[] = [];
    const create = ctx.createBiquadFilter.bind(ctx);
    ctx.createBiquadFilter = () => {
      const f = create();
      made.push(f);
      return f;
    };
    shots.gunHit();
    const first = made.slice();
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((f) => f.connections.length > 0)).toBe(true);
    // 鳴り終わった後、すべてのボイスをもう一度使うと、前の層はどこにもつながっていない
    for (let i = 0; i < 12; i++) {
      ctx.currentTime += 1;
      shots.gunHit();
    }
    expect(first.every((f) => f.connections.length === 0)).toBe(true);
  });
});

describe('ミサイル発射（3 層 + ドップラー）', () => {
  it('ドップラーの倍率は 1 から下がり、遠ざかる速さの上限で止まる', () => {
    expect(missileDoppler(0)).toBe(1);
    expect(missileDoppler(0.8)).toBeLessThan(missileDoppler(0.4));
    const d = MISSILE_SOUND.doppler;
    const floor = d.soundSpeed / (d.soundSpeed + d.maxRecede);
    expect(missileDoppler(10)).toBeCloseTo(floor, 9);
    expect(missileDoppler(1.6)).toBeCloseTo(343 / (343 + 352), 6);
  });

  it('スイープは start → end を対数で下げ、ドップラーでさらに下がる（単調）', () => {
    const s = missileSweep(6000, 300, 1.6);
    expect(s.length).toBe(MISSILE_SOUND.doppler.points + 1);
    expect(s[0]).toEqual([0, 6000]);
    const last = s[s.length - 1];
    expect(last?.[0]).toBeCloseTo(1.6, 9);
    expect(last?.[1]).toBeCloseTo(300 * missileDoppler(1.6), 6);
    for (let i = 1; i < s.length; i++) expect(s[i]?.[1]).toBeLessThan(s[i - 1]?.[1] ?? 0);
  });

  it('点火のクラック（ノイズ）+ 低域のうなり（鋸波 80Hz → 50Hz × ドップラー）+ シュー（ノイズ）', () => {
    const { shots, ctx } = setup();
    shots.missileLaunch(null);
    const osc = oscillators(ctx);
    expect(osc.length).toBe(1);
    const [type, start, end] = osc[0] ?? ['', 0, 0];
    expect(type).toBe('sawtooth');
    expect(start).toBe(80);
    expect(end).toBeCloseTo(50 * missileDoppler(MISSILE_SOUND.rumble.decay), 6);
    for (const f of [start, end]) {
      expect(f).toBeLessThanOrEqual(80);
      expect(f).toBeGreaterThan(30);
    }
    // ノイズ 2 本（クラック 30ms・シュー）
    expect(ctx.sources.length - osc.length).toBe(2);
  });
});

describe('撃墜の音', () => {
  it('バンドパスのノイズを矩形波で刻む + 不協和の鋸波 2 本を半分の高さへ下げる', () => {
    const { shots, ctx } = setup();
    shots.kill();
    const osc = oscillators(ctx);
    expect(osc).toEqual([
      ['square', KILL_SOUND.tear.ratchetHz, KILL_SOUND.tear.ratchetHz],
      ['sawtooth', 520, 260],
      ['sawtooth', 733, 366.5],
    ]);
  });
});

describe('ミッション一覧の難易度の表記', () => {
  it('M1 入門 / M2 易〜普 / M3 普 / M4 普（対空砲）/ M5 易', () => {
    expect(MISSIONS.map((m) => missionDifficultyText(m))).toEqual([
      '入門',
      '易〜普',
      '普',
      '普',
      '易',
    ]);
  });
});
