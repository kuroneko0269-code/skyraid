import { describe, expect, it } from 'vitest';
import { segmentSphere } from '../src/combat/collision';
import { Health } from '../src/combat/damage';
import { GunHeat } from '../src/combat/heat';
import { Pool } from '../src/combat/pool';
import { GUN_CONFIG } from '../src/data/weapons';

const DT = 1 / 60;

describe('線分と球の交差', () => {
  it('球を貫く線分は手前の交点の位置（0〜1）を返す', () => {
    // x = -10 → +10 の線分、原点の半径 2 の球 → x = -2 で入る（t = 0.4）
    expect(segmentSphere(-10, 0, 0, 10, 0, 0, 0, 0, 0, 2)).toBeCloseTo(0.4);
  });

  it('外れる・届かない・遠ざかる線分は -1', () => {
    expect(segmentSphere(-10, 3, 0, 10, 3, 0, 0, 0, 0, 2)).toBe(-1);
    expect(segmentSphere(-10, 0, 0, -5, 0, 0, 0, 0, 0, 2)).toBe(-1);
    expect(segmentSphere(5, 0, 0, 10, 0, 0, 0, 0, 0, 2)).toBe(-1);
  });

  it('始点が球の中なら 0', () => {
    expect(segmentSphere(0.5, 0, 0, 10, 0, 0, 0, 0, 0, 2)).toBe(0);
  });

  it('両端が球の外でも途中で貫いていれば当たる（すり抜けない）', () => {
    // 1 ステップで 20m 進む弾と半径 1m の球
    expect(segmentSphere(0, 0, -10, 0, 0, 10, 0, 0.5, 0, 1)).toBeGreaterThan(0);
  });

  it('かすめる線分（接線）も当たる', () => {
    expect(segmentSphere(-10, 2, 0, 10, 2, 0, 0, 0, 0, 2)).toBeCloseTo(0.5);
  });

  it('長さ 0 の線分は球の外なら -1', () => {
    expect(segmentSphere(5, 0, 0, 5, 0, 0, 0, 0, 0, 2)).toBe(-1);
  });
});

describe('熱ゲージ', () => {
  const spec = GUN_CONFIG.heat;

  it('撃つと上がり、上限でオーバーヒートして撃てなくなる', () => {
    const h = new GunHeat(spec);
    h.addShot();
    expect(h.value).toBeCloseTo(spec.perShot);
    let shots = 1;
    while (h.canFire && shots < 1000) {
      h.addShot();
      shots++;
    }
    expect(h.overheated).toBe(true);
    expect(h.value).toBe(1);
    expect(shots).toBe(Math.ceil(1 / spec.perShot - 1e-9));
  });

  it('撃つのをやめて coolDelay 秒たってから冷える', () => {
    const h = new GunHeat(spec);
    for (let i = 0; i < 30; i++) h.addShot();
    const before = h.value;
    h.step(spec.coolDelay * 0.5);
    expect(h.value).toBe(before);
    h.step(spec.coolDelay * 0.5);
    h.step(1);
    expect(h.value).toBeCloseTo(before - spec.coolRate * 1);
    h.step(100);
    expect(h.value).toBe(0);
  });

  it('オーバーヒートは recoverBelow まで冷えると解除される', () => {
    const h = new GunHeat(spec);
    while (h.canFire) h.addShot();
    let t = 0;
    while (h.overheated && t < 10) {
      h.step(DT);
      t += DT;
    }
    expect(h.overheated).toBe(false);
    expect(h.value).toBeLessThanOrEqual(spec.recoverBelow);
    // 1 → recoverBelow を coolRate で冷やす時間
    expect(t).toBeCloseTo((1 - spec.recoverBelow) / spec.coolRate, 1);
  });

  it('reset で 0 に戻る', () => {
    const h = new GunHeat(spec);
    while (h.canFire) h.addShot();
    h.reset();
    expect(h.value).toBe(0);
    expect(h.canFire).toBe(true);
  });
});

describe('ダメージ', () => {
  it('HP が減り、0 で破壊される。破壊した被弾だけ true', () => {
    const h = new Health(30);
    expect(h.applyDamage(10)).toBe(false);
    expect(h.hp).toBe(20);
    expect(h.isDestroyed).toBe(false);
    expect(h.applyDamage(25)).toBe(true);
    expect(h.hp).toBe(0);
    expect(h.isDestroyed).toBe(true);
    // 破壊後の被弾は無視
    expect(h.applyDamage(10)).toBe(false);
    expect(h.hp).toBe(0);
  });

  it('0 以下・NaN のダメージは無視', () => {
    const h = new Health(10);
    expect(h.applyDamage(0)).toBe(false);
    expect(h.applyDamage(-5)).toBe(false);
    expect(h.applyDamage(NaN)).toBe(false);
    expect(h.hp).toBe(10);
  });

  it('reset で満タンに戻る', () => {
    const h = new Health(10);
    h.applyDamage(10);
    h.reset();
    expect(h.hp).toBe(10);
    expect(h.isDestroyed).toBe(false);
  });

  it('maxHp は正の値', () => {
    expect(() => new Health(0)).toThrow();
  });
});

describe('オブジェクトプール', () => {
  it('容量まで取り出せて、満杯なら null', () => {
    const pool = new Pool(3, () => ({ v: 0 }));
    expect(pool.acquire()).not.toBeNull();
    expect(pool.acquire()).not.toBeNull();
    expect(pool.acquire()).not.toBeNull();
    expect(pool.acquire()).toBeNull();
    expect(pool.count).toBe(3);
  });

  it('解放した要素を作り直さずに再利用する', () => {
    let created = 0;
    const pool = new Pool(4, () => ({ id: created++ }));
    expect(created).toBe(4);
    const seen = new Set<object>();
    for (let round = 0; round < 50; round++) {
      const a = pool.acquire();
      const b = pool.acquire();
      if (a) seen.add(a);
      if (b) seen.add(b);
      pool.release(1);
      pool.release(0);
    }
    expect(created).toBe(4);
    expect(seen.size).toBeLessThanOrEqual(4);
    expect(pool.count).toBe(0);
  });

  it('release は末尾の要素を詰める', () => {
    let n = 0;
    const pool = new Pool(3, () => ({ id: n++ }));
    const a = pool.acquire();
    pool.acquire();
    const c = pool.acquire();
    pool.release(0);
    expect(pool.count).toBe(2);
    expect(pool.get(0)).toBe(c);
    // 解放した要素は次に取り出される
    expect(pool.acquire()).toBe(a);
  });

  it('使用中でない番号は get で例外、release は無視', () => {
    const pool = new Pool(2, () => ({}));
    expect(() => pool.get(0)).toThrow();
    pool.release(0);
    expect(pool.count).toBe(0);
  });
});
