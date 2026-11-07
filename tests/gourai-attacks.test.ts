// 10-4a: メカ怪獣ゴウライの大きな攻撃: 一斉発射はフレアで外れる（撒かなければ当たる）・砲台を壊すと数が減る・
// 回転掃射は危ない高さの輪の外（上）へ出れば当たらない・予兆の間は撃たない
import { describe, expect, it } from 'vitest';
import { GouraiKaiju } from '../src/ai/gourai-ai';
import { inSweepBand } from '../src/ai/gourai-attacks';
import type { Flare } from '../src/combat/flare';
import { Pool } from '../src/combat/pool';
import { GOURAI_CONFIG as C } from '../src/data/gourai';
import type { GouraiPatrol } from '../src/entities/gourai/gourai-body';
import { vec3 } from '../src/flight/math';

const DT = 1 / 60;
const PATROL: GouraiPatrol = { x: 500, z: -800, radius: C.patrol.radius };

function mk(seed: number, broken: string[] = []): GouraiKaiju {
  const k = new GouraiKaiju(() => 0);
  k.spawn(PATROL, PATROL.x, PATROL.z - PATROL.radius, 0, seed, 1, broken);
  return k;
}

describe('メカ怪獣ゴウライの大きな攻撃（10-4a）', () => {
  it('一斉発射: 8 発を扇に。フレアを撒けば外れ、撒かなければ当たる。砲台を壊すと数が減り、2 つとも壊すと使わない', () => {
    const volleyRun = (
      withFlares: boolean,
      broken: string[] = [],
    ): { hits: number; fired: number; used: number } => {
      const k = mk(21, broken);
      k.immortal = true;
      // 弾幕は止めて、一斉発射だけ（後ろの上にいて機銃が届かない所）
      for (let i = 0; i < k.barrage.cooldown.length; i++) k.barrage.cooldown[i] = 1e9;
      k.cooldown = 0.5;
      const flares = new Pool<Flare>(16, () => ({
        active: false,
        owner: 0,
        burst: 0,
        position: vec3(),
        prevPosition: vec3(),
        velocity: vec3(),
        age: 0,
      }));
      let missileHits = 0;
      const pos = vec3();
      const me = { position: pos, active: true, id: 0, radius: 8 };
      let burst = 0;
      // 始めの体の後ろ上 1400m・高さ +500m の所（世界に固定）を、ゆっくり横へ飛ぶ（ミサイルが来る）
      const b0 = {
        x: k.body.position.x,
        y: k.body.position.y,
        z: k.body.position.z,
        h: k.body.heading,
      };
      for (let i = 0; i < 20 / DT; i++) {
        pos.x = b0.x + Math.sin(b0.h) * 1400 + i * DT * 40;
        pos.z = b0.z + Math.cos(b0.h) * 1400;
        pos.y = b0.y + 500;
        // 一斉発射の後 3 秒でフレア（自機の位置に 4 つ）
        if (withFlares && k.action === 'active' && k.attack === 'volley' && burst === 0) burst = i;
        if (withFlares && burst > 0 && i === burst + 150) {
          for (let f = 0; f < 4; f++) {
            const fl = flares.acquire();
            if (!fl) break;
            Object.assign(fl, { active: true, owner: 0, burst: 1, age: 0 });
            fl.position.x = pos.x + f * 5;
            fl.position.y = pos.y - 20;
            fl.position.z = pos.z;
          }
        }
        k.step(DT, me, flares, (kind) => {
          if (kind === 'missile') missileHits++;
        });
        if (k.attacksUsed.volley > 1) break;
      }
      return { hits: missileHits, fired: k.fired.missile, used: k.attacksUsed.volley };
    };
    const plain = volleyRun(false);
    const flared = volleyRun(true);
    const onePod = volleyRun(false, ['podL']);
    const noPod = volleyRun(false, ['podL', 'podR']);
    console.info(
      `gourai volley: no flare hits ${String(plain.hits)}/${String(plain.fired)}, flare hits ${String(flared.hits)}/${String(flared.fired)}, one pod fired ${String(onePod.fired)}`,
    );
    expect(plain.fired).toBe(C.attacks.volley.perPod * 2);
    expect(plain.hits).toBeGreaterThan(0);
    expect(flared.hits).toBe(0);
    expect(onePod.fired).toBe(C.attacks.volley.perPod);
    expect(noPod.used).toBe(0);
  });

  it('回転掃射: 危ない高さの輪にいると当たり、上へ外れると当たらない。予兆の間は撃たない', () => {
    const sweepRun = (dy: number): { hits: number; inBand: boolean; windupShots: number } => {
      const k = mk(12);
      k.immortal = true;
      for (let i = 0; i < k.barrage.cooldown.length; i++) k.barrage.cooldown[i] = 1e9;
      k.cooldown = 0.2;
      const pos = vec3();
      const me = { position: pos, active: true, id: 0, radius: 8 };
      let hits = 0;
      let windupShots = 0;
      let inBand = false;
      for (let i = 0; i < 8 / DT; i++) {
        const b = k.body;
        // 横 600m を、体の周りをゆっくり回る（掃射の弾が通る）
        const a = i * DT * 0.15;
        pos.x = b.position.x + Math.cos(a) * 600;
        pos.z = b.position.z + Math.sin(a) * 600;
        pos.y = b.position.y + dy;
        inBand = inSweepBand(b, pos);
        const before = k.fired.gun;
        k.step(DT, me, null, (kind) => {
          if (kind === 'gun') hits++;
        });
        if (k.action === 'windup') windupShots += k.fired.gun - before;
      }
      expect(k.attacksUsed.sweep).toBe(1);
      return { hits, inBand, windupShots };
    };
    const level = sweepRun(25);
    const above = sweepRun(C.attacks.sweep.bandHigh + 40);
    console.info(
      `gourai sweep: level hits ${String(level.hits)}, above hits ${String(above.hits)}`,
    );
    expect(level.inBand).toBe(true);
    expect(level.hits).toBeGreaterThan(0);
    expect(above.inBand).toBe(false);
    expect(above.hits).toBe(0);
    expect(level.windupShots).toBe(0);
  });
});
