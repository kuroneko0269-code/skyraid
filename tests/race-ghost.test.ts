// リングレース（7-1）のゴースト: 位置・姿勢を 15Hz で記録 → base64 → 読んで時刻で補間する往復と、1 走行の大きさ
import { describe, expect, it } from 'vitest';
import { RACE_CONFIG } from '../src/data/race';
import { headingQuat } from '../src/entities/enemy-aircraft';
import { normalizeQuat, quatIdentity, type Quat } from '../src/flight/math';
import { GhostRecorder, GhostTrack } from '../src/missions/race/ghost';

const DT = 1 / 60;

/** 時刻 t の「飛行」: 半径 2000m の円を回りながら上下し、ロールする */
function pose(t: number): { p: { x: number; y: number; z: number }; q: Quat } {
  const a = t * 0.12;
  const p = { x: 2000 * Math.sin(a), y: 600 + 200 * Math.sin(t * 0.5), z: 2000 * Math.cos(a) };
  const h = headingQuat(quatIdentity(), (a * 180) / Math.PI + 90);
  const roll = t * 0.8;
  const r = { x: 0, y: 0, z: Math.sin(roll / 2), w: Math.cos(roll / 2) };
  const q = {
    x: h.w * r.x + h.x * r.w + h.y * r.z - h.z * r.y,
    y: h.w * r.y - h.x * r.z + h.y * r.w + h.z * r.x,
    z: h.w * r.z + h.x * r.y - h.y * r.x + h.z * r.w,
    w: h.w * r.w - h.x * r.x - h.y * r.y - h.z * r.z,
  };
  return { p, q: normalizeQuat(q) };
}

/** 2 つの姿勢のなす角（度） */
function angleDeg(a: Quat, b: Quat): number {
  const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return (2 * Math.acos(Math.min(1, d)) * 180) / Math.PI;
}

function record(seconds: number): GhostRecorder {
  const rec = new GhostRecorder();
  for (let t = 0; t <= seconds + 1e-9; t += DT) {
    const { p, q } = pose(t);
    rec.record(t, p, q);
  }
  return rec;
}

describe('ゴースト', () => {
  it('15Hz で記録する（60Hz の固定ステップから 4 ステップに 1 回）', () => {
    const rec = record(10);
    expect(RACE_CONFIG.ghostHz).toBe(15);
    expect(rec.count).toBe(151);
  });

  it('記録 → 文字列 → 再生の往復: 位置は 0.5m 以内、姿勢は 1° 以内（サンプルの間は補間）', () => {
    const track = GhostTrack.decode(record(60).encode());
    if (!track) throw new Error('読めない');
    expect(track.duration).toBeCloseTo(60, 5);
    const p = { x: 0, y: 0, z: 0 };
    const q = quatIdentity();
    let maxPos = 0;
    let maxAngle = 0;
    for (let t = 0; t <= 60; t += 0.37) {
      track.sample(t, p, q);
      const want = pose(t);
      maxPos = Math.max(maxPos, Math.hypot(p.x - want.p.x, p.y - want.p.y, p.z - want.p.z));
      maxAngle = Math.max(maxAngle, angleDeg(q, want.q));
    }
    // 1/15 秒の間の線形補間（円の弦）と 0.25m の量子化
    expect(maxPos).toBeLessThan(0.5);
    expect(maxAngle).toBeLessThan(1);
  });

  it('記録したちょうどの時刻は量子化の誤差だけ', () => {
    const track = GhostTrack.decode(record(5).encode());
    if (!track) throw new Error('読めない');
    const p = { x: 0, y: 0, z: 0 };
    const q = quatIdentity();
    track.sample(2, p, q);
    const want = pose(2);
    expect(Math.abs(p.x - want.p.x)).toBeLessThanOrEqual(RACE_CONFIG.ghostPositionStep / 2 + 1e-6);
    expect(angleDeg(q, want.q)).toBeLessThan(0.05);
    // 最後を過ぎたら最後のまま、負の時刻は最初
    track.sample(100, p, q);
    expect(p.x).toBeCloseTo(pose(5).p.x, 0);
    track.sample(-1, p, q);
    expect(p.z).toBeCloseTo(2000, 0);
  });

  it('南向き（w ≈ 0 で符号が反転する）の前後でも補間が裏返らない', () => {
    const rec = new GhostRecorder();
    const p = { x: 0, y: 500, z: 0 };
    rec.record(0, p, headingQuat(quatIdentity(), 179));
    rec.record(1 / 15, p, headingQuat(quatIdentity(), 181));
    const track = GhostTrack.decode(rec.encode());
    if (!track) throw new Error('読めない');
    const q = quatIdentity();
    track.sample(1 / 30, p, q);
    expect(angleDeg(q, headingQuat(quatIdentity(), 180))).toBeLessThan(0.5);
  });

  it('1 走行（90 秒）は約 20KB', () => {
    const text = record(90).encode();
    // 1351 サンプル × 12 バイト = 16.2KB → base64 で 21.6KB
    expect(text.length).toBeGreaterThan(18_000);
    expect(text.length).toBeLessThan(23_000);
  });

  it('壊れた文字列は読めない（null）', () => {
    expect(GhostTrack.decode('')).toBeNull();
    expect(GhostTrack.decode('!!!')).toBeNull();
    expect(GhostTrack.decode(btoa('12345'))).toBeNull();
  });
});
