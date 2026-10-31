// smallest-three の姿勢の圧縮（5-1。6-6 で net-protocol.test.ts から分けた）
import { describe, expect, it } from 'vitest';
import { normalizeQuat, type Quat } from '../src/flight/math';
import { ByteReader, ByteWriter, readQuat, writeQuat } from '../src/net/codec';
import { angleDeg, randomQuat, rng } from './quat-helpers';

describe('codec: smallest-three の圧縮誤差', () => {
  it('ランダムな 10000 個の姿勢で最大誤差 0.01° 未満、単位長さを保つ', () => {
    const r = rng(1);
    let worst = 0;
    for (let i = 0; i < 10000; i++) {
      const q = randomQuat(r);
      const w = new ByteWriter();
      writeQuat(w, q);
      const buf = w.finish();
      expect(buf.byteLength).toBe(6);
      const back = readQuat(new ByteReader(buf), { x: 0, y: 0, z: 0, w: 1 });
      worst = Math.max(worst, angleDeg(q, back));
      expect(Math.hypot(back.x, back.y, back.z, back.w)).toBeCloseTo(1, 6);
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('軸に沿った姿勢・符号が負の最大成分も戻る', () => {
    const cases: Quat[] = [
      { x: 0, y: 0, z: 0, w: 1 },
      { x: 0, y: 0, z: 0, w: -1 },
      { x: 1, y: 0, z: 0, w: 0 },
      { x: 0, y: -1, z: 0, w: 0 },
      normalizeQuat({ x: 0.5, y: 0.5, z: 0.5, w: 0.5 }),
      normalizeQuat({ x: -0.7, y: 0.1, z: 0.7, w: 0.1 }),
    ];
    for (const q of cases) {
      const w = new ByteWriter();
      writeQuat(w, q);
      const back = readQuat(new ByteReader(w.finish()), { x: 0, y: 0, z: 0, w: 1 });
      expect(angleDeg(q, back)).toBeLessThan(0.01);
    }
  });
});
