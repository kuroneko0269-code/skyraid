// 「方向へ倒す」方式（9-2。src/flight/direct-steer.ts）: 倒し続けたとき・離したとき・組み立てが不安定になりやすい場面（背面・
// 真上・真後ろの敵）・低空の安全・リングレースのコース
import { describe, expect, it } from 'vitest';
import { COURSES } from '../src/data/courses';
import { DIRECT_STEER_CONFIG } from '../src/data/steer';
import { Aircraft, createControls, type GroundHeightFn } from '../src/entities/aircraft';
import { DirectSteer } from '../src/flight/direct-steer';
import { LOCAL_FORWARD } from '../src/flight/flight-model';
import {
  multiplyQuat,
  quatFromRotationVector,
  rotateVec3,
  type Quat,
  type Vec3,
} from '../src/flight/math';
import { getGroundHeight } from '../src/render/terrain-height';
import { runDirectRace, stickToward } from './direct-steer-bots';

const DT = 1 / 60;
const DEG = Math.PI / 180;
const SEA: GroundHeightFn = () => 0;

/** 高度 y・機首の上下 pitchDeg・バンク bankDeg（右が正）・北向きの機体（オートレベル OFF） */
function plane(y: number, pitchDeg = 0, bankDeg = 0, ground: GroundHeightFn = SEA): Aircraft {
  const a = new Aircraft(undefined, { autoLevel: false }, undefined, ground);
  const q: Quat = { x: 0, y: 0, z: 0, w: 1 };
  // ピッチ（+X 回り）→ ロール（右ロール = -Z 回り）の順に機体の軸で回す
  multiplyQuat(q, q, quatFromRotationVector({ x: 0, y: 0, z: 0, w: 1 }, pitchDeg * DEG, 0, 0));
  multiplyQuat(q, q, quatFromRotationVector({ x: 0, y: 0, z: 0, w: 1 }, 0, 0, -bankDeg * DEG));
  a.respawn({ x: 0, y, z: 0 }, q);
  return a;
}

interface Track {
  readonly bank: number[];
  readonly pitch: number[];
  readonly heading: number[];
  readonly alt: number[];
  readonly roll: number[];
  minAlt: number;
  crashes: number;
  nan: boolean;
}

/** stick（毎ステップの値）で seconds 秒飛ぶ */
function fly(
  a: Aircraft,
  seconds: number,
  stick: (a: Aircraft) => { x: number; y: number },
  ground: GroundHeightFn = SEA,
): Track {
  const steer = new DirectSteer();
  const c = createControls();
  c.throttleTarget = 0.75;
  const t: Track = {
    bank: [],
    pitch: [],
    heading: [],
    alt: [],
    roll: [],
    minAlt: Infinity,
    crashes: 0,
    nan: false,
  };
  const f: Vec3 = { x: 0, y: 0, z: 0 };
  let unwrapped = 0;
  let last: number | null = null;
  for (let i = 0; i < seconds * 60; i++) {
    const s = stick(a);
    steer.apply(c, a.state, s.x, s.y, ground);
    if (![c.pitch, c.roll, c.yaw].every(Number.isFinite)) t.nan = true;
    t.roll.push(c.roll);
    a.step(c, DT);
    const st = a.state;
    rotateVec3(f, st.orientation, LOCAL_FORWARD);
    const h = Math.atan2(f.x, -f.z) / DEG;
    if (last !== null) {
      let d = h - last;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      unwrapped += d;
    }
    last = h;
    t.bank.push(a.flight.bankAngle());
    t.pitch.push(a.flight.pitchAngle());
    t.heading.push(unwrapped);
    t.alt.push(st.position.y);
    t.minAlt = Math.min(t.minAlt, st.position.y - ground(st.position.x, st.position.z));
  }
  t.crashes = a.crashCount;
  return t;
}

const at = (xs: readonly number[], sec: number): number => xs[Math.round(sec * 60) - 1] ?? NaN;
const hold = (x: number, y: number) => () => ({ x, y });

describe('倒し続ける・離す', () => {
  it('右へ倒し続けると、右へ水平に旋回し続ける（バンク約 90°・高度はほぼ変わらない）', () => {
    const t = fly(plane(1000), 10, hold(1, 0));
    expect(at(t.heading, 10)).toBeGreaterThan(300);
    expect(Math.abs(at(t.bank, 10) - DIRECT_STEER_CONFIG.maxBankDeg)).toBeLessThan(5);
    expect(Math.max(...t.alt) - 1000).toBeLessThan(60);
    expect(1000 - Math.min(...t.alt)).toBeLessThan(60);
  });

  it('左は右と対称', () => {
    const r = fly(plane(1000), 6, hold(1, 0));
    const l = fly(plane(1000), 6, hold(-1, 0));
    expect(at(l.heading, 6)).toBeCloseTo(-at(r.heading, 6), 0);
    expect(at(l.bank, 6)).toBeCloseTo(-at(r.bank, 6), 0);
  });

  it('半分倒すと、端より遅く曲がる', () => {
    const half = fly(plane(1000), 4, hold(0.5, 0));
    const full = fly(plane(1000), 4, hold(1, 0));
    expect(at(half.heading, 4)).toBeGreaterThan(20);
    expect(at(half.heading, 4)).toBeLessThan(at(full.heading, 4));
  });

  it('上へ倒し続けると上がり、上の角度は上限（80°）で止まる。下は -80° まで', () => {
    const up = fly(plane(1000), 6, hold(0, 1));
    expect(Math.max(...up.pitch)).toBeLessThan(DIRECT_STEER_CONFIG.maxElevationDeg + 1.5);
    expect(at(up.pitch, 6)).toBeGreaterThan(DIRECT_STEER_CONFIG.maxElevationDeg - 3);
    const down = fly(plane(5000), 4, hold(0, -1));
    expect(Math.min(...down.pitch)).toBeGreaterThan(-DIRECT_STEER_CONFIG.maxElevationDeg - 1.5);
    expect(at(down.pitch, 4)).toBeLessThan(-60);
  });

  it('離すと、傾き・上下の角度とも水平に戻る（方位はそのまま）', () => {
    const t = fly(plane(1000, 25, 60), 4, hold(0, 0));
    expect(Math.abs(at(t.bank, 4))).toBeLessThan(3);
    expect(Math.abs(at(t.pitch, 4))).toBeLessThan(3);
  });
});

describe('組み立てが不安定になりやすい場面', () => {
  it('背面から: 離していても水平の側へ回して戻り、右へ倒していれば戻ってから右へ曲がる', () => {
    const t = fly(plane(2000, 0, 180), 3, hold(0, 0));
    expect(Math.abs(at(t.bank, 3))).toBeLessThan(5);
    const r = fly(plane(2000, 0, 175), 6, hold(1, 0));
    expect(at(r.heading, 6)).toBeGreaterThan(90);
    expect(t.nan || r.nan).toBe(false);
  });

  it('真上・真下を向いているとき: 値が壊れず（NaN にならない）、上下の角度の上限の中へ戻る', () => {
    for (const pitch of [89.9, 90, -89.9, -90]) {
      for (const s of [hold(0, 0), hold(1, 0), hold(0, 1), hold(-0.7, -0.7)]) {
        const t = fly(plane(6000, pitch), 4, s);
        expect(t.nan).toBe(false);
        expect(Math.abs(at(t.pitch, 4))).toBeLessThan(DIRECT_STEER_CONFIG.maxElevationDeg + 2);
      }
    }
  });

  it('真後ろの敵: 端まで倒し続けると、回る向きが揺れずに 1 回で振り向き、向いたら水平に戻す', () => {
    const enemy = { x: 0, y: 1000, z: 1500 };
    const stick = { x: 0, y: 0 };
    const a = plane(1000);
    let faced = -1;
    let step = 0;
    const f: Vec3 = { x: 0, y: 0, z: 0 };
    const t = fly(a, 4, (p) => {
      rotateVec3(f, p.state.orientation, LOCAL_FORWARD);
      const q = p.state.position;
      const d = { x: enemy.x - q.x, y: enemy.y - q.y, z: enemy.z - q.z };
      const cos = (f.x * d.x + f.y * d.y + f.z * d.z) / Math.hypot(d.x, d.y, d.z);
      if (faced < 0 && Math.acos(cos) / DEG < 10) faced = step;
      step++;
      return stickToward(stick, p.state, enemy);
    });
    // 振り向くまでの間に、旋回の向き（バンクの符号）が変わらない
    const turning = t.bank.slice(30, faced);
    const sign = Math.sign(turning[turning.length - 1] ?? 0);
    expect(turning.filter((b) => Math.sign(b) === -sign && Math.abs(b) > 10)).toHaveLength(0);
    // 4 秒以内に機首の 10° 内へ。向いた後は水平に戻している
    expect(faced).toBeGreaterThan(0);
    expect(faced).toBeLessThan(4 * 60);
    expect(Math.abs(at(t.bank, 4))).toBeLessThan(15);
  });

  it('右上・右下へ斜めに倒すと、上がり（下がり）ながら右へ曲がる', () => {
    const ur = plane(2000);
    const tu = fly(ur, 3, hold(0.7, 0.7));
    expect(ur.state.position.x).toBeGreaterThan(100);
    expect(at(tu.alt, 3)).toBeGreaterThan(2100);
    const dr = plane(2000);
    const td = fly(dr, 3, hold(0.7, -0.7));
    expect(dr.state.position.x).toBeGreaterThan(100);
    expect(at(td.alt, 3)).toBeLessThan(1900);
  });
});

describe('低空の安全（地面・海面に近いと引き起こしを補助する）', () => {
  it('海面へ下へ倒し続けても当たらない（下向きは引き起こせる角度まで）', () => {
    for (const y of [60, 150, 400, 1000]) {
      const t = fly(plane(y, -30), 15, hold(0, -1));
      expect(t.crashes).toBe(0);
      expect(t.minAlt).toBeGreaterThan(5);
    }
  });

  it('余裕（25m）より下では、離していても上がる', () => {
    const t = fly(plane(15, -5), 4, hold(0, 0));
    expect(t.crashes).toBe(0);
    expect(at(t.alt, 4)).toBeGreaterThan(DIRECT_STEER_CONFIG.ground.clearance);
  });

  it('余裕があれば効かない（高度 1000m で下へ倒すと、補助なしと同じ角度まで下がる）', () => {
    const steer = new DirectSteer();
    const a = plane(1000);
    steer.apply(createControls(), a.state, 0, -1, SEA);
    expect(steer.groundAssistDeg).toBe(0);
  });

  it('島の山へ低空で向かっても、離していれば山を越える（1 秒先の地面を見る）', () => {
    // 島の南の沖から北（中央の山）へ、海面から 120m
    const a = new Aircraft(undefined, { autoLevel: false }, undefined, getGroundHeight);
    const q: Quat = { x: 0, y: 0, z: 0, w: 1 };
    a.respawn({ x: 0, y: 120, z: 4500 }, q);
    const t = fly(a, 30, hold(0, 0), getGroundHeight);
    expect(t.crashes).toBe(0);
  });

  it('リングレースの 4 コース: 自分では地面を避けないボットでも墜落しない。宙返りの無い 3 コースは完走する', () => {
    for (const course of COURSES) {
      const r = runDirectRace(course);
      expect(r.crashes, course.id).toBe(0);
      if (course.id !== 'acro') expect(r.result?.outcome, course.id).toBe('finished');
    }
  });
});
