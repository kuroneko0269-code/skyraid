// 9-5b: 「方向へ倒す」方式で機首がほぼ真上・真下（±70° より先）のときの意図しない横回転（実機のリプレイの 35.8 秒: -84° で
// 最大 約 640°/秒（機体の軸で 約 170°/秒）、48.1 秒: +82° で 約 360°/秒（機体の軸では 40°/秒 以下。真上の近くを通った見かけ））。回る速さの上限・向きの切り替えのヒステリシス・背面にして引くのに要る倒し続ける時間
import { describe, expect, it } from 'vitest';
import { DIRECT_STEER_CONFIG } from '../src/data/steer';
import { Aircraft, createControls, type GroundHeightFn } from '../src/entities/aircraft';
import { DirectSteer, type DirectSteerConfig } from '../src/flight/direct-steer';
import { LOCAL_FORWARD } from '../src/flight/flight-model';
import { multiplyQuat, quatFromRotationVector, rotateVec3, type Quat } from '../src/flight/math';

const DT = 1 / 60;
const DEG = Math.PI / 180;
const SEA: GroundHeightFn = () => 0;

/** 9-5 までの組み立て（上限・ヒステリシス・倒し続ける時間なし） */
const BEFORE = {
  ...DIRECT_STEER_CONFIG,
  diveRoll: { ...DIRECT_STEER_CONFIG.diveRoll, holdSeconds: 0 },
  nearVertical: { ...DIRECT_STEER_CONFIG.nearVertical, minRoll: 1, flipMarginDeg: 0 },
} as unknown as DirectSteerConfig;

function plane(pitchDeg: number, bankDeg: number): Aircraft {
  const a = new Aircraft(undefined, { autoLevel: false }, undefined, SEA);
  const q: Quat = { x: 0, y: 0, z: 0, w: 1 };
  multiplyQuat(q, q, quatFromRotationVector({ x: 0, y: 0, z: 0, w: 1 }, pitchDeg * DEG, 0, 0));
  multiplyQuat(q, q, quatFromRotationVector({ x: 0, y: 0, z: 0, w: 1 }, 0, 0, -bankDeg * DEG));
  a.respawn({ x: 0, y: 3000, z: 0 }, q);
  a.state.speed = 300;
  return a;
}

type Stick = (t: number) => { x: number; y: number };
const STICKS: readonly Stick[] = [
  () => ({ x: 0, y: 0 }),
  () => ({ x: 1, y: 0 }),
  () => ({ x: -0.7, y: -0.7 }),
  () => ({ x: 0, y: -1 }),
  () => ({ x: 0.3, y: 1 }),
  // 下へ一瞬だけ大きく倒して離す
  (t) => (t < 0.2 ? { x: 0, y: -1 } : { x: 0, y: 0 }),
  // 左右に揺れる指
  (t) => ({ x: Math.sin(t * 9) * 0.4, y: -0.3 }),
];

/**
 * 機首が ±70° より先にいる間の横回転の速さの最大（度/秒）: body は機体の軸まわり、bank は画面の傾き（バンク角）の変わる速さ
 * （実機の記録の解析と同じ。真上・真下の近くでは機体の軸まわりより大きく見える）
 */
function maxVerticalRoll(
  cfg: DirectSteerConfig,
  pitchDeg: number,
  bankDeg: number,
  stick: Stick,
): { body: number; bank: number } {
  const a = plane(pitchDeg, bankDeg);
  const steer = new DirectSteer(cfg);
  const c = createControls();
  c.throttleTarget = 1;
  const f = { x: 0, y: 0, z: 0 };
  const r = { x: 0, y: 0, z: 0 };
  const u = { x: 0, y: 0, z: 0 };
  const out = { body: 0, bank: 0 };
  let last: number | null = null;
  for (let i = 0; i < 90; i++) {
    const s = stick(i * DT);
    steer.apply(c, a.state, s.x, s.y, SEA, a.flight.spec);
    a.step(c, DT);
    const q = a.state.orientation;
    rotateVec3(f, q, LOCAL_FORWARD);
    rotateVec3(r, q, { x: 1, y: 0, z: 0 });
    rotateVec3(u, q, { x: 0, y: 1, z: 0 });
    const bank = Math.atan2(-r.y, u.y) / DEG;
    // 実機の記録の解析と同じく 0.1 秒ごとのバンク角の差で測る
    const elev = Math.abs(Math.asin(f.y));
    // 真上・真下そのもの（86° より先）ではバンク角が決まらない（宙返りの頂点と同じで、縦に回るだけでも 180° 変わる）
    const vertical = elev >= 70 * DEG && elev <= 86 * DEG;
    if (elev >= 74 * DEG) out.body = Math.max(out.body, Math.abs(a.state.angularRate.z) / DEG);
    if (i % 6 === 5) {
      if (last !== null && vertical) {
        let d = bank - last;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        out.bank = Math.max(out.bank, Math.abs(d) * 10);
      }
      last = bank;
    }
  }
  return out;
}

function sweep(cfg: DirectSteerConfig): { body: number; bank: number } {
  const max = { body: 0, bank: 0 };
  for (const pitch of [-84, -80, -76, 76, 80, 84])
    for (let bank = -165; bank <= 165; bank += 30)
      for (const stick of STICKS) {
        const m = maxVerticalRoll(cfg, pitch, bank, stick);
        max.body = Math.max(max.body, m.body);
        max.bank = Math.max(max.bank, m.bank);
      }
  return max;
}

describe('真上・真下の近くの横回転（9-5b）', () => {
  it('±70° より先では横回転の速さを抑える（9-5 までは数百°/秒になる場面がある）', () => {
    const before = sweep(BEFORE);
    const after = sweep(DIRECT_STEER_CONFIG);
    console.log(
      `真上・真下の近くの横回転の最大（機体の軸 / バンク角）: 9-5 まで ${before.body.toFixed(0)} / ${before.bank.toFixed(0)}°/秒 → ${after.body.toFixed(0)} / ${after.bank.toFixed(0)}°/秒`,
    );
    // バンク角の変わる速さは、真上・真下の近くを縦に通るだけでも大きく出る（機体は回っていない）ので表示だけ
    expect(before.body).toBeGreaterThan(150);
    expect(after.body).toBeLessThan(100);
  });

  it('下へ一瞬だけ大きく倒しても背面へ回らない（倒し続けると回る）', () => {
    const bankAfter = (stick: Stick): number => {
      const a = plane(-30, 0);
      const steer = new DirectSteer();
      const c = createControls();
      let maxBank = 0;
      for (let i = 0; i < 60; i++) {
        const s = stick(i * DT);
        steer.apply(c, a.state, s.x, s.y, SEA, a.flight.spec);
        a.step(c, DT);
        const q = a.state.orientation;
        const r = rotateVec3({ x: 0, y: 0, z: 0 }, q, { x: 1, y: 0, z: 0 });
        const u = rotateVec3({ x: 0, y: 0, z: 0 }, q, { x: 0, y: 1, z: 0 });
        maxBank = Math.max(maxBank, Math.abs(Math.atan2(-r.y, u.y) / DEG));
      }
      return maxBank;
    };
    expect(bankAfter((t) => (t < 0.2 ? { x: 0, y: -1 } : { x: 0, y: 0 }))).toBeLessThan(30);
    expect(bankAfter(() => ({ x: 0, y: -1 }))).toBeGreaterThan(120);
  });
});
