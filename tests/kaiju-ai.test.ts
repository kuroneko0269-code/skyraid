// 怪獣 AI（6-2）: 攻撃の選択ルール、予兆 → 攻撃の時間と当たり
import { describe, expect, it } from 'vitest';
import { chooseAttack, repeatedTooOften } from '../src/ai/kaiju-attacks';
import { KaijuAi } from '../src/ai/kaiju-ai';
import { KAIJU_ATTACK_CONFIG as A, KAIJU_ATTACKS } from '../src/data/kaiju';
import { Kaiju } from '../src/entities/kaiju';
import { DT, flat, landed, target } from './kaiju-helpers';

describe('攻撃の選択ルール', () => {
  const all = (): boolean => true;

  it('最も近い機体の距離と高さで選ぶ', () => {
    expect(chooseAttack(200, 100, all, [])).toBe('sweep');
    expect(chooseAttack(600, 300, all, [])).toBe('roar');
    expect(chooseAttack(500, 700, all, [])).toBe('throw');
    expect(chooseAttack(1500, 300, all, [])).toBe('beam');
  });

  it('使えない攻撃は飛ばして次を選ぶ', () => {
    expect(chooseAttack(200, 100, (a) => a !== 'sweep', [])).toBe('roar');
    expect(chooseAttack(1500, 300, (a) => a !== 'beam', [])).toBe('throw');
    expect(chooseAttack(1500, 300, (a) => a === 'roar', [])).toBeNull();
  });

  it('同じ攻撃を 3 回連続しない', () => {
    expect(repeatedTooOften('beam', ['beam'])).toBe(false);
    expect(repeatedTooOften('beam', ['roar', 'beam', 'beam'])).toBe(true);
    expect(chooseAttack(1500, 300, all, ['beam', 'beam'])).toBe('throw');
    expect(chooseAttack(1500, 300, all, ['beam', 'throw'])).toBe('beam');
  });

  it('AI は 1 機を狙い続けても同じ攻撃を 3 回続けない', () => {
    const { ai } = landed(4);
    const t = [target(0, 0, 300, -1500)];
    for (let i = 0; i < 180 * 60; i++) ai.step(t, DT);
    const h = ai.history;
    expect(h.length).toBeGreaterThan(5);
    for (let i = 2; i < h.length; i++) expect(h[i] === h[i - 1] && h[i] === h[i - 2]).toBe(false);
  });

  it('M5 のように使える攻撃を絞ると、それ以外は選ばない', () => {
    const kaiju = new Kaiju(flat);
    const ai = new KaijuAi(kaiju, { damage: () => undefined, stun: () => undefined });
    kaiju.emerge(0, 0, 0, -1000, { players: 1, retreatRatio: 0.2 });
    ai.configure({ goal: { x: 0, z: -1000 }, attacks: ['roar', 'throw'] });
    const t = [target(0, 0, 300, -1500), target(1, 100, 100, -150)];
    for (let i = 0; i < 200 * 60; i++) ai.step(t, DT);
    expect(ai.history.length).toBeGreaterThan(3);
    expect(ai.history.every((a) => a === 'roar' || a === 'throw')).toBe(true);
  });
});

describe('予兆 → 攻撃の時間と当たり', () => {
  it('予兆の長さ（薙ぎ払い 1.5・咆哮 2・熱線 2.5・投擲 1.2 秒）が過ぎてから攻撃が始まる', () => {
    for (const a of KAIJU_ATTACKS) {
      const { kaiju, ai } = landed(4);
      ai.begin(a, 0);
      const t = [target(0, 0, 3000, -9000)];
      let steps = 0;
      while (kaiju.attackStep === 'windup' && kaiju.attack === a && steps < 1000) {
        ai.step(t, DT);
        steps++;
      }
      expect([a, steps * DT]).toEqual([a, expect.closeTo(A[a].windup, 1)]);
      expect(kaiju.attackStep).toBe('active');
    }
  });

  it('薙ぎ払い: 足元から 250m・高さ 200m 以下に 1 回だけ当たる。高いところは当たらない', () => {
    const { ai, hits } = landed(4);
    ai.begin('sweep', 0);
    const low = target(0, 150, 100, 0);
    const high = target(1, 150, 400, 0);
    for (let i = 0; i < 5 * 60; i++) ai.step([low, high], DT);
    expect(hits.filter((h) => h.id === 0)).toEqual([
      { id: 0, amount: A.sweep.damage, attack: 'sweep' },
    ]);
    expect(hits.filter((h) => h.id === 1)).toEqual([]);
  });

  it('咆哮: 800m 以内でスタン 2 秒。高度 600m 以上と、フレアを撒いた機体には効かない', () => {
    const { kaiju, ai, stuns } = landed(4);
    ai.begin('roar', 0);
    const head = kaiju.part('head').position;
    const near = target(0, head.x + 300, 300, head.z);
    const high = target(1, head.x + 300, 650, head.z);
    const flared = target(2, head.x - 300, 300, head.z, 0.5);
    const far = target(3, head.x + 1200, 300, head.z);
    for (let i = 0; i < 3 * 60; i++) ai.step([near, high, flared, far], DT);
    expect(stuns).toEqual([{ id: 0, s: A.roar.stunSeconds }]);
  });

  it('熱線: 動かない機体には 3 秒で約 240、横へ逃げる機体には途中から外れる', () => {
    const still = landed(4);
    const t = target(0, 0, 200, -1000);
    still.ai.begin('beam', 0);
    for (let i = 0; i < 8 * 60; i++) still.ai.step([t], DT);
    const total = still.hits.reduce((s, h) => s + h.amount, 0);
    expect(total).toBeCloseTo(A.beam.damagePerSecond * A.beam.active, -1);

    const run = landed(4);
    const m = target(0, 0, 200, -1000);
    run.ai.begin('beam', 0);
    for (let i = 0; i < 8 * 60; i++) {
      if (run.kaiju.attackStep === 'active') m.position.x += 230 * DT;
      run.ai.step([m], DT);
    }
    const dodged = run.hits.reduce((s, h) => s + h.amount, 0);
    expect(dodged).toBeLessThan(total * 0.5);
  });

  it('投擲: 動かない機体には当たり（120）、投げた後に動けば外れる', () => {
    const a = landed(4);
    const t = target(0, 0, 500, -1200);
    a.ai.begin('throw', 0);
    for (let i = 0; i < 10 * 60; i++) a.ai.step([t], DT);
    expect(a.hits).toEqual([{ id: 0, amount: A.throw.damage, attack: 'throw' }]);
    const b = landed(4);
    const m = target(0, 0, 500, -1200);
    b.ai.begin('throw', 0);
    for (let i = 0; i < 10 * 60; i++) {
      if (b.kaiju.attackStep !== 'windup' || b.kaiju.attack === null) m.position.x += 230 * DT;
      b.ai.step([m], DT);
    }
    expect(b.hits).toEqual([]);
  });
});
