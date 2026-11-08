// 10-5a: UFO ゼノリスの光線: 予兆を見て正しく避ければ当たらない（溜め撃ちは溜めの間に横へ・なぎ払いは予兆の線の高さから上か下へ）。
// 避けなければ当たる。砲口を壊すと溜め撃ちを使わない（なぎ払いは続けて使える）
import { describe, expect, it } from 'vitest';
import { XenolithKaiju, type XenolithTarget } from '../src/ai/xenolith-ai';
import { startAttack } from '../src/ai/xenolith-attacks';
import { XENOLITH_CHARGED, XENOLITH_SWEEP } from '../src/data/xenolith';
import { vec3, type Vec3 } from '../src/flight/math';

const DT = 1 / 60;
const flat = (): number => 0;

function still(): XenolithTarget & { position: Vec3 } {
  return { position: vec3(0, 500, 0), active: true, id: 0, radius: 8 };
}

function orbit(): XenolithTarget & { position: Vec3; tick(): void } {
  const pos = vec3(0, 500, 0);
  let t = 0;
  return {
    position: pos,
    active: true,
    id: 0,
    radius: 8,
    tick() {
      t += DT;
      pos.x = Math.cos(t * 0.15) * 1200;
      pos.z = Math.sin(t * 0.15) * 1200;
      pos.y = 450 + Math.sin(t * 0.4) * 200;
    },
  };
}

function spawnAt(k: XenolithKaiju, seed = 5, hp = 1, broken: readonly string[] = []): void {
  k.spawn(0, 600, -1500, 0, seed, hp, broken);
  k.immortal = true;
}

describe('ゼノリスの光線（10-5a）', () => {
  it('溜め撃ち: ロック警告の間は追い、溜めの間に横へ 150m 逃げれば外れる。逃げなければ当たる（10-5b で 40）。砲口を壊すと使わない', () => {
    const shot = (dodge: boolean): number => {
      const k = new XenolithKaiju(flat);
      spawnAt(k);
      const p = k.body.position;
      const t = still();
      t.position.x = p.x + 300;
      t.position.y = p.y + 50;
      t.position.z = p.z + 900;
      k.cooldown = 99;
      k.warpTimer = 99;
      startAttack(k, 'charged', t, k.random.next);
      let dmg = 0;
      let lockMoved = false;
      for (let i = 0; i < 6 / DT; i++) {
        if (k.beam.phase === 'warn') {
          t.position.x += 40 * DT;
          lockMoved = true;
        }
        if (dodge && k.beam.phase === 'charge' && k.beam.time < 0.4)
          t.position.x += (150 / 0.4) * DT;
        k.step(DT, t, (_a, d) => {
          dmg += d;
        });
      }
      expect(lockMoved).toBe(true);
      return dmg;
    };
    expect(shot(false)).toBe(XENOLITH_CHARGED.damage);
    expect(shot(true)).toBe(0);
    const k = new XenolithKaiju(flat);
    spawnAt(k, 5, 1, ['cannon']);
    const t = orbit();
    for (let i = 0; i < 120 / DT; i++) {
      t.tick();
      k.step(DT, t);
    }
    expect(k.attacksUsed.charged).toBe(0);
    expect(k.attacksUsed.sweep).toBeGreaterThan(3);
  });

  it('なぎ払い: 予兆の線の高さにいると当たる（10-5b で 45）。予兆を見て 0.6 秒後に上へ 120m 動けば外れる', () => {
    const shot = (climb: boolean): number => {
      const k = new XenolithKaiju(flat);
      spawnAt(k);
      const p = k.body.position;
      const t = still();
      t.position.x = p.x;
      t.position.y = p.y + 30;
      t.position.z = p.z + 800;
      k.cooldown = 99;
      k.warpTimer = 99;
      // 体を狙う人へ向けてから始める
      for (let i = 0; i < 60; i++) k.step(DT, t);
      startAttack(k, 'sweep', t, k.random.next);
      let dmg = 0;
      for (let i = 0; i < 5 / DT; i++) {
        if (climb && k.beam.phase === 'warn' && k.beam.time > 0.6 && k.beam.time < 1.2)
          t.position.y += (120 / 0.6) * DT;
        k.step(DT, t, (_a, d) => {
          dmg += d;
        });
      }
      return dmg;
    };
    expect(shot(false)).toBe(XENOLITH_SWEEP.damage);
    expect(shot(true)).toBe(0);
  });
});
