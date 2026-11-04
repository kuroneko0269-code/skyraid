// 「方向へ倒す」方式の宙返り（9-3。src/flight/loop-steer.ts）: 上へ倒し続けると上限 80° を越えて回る・速さが足りなければ今までどおり
// 止まる（HUD の速度不足）・頂点で離すとインメルマン・途中で離したとき・下は今のまま・機体 4 種・アクロバットのコース
import { describe, expect, it } from 'vitest';
import './i18n-setup';
import { AIRCRAFT_MODELS, STARTER_AIRCRAFT, type AircraftSpec } from '../src/data/aircraft';
import { ACRO_COURSE } from '../src/data/courses';
import { DIRECT_STEER_CONFIG } from '../src/data/steer';
import { Aircraft, createControls, type GroundHeightFn } from '../src/entities/aircraft';
import { DirectSteer } from '../src/flight/direct-steer';
import { LOCAL_FORWARD, LOCAL_UP } from '../src/flight/flight-model';
import { canLoop, safeLoopRadius } from '../src/flight/loop-steer';
import { rotateVec3, type Vec3 } from '../src/flight/math';
import { initialUpgrades } from '../src/progression/save';
import { resolveLoadout } from '../src/progression/loadout';
import { runDirectRace } from './direct-steer-bots';

const DT = 1 / 60;
const DEG = Math.PI / 180;
const SEA: GroundHeightFn = () => 0;

interface LoopRun {
  /** 宙返りに入ったか・入れなかった（速度不足）ことがあったか */
  looped: boolean;
  blocked: boolean;
  /** 機首の上下の角度の最大（度。宙返りしなければ 90 未満） */
  maxElevation: number;
  minSpeed: number;
  maxStall: number;
  /** 終わりの機首の方位（北 = -Z が 0、東が 90）・上下の角度・機体の上の向き（y） */
  heading: number;
  elevation: number;
  upY: number;
  /** 1 回転したか（機首の上下の角度が 90° を越えて、また水平に戻った回数） */
  laps: number;
}

/** 北向き・高度 y・速さ speed の機体で、stickY(秒) を倒し続けて seconds 秒飛ぶ（スロットル 1） */
function runLoop(
  spec: AircraftSpec,
  speed: number,
  stickY: (t: number) => number,
  seconds: number,
  y = 600,
): LoopRun {
  const a = new Aircraft(spec, { autoLevel: true }, undefined, SEA);
  a.respawn({ x: 0, y, z: 0 });
  a.state.speed = speed;
  a.throttle = 1;
  const steer = new DirectSteer();
  const c = createControls();
  const f: Vec3 = { x: 0, y: 0, z: 0 };
  const u: Vec3 = { x: 0, y: 0, z: 0 };
  const r: LoopRun = {
    looped: false,
    blocked: false,
    maxElevation: -90,
    minSpeed: Infinity,
    maxStall: 0,
    heading: 0,
    elevation: 0,
    upY: 1,
    laps: 0,
  };
  let over = false;
  for (let i = 0; i < seconds * 60; i++) {
    steer.apply(c, a.state, 0, stickY(i * DT), SEA, a.flight.spec);
    r.looped ||= steer.loop.active;
    r.blocked ||= steer.loop.blocked;
    a.step(c, DT);
    const st = a.state;
    rotateVec3(f, st.orientation, LOCAL_FORWARD);
    rotateVec3(u, st.orientation, LOCAL_UP);
    // 背面で上がっている（真上を越えた）ときは 90° より大きい角度として数える
    const el = Math.asin(Math.max(-1, Math.min(1, f.y))) / DEG;
    const elevation = u.y < 0 && f.y > 0 ? 180 - el : el;
    r.maxElevation = Math.max(r.maxElevation, elevation);
    if (elevation > 100) over = true;
    if (over && u.y > 0 && Math.abs(el) < 5 && f.z < 0) {
      r.laps++;
      over = false;
    }
    r.minSpeed = Math.min(r.minSpeed, st.speed);
    r.maxStall = Math.max(r.maxStall, st.stall);
  }
  r.heading = Math.atan2(f.x, -f.z) / DEG;
  r.elevation = Math.asin(f.y) / DEG;
  r.upY = u.y;
  return r;
}

const hold = (): number => 1;
const until =
  (s: number) =>
  (t: number): number =>
    t < s ? 1 : 0;

function loadoutSpec(id: string): AircraftSpec {
  const m = AIRCRAFT_MODELS.find((x) => x.id === id);
  if (!m) throw new Error(id);
  return resolveLoadout(m, initialUpgrades()).flight;
}

describe('宙返り（上へ倒し続ける）', () => {
  it('巡航（250m/s）で上へ倒し続けると、80° を越えて 1 回転し、元の向きに戻る（失速しない）', () => {
    const r = runLoop(STARTER_AIRCRAFT, 250, hold, 8);
    expect(r.looped).toBe(true);
    expect(r.maxElevation).toBeGreaterThan(170);
    expect(r.laps).toBeGreaterThanOrEqual(1);
    expect(r.maxStall).toBe(0);
    expect(r.minSpeed).toBeGreaterThan(STARTER_AIRCRAFT.speed.stall * 1.3);
  });

  it('速さが足りない（140m/s）と今までどおり 80° で止まり、速度不足を知らせる', () => {
    const r = runLoop(STARTER_AIRCRAFT, 140, hold, 4);
    expect(r.looped).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.maxElevation).toBeLessThan(DIRECT_STEER_CONFIG.maxElevationDeg + 2);
  });

  it('頂点付近で離すと、背面から水平に戻って反対向きに飛ぶ（インメルマン）', () => {
    // 250m/s: 約 1.4 秒で入り、約 3.5 秒で頂点
    const r = runLoop(STARTER_AIRCRAFT, 250, until(3.5), 9);
    expect(r.looped).toBe(true);
    expect(Math.abs(Math.abs(r.heading) - 180)).toBeLessThan(10);
    expect(Math.abs(r.elevation)).toBeLessThan(5);
    expect(r.upY).toBeGreaterThan(0.95);
  });

  it('真上を過ぎてから離しても頂点まで回ってインメルマン、下りで離すと元の向きへ引き起こす（横を向いて抜けない）', () => {
    const mid = runLoop(STARTER_AIRCRAFT, 250, until(2.2), 9);
    expect(Math.abs(Math.abs(mid.heading) - 180)).toBeLessThan(10);
    expect(mid.upY).toBeGreaterThan(0.95);
    const down = runLoop(STARTER_AIRCRAFT, 250, until(5.2), 9);
    expect(Math.abs(down.heading)).toBeLessThan(10);
    expect(Math.abs(down.elevation)).toBeLessThan(5);
    expect(down.upY).toBeGreaterThan(0.95);
  });

  it('真上の手前（入ってすぐ）で離すと、宙返りせずに今までどおり戻る', () => {
    const r = runLoop(STARTER_AIRCRAFT, 250, until(1.5), 8);
    expect(r.maxElevation).toBeLessThan(95);
    expect(Math.abs(r.heading)).toBeLessThan(10);
  });

  it('下へ倒し続けたときは宙返りしない（9-4: 高度に余裕があれば真下まで。越えない）', () => {
    const r = runLoop(STARTER_AIRCRAFT, 250, () => -1, 3, 2500);
    expect(r.looped).toBe(false);
    expect(r.elevation).toBeGreaterThan(-DIRECT_STEER_CONFIG.maxDiveDeg - 2);
  });

  it('低空では下向きは低空の安全が先（9-4: 真下へ倒し続けても墜ちない）', () => {
    const r = runLoop(STARTER_AIRCRAFT, 250, () => -1, 8, 300);
    expect(r.elevation).toBeGreaterThan(-30);
  });

  it('機体 4 種（初期の強化）: 巡航の速さから失速せずに 1 回転する', () => {
    for (const m of AIRCRAFT_MODELS) {
      const spec = loadoutSpec(m.id);
      const r = runLoop(spec, spec.speed.cruise, hold, 10);
      expect(r.laps, m.id).toBeGreaterThanOrEqual(1);
      expect(r.maxStall, m.id).toBe(0);
    }
  });

  it('引きは速さに合わせる: 遅いほど小さい輪（頂点で失速速度の 1.4 倍が残る大きさまで）。入れる速さの境目がある', () => {
    const s = STARTER_AIRCRAFT;
    expect(safeLoopRadius(s, 180, 80 * DEG)).toBeLessThan(safeLoopRadius(s, 250, 80 * DEG));
    expect(safeLoopRadius(s, 150, Math.PI * 1.2)).toBe(Infinity);
    const state = new Aircraft(s).state;
    state.speed = 250;
    expect(canLoop(s, state, 76 * DEG)).toBe(true);
    state.speed = 120;
    expect(canLoop(s, state, 76 * DEG)).toBe(false);
  });
});

describe('アクロバットのコース（方向へ倒す方式のボット）', () => {
  it('機体 4 種で墜落せずに完走し、真下向きのリング（11 番）とその先のチェックポイント（12 番）を通る（9-4: 真下まで向けられる）', () => {
    for (const m of AIRCRAFT_MODELS) {
      const r = runDirectRace(ACRO_COURSE, m.id);
      expect(r.crashes, m.id).toBe(0);
      expect(r.result?.outcome, m.id).toBe('finished');
      const status = r.sim.race.status;
      expect(status[11], m.id).toBe('passed');
      expect(status[12], m.id).toBe('passed');
    }
  });
});
