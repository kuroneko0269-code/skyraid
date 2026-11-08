// 10-5a: UFO ゼノリスは速い（急加速 320 m/s・瞬間移動）が、判定の抜けが無いこと: 機銃の弾が体をすり抜けない（本番の Gun と撃てる物）・
// 体へ自機がぶつかったら必ず捕まえる（体から見た相対の動きで調べる。体が自機へ突っ込んでも、すれ違っても）・瞬間移動で間を通る線を作らない
import { describe, expect, it } from 'vitest';
import { XenolithKaiju } from '../src/ai/xenolith-ai';
import { createHullContact } from '../src/ai/albion-hull';
import { xenolithContact } from '../src/ai/xenolith-hull';
import { Gun } from '../src/combat/gun';
import { XENOLITH_CONFIG as C } from '../src/data/xenolith';
import {
  createXenolithTargets,
  type XenolithPartTarget,
} from '../src/entities/xenolith/xenolith-target';
import { quatIdentity, quatFromRotationVector, vec3 } from '../src/flight/math';

const DT = 1 / 60;

describe('ゼノリスの判定の抜け（10-5a）', () => {
  it('機銃: 急加速（320 m/s）・急停止の最中に横 400m から見越して撃つと、届いた弾はすべて体のどこかに当たる', () => {
    const k = new XenolithKaiju(() => 0);
    k.spawn(0, 600, -1500, 0, 13);
    k.immortal = true;
    const host = { kaiju: k, damageSphere: (s: number, a: number) => k.damageSphere(s, a) };
    const targets = createXenolithTargets(host);
    for (const t of targets) t.place(true);
    let hits = 0;
    const gun = new Gun<XenolithPartTarget>(undefined, () => {
      hits++;
    });
    const shooter = { position: vec3(), orientation: quatIdentity(), speed: 0 };
    const player = { position: vec3(0, 600, 0), active: true, id: 0, radius: 8 };
    let fastSteps = 0;
    for (let i = 0; i < 90 / DT; i++) {
      // 狙う人は遠くを回る（体は回りながら急停止・急加速する）
      const a = i * DT * 0.2;
      player.position.x = Math.cos(a) * 1200;
      player.position.z = Math.sin(a) * 1200;
      k.step(DT, player);
      for (const t of targets) t.place(false, DT);
      const b = k.body;
      if (b.speed > 280) fastSteps++;
      // 撃つ人: 体の進む向きの横 400m・同じ高さ。体の進む先を見越して撃つ
      const v = b.velocity;
      const h = Math.hypot(v.x, v.z) || 1;
      const sx = b.position.x + (-v.z / h) * 400;
      const sz = b.position.z + (v.x / h) * 400;
      shooter.position.x = sx;
      shooter.position.y = b.position.y;
      shooter.position.z = sz;
      const tof = 400 / 900;
      const ax = b.position.x + v.x * tof - sx;
      const ay = b.position.y + v.y * tof - b.position.y;
      const az = b.position.z + v.z * tof - sz;
      // 機首（−Z）を (ax, ay, az) へ向ける
      const yaw = Math.atan2(-ax, -az);
      const pitch = Math.atan2(ay, Math.hypot(ax, az));
      const qy = quatFromRotationVector(quatIdentity(), 0, yaw, 0);
      const qp = quatFromRotationVector(quatIdentity(), pitch, 0, 0);
      const o = shooter.orientation;
      // o = qy * qp
      o.w = qy.w * qp.w - qy.x * qp.x - qy.y * qp.y - qy.z * qp.z;
      o.x = qy.w * qp.x + qy.x * qp.w + qy.y * qp.z - qy.z * qp.y;
      o.y = qy.w * qp.y - qy.x * qp.z + qy.y * qp.w + qy.z * qp.x;
      o.z = qy.w * qp.z + qy.x * qp.y - qy.y * qp.x + qy.z * qp.w;
      // 瞬間移動の直後は撃たない（撃つ人が体と一緒に跳ぶので）
      gun.step(!b.warped && i % 4 === 0, shooter, targets, DT);
    }
    // 弾は 0.45 秒で届く。撃った数のうち、まだ飛んでいる数を除いた分が当たっている
    const fired = gun.shotCount - gun.bullets.count;
    expect(fired).toBeGreaterThan(300);
    expect(fastSteps).toBeGreaterThan(30);
    expect(hits / fired).toBeGreaterThan(0.97);
  });

  it('体への衝突: 体が 320 m/s で止まっている自機へ突っ込んでも、自機が 250 m/s ですれ違っても、薄い縁をかすめても捕まえる', () => {
    const out = createHullContact();
    const M = C.collision.margin;
    const S = C.collision.sampleStep;
    const sweep = (
      body0: { x: number; y: number; z: number },
      bodyV: { x: number; y: number; z: number },
      air0: { x: number; y: number; z: number },
      airV: { x: number; y: number; z: number },
      seconds: number,
    ): boolean => {
      const bp = vec3(body0.x, body0.y, body0.z);
      const bn = vec3();
      const ap = vec3(air0.x, air0.y, air0.z);
      const an = vec3();
      for (let i = 0; i < seconds / DT; i++) {
        bn.x = bp.x + bodyV.x * DT;
        bn.y = bp.y + bodyV.y * DT;
        bn.z = bp.z + bodyV.z * DT;
        an.x = ap.x + airV.x * DT;
        an.y = ap.y + airV.y * DT;
        an.z = ap.z + airV.z * DT;
        if (xenolithContact(bp, bn, ap, an, M, S, out)) return true;
        bp.x = bn.x;
        bp.y = bn.y;
        bp.z = bn.z;
        ap.x = an.x;
        ap.y = an.y;
        ap.z = an.z;
      }
      return false;
    };
    // 体が突っ込む（自機は止まっている）
    expect(
      sweep(
        { x: -400, y: 0, z: 0 },
        { x: 320, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        3,
      ),
    ).toBe(true);
    expect(out.normal.x).toBeGreaterThan(0.5);
    // 向かい合ってすれ違う（相対 570 m/s・1 ステップ 9.5m。円盤の厚さ 30m）を真ん中の高さで
    expect(
      sweep(
        { x: -400, y: 0, z: 0 },
        { x: 320, y: 0, z: 0 },
        { x: 400, y: 5, z: 30 },
        { x: -250, y: 0, z: 0 },
        3,
      ),
    ).toBe(true);
    // 縁（半径 78m）を真上から下へ抜ける
    expect(
      sweep(
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 78, y: 300, z: 0 },
        { x: 0, y: -250, z: 0 },
        3,
      ),
    ).toBe(true);
    // 外れる線（縁の外 100m）は捕まえない
    expect(
      sweep(
        { x: -400, y: 0, z: 0 },
        { x: 320, y: 0, z: 0 },
        { x: 400, y: 0, z: 110 },
        { x: -250, y: 0, z: 0 },
        3,
      ),
    ).toBe(false);
    // 上のドームの真上から下りる
    expect(
      sweep(
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 200, z: 0 },
        { x: 0, y: -250, z: 0 },
        2,
      ),
    ).toBe(true);
    expect(out.normal.y).toBeGreaterThan(0.9);
  });

  it('瞬間移動: 移った直後は前の位置 = 今の位置（描画の補間・判定の線が間を通らない）。撃てる物も同じ', () => {
    const k = new XenolithKaiju(() => 0);
    k.spawn(0, 600, -1500, 0, 13);
    const host = { kaiju: k, damageSphere: (s: number, a: number) => k.damageSphere(s, a) };
    const targets = createXenolithTargets(host);
    for (const t of targets) t.place(true);
    const player = { position: vec3(0, 600, 0), active: true, id: 0, radius: 8 };
    let seen = 0;
    for (let i = 0; i < 60 / DT; i++) {
      k.step(DT, player);
      for (const t of targets) t.place(false, DT);
      if (!k.body.warped) continue;
      seen++;
      const b = k.body;
      expect(b.prevPosition).toEqual(b.position);
      for (const t of targets) {
        expect(t.prevPosition).toEqual(t.position);
        expect(Math.hypot(t.velocity.x, t.velocity.y, t.velocity.z)).toBe(0);
      }
    }
    expect(seen).toBeGreaterThan(1);
  });
});
