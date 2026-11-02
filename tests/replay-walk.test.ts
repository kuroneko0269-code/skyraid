// リプレイ（7-B）の状態の走査・本番の記録のつなぎ・ループの時間の倍率
import { describe, expect, it } from 'vitest';
import { createCombatInput } from '../src/combat/combat-input';
import { GameLoop } from '../src/core/loop';
import { GameState } from '../src/core/game-state';
import { SeededRandom, createRandom } from '../src/core/random';
import { createControls } from '../src/entities/aircraft';
import { ReplayHub } from '../src/replay/hub';
import { hashState, StateSnapshot } from '../src/replay/state-walk';
import { createWorld } from './replay-helpers';

class Thing {
  static readonly transientKeys = ['cache'];
  readonly pos = { x: 1, y: 2, z: 3 };
  readonly list: { v: number }[] = [{ v: 1 }];
  readonly map = new Map<string, number>([['a', 1]]);
  readonly set = new Set<number>([1]);
  readonly buf = new Float32Array([1, 2]);
  readonly listeners: (() => void)[] = [];
  cache = 0;
  n = 0;
}

describe('状態の走査', () => {
  it('書き戻すと値・配列の長さ・Map・Set・型付き配列・参照が戻る。リスナー・transientKeys は触らない', () => {
    const t = new Thing();
    const world = {
      t,
      get g() {
        return t.n;
      },
    };
    const h0 = hashState([world]);
    const snap = StateSnapshot.take([world]);
    t.pos.x = 9;
    t.list.push({ v: 2 });
    t.map.set('b', 2);
    t.set.add(5);
    t.buf[1] = 7;
    t.n = -0;
    t.cache = 42;
    const fn = (): void => undefined;
    t.listeners.push(fn);
    expect(hashState([world])).not.toBe(h0);
    snap.restore();
    expect(hashState([world])).toBe(h0);
    expect(t.list).toHaveLength(1);
    expect([...t.map.keys()]).toEqual(['a']);
    expect([...t.set]).toEqual([1]);
    expect(t.buf[1]).toBe(2);
    expect(t.listeners).toEqual([fn]);
    expect(t.cache).toBe(42);
  });

  it('-0 と 0 はハッシュで区別する', () => {
    expect(hashState([{ a: 0 }])).not.toBe(hashState([{ a: -0 }]));
  });

  it('差分の写しは丸ごとの写しを書き戻した後に書き戻すと元に戻る', () => {
    const t = new Thing();
    const base = StateSnapshot.take([t]);
    t.pos.y = 5;
    const h = hashState([t]);
    const diff = StateSnapshot.take([t], undefined, base);
    expect(diff.size).toBeLessThan(base.size);
    t.pos.y = 100;
    t.n = 3;
    base.restore();
    diff.restore();
    expect(hashState([t])).toBe(h);
  });

  it('SeededRandom は createRandom と同じ列で、状態を書き戻すと続きも同じ', () => {
    const a = new SeededRandom(42);
    const b = createRandom(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b());
    const snap = StateSnapshot.take([a]);
    const x = [a.next(), a.next()];
    snap.restore();
    expect([a.next(), a.next()]).toEqual(x);
  });
});

describe('本番の記録のつなぎ（ReplayHub）', () => {
  it('記録中は操作を量子化して記録し、再生中・記録していないときは触らない', () => {
    const w = createWorld();
    const hub = new ReplayHub(w.play);
    const c = createControls();
    const input = createCombatInput();
    c.pitch = 0.123456;
    hub.capture(c, input);
    expect(c.pitch).toBe(0.123456);
    hub.recorder.begin(
      {
        mode: 'free',
        mapId: 'island',
        aircraftId: 'kestrel',
        upgrades: { engine: 0, airframe: 0, weapons: 0, avionics: 0 },
        enemies: { enabled: false, difficulty: 'easy', count: 0 },
        seed: 1,
        weatherId: 'clear',
      },
      { title: 't', pilotName: 'p', date: '', gameVersion: '1.0.0', startHash: '' },
    );
    hub.capture(c, input);
    expect(c.pitch).toBe(Math.round(0.123456 * 127) / 127);
    expect(hub.recorder.steps).toBe(1);
    hub.dispatch({ kind: 'select', target: -1 });
    hub.playing = true;
    hub.capture(c, input);
    hub.dispatch({ kind: 'select', target: -1 });
    expect(hub.recorder.steps).toBe(1);
    expect(hub.recorder.snapshot(null)?.commands).toHaveLength(1);
  });
});

describe('ゲームループの時間の倍率（再生の速さ）', () => {
  it('倍率 4 で 4 倍、0.25 で 1/4、0 で止まる', () => {
    const loop = new GameLoop();
    let n = 0;
    loop.onUpdate(() => n++);
    loop.timeScale = 4;
    loop.advance(0.1);
    expect(n).toBe(24);
    n = 0;
    loop.timeScale = 0.25;
    for (let i = 0; i < 40; i++) loop.advance(0.1);
    expect(n).toBe(60);
    n = 0;
    loop.timeScale = 0;
    loop.advance(0.2);
    expect(n).toBe(0);
  });
});

describe('画面の遷移（リプレイ）', () => {
  it('モード選択 → 一覧 → 飛行（再生）→ 一覧（Esc・一覧へ）→ モード選択', () => {
    const game = new GameState();
    for (const s of [
      'title',
      'mode_select',
      'replay_select',
      'flight',
      'replay_select',
      'mode_select',
    ] as const)
      expect(game.transition(s), s).toBe(true);
  });
});
