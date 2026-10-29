import { describe, expect, it } from 'vitest';
import { GameLoop } from '../src/core/loop';
import { FLIGHT_CONFIG } from '../src/data/flight';
import { Aircraft, type AircraftControls } from '../src/entities/aircraft';
import { hitsGround } from '../src/flight/flight-model';

const DT = 1 / 60;

function controls(overrides: Partial<AircraftControls> = {}): AircraftControls {
  return { pitch: 0, roll: 0, yaw: 0, throttle: 0, afterburner: false, ...overrides };
}

describe('地面衝突', () => {
  it('高度が地面以下なら衝突', () => {
    expect(hitsGround({ x: 0, y: 0.01, z: 0 }, 0)).toBe(false);
    expect(hitsGround({ x: 0, y: 0, z: 0 }, 0)).toBe(true);
    expect(hitsGround({ x: 0, y: -5, z: 0 }, 0)).toBe(true);
  });

  it('地面に突っ込むと墜落地点の上空に初期姿勢でリセットされる', () => {
    const a = new Aircraft();
    let steps = 0;
    while (a.crashCount === 0 && steps < 60 * 30) {
      // 機首を 60° 下げたら操作をやめて突っ込む
      a.step(controls({ pitch: a.flight.pitchAngle() > -60 ? -1 : 0 }), DT);
      steps++;
    }
    expect(a.crashCount).toBe(1);
    const s = a.state;
    expect(s.position.y).toBe(FLIGHT_CONFIG.spawn.position.y);
    expect(s.orientation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(s.speed).toBe(a.flight.spec.speed.cruise);
    // リセット直後は補間しない
    expect(a.prevPosition).toEqual(s.position);
  });
});

describe('スロットル', () => {
  it('起動時は巡航速度を保つスロットル位置で、入力で 0〜1 の範囲を動く', () => {
    const a = new Aircraft();
    const initial = a.throttle;
    expect(initial).toBeGreaterThan(0);
    expect(initial).toBeLessThan(1);
    for (let i = 0; i < 600; i++) a.step(controls({ throttle: 1 }), DT);
    expect(a.throttle).toBe(1);
    for (let i = 0; i < 600; i++) a.step(controls({ throttle: -1 }), DT);
    expect(a.throttle).toBe(0);
  });

  it('throttleTarget でスロットル位置を直接指定でき、指定がなければ位置を保つ', () => {
    const a = new Aircraft();
    a.step(controls({ throttleTarget: 0.2 }), DT);
    expect(a.throttle).toBeCloseTo(0.2);
    a.step(controls({ throttleTarget: null }), DT);
    a.step(controls(), DT);
    expect(a.throttle).toBeCloseTo(0.2);
    a.step(controls({ throttleTarget: 3 }), DT);
    expect(a.throttle).toBe(1);
  });
});

describe('固定タイムステップ', () => {
  it('フレームレートが違っても同じ時間なら同じ状態になる', () => {
    const simulate = (fps: number): Aircraft => {
      const a = new Aircraft();
      const loop = new GameLoop();
      let t = 0;
      loop.onUpdate((dt) => {
        // 時間で変わる操作（宙返り → ロール → アフターバーナー）
        t += dt;
        a.step(controls({ pitch: t < 2 ? 1 : 0, roll: t > 2 ? 1 : 0, afterburner: t > 3 }), dt);
      });
      for (let i = 0; i < 4 * fps; i++) loop.advance(1 / fps);
      return a;
    };
    const at30 = simulate(30);
    const at144 = simulate(144);
    expect(at144.state.position).toEqual(at30.state.position);
    expect(at144.state.orientation).toEqual(at30.state.orientation);
    expect(at144.state.speed).toBe(at30.state.speed);
  });
});
