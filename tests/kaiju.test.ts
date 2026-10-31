// 怪獣ヴォルガス（6-1 / 6-2）: 部位ダメージの配分、部位破壊の効果、フェーズ遷移、ブレイクの成立条件、人数スケール。
// 攻撃の選択と予兆は kaiju-ai.test.ts、ボットの所要時間とモデルは kaiju-raid.test.ts
import { describe, expect, it } from 'vitest';
import { CombatSystem } from '../src/combat/combat-system';
import { TEAM_PLAYER } from '../src/combat/target';
import { KAIJU_ATTACK_CONFIG as A, KAIJU_ATTACKS, KAIJU_CONFIG as K } from '../src/data/kaiju';
import { Kaiju, kaijuMaxHp } from '../src/entities/kaiju';
import { TargetField } from '../src/entities/target-balloon';

import { DT, flat, landed, target } from './kaiju-helpers';

describe('部位 HP と全体 HP', () => {
  it('部位ダメージはその部位と全体の両方を減らす（4 人は倍率 1）', () => {
    const { kaiju } = landed(4);
    const head = kaiju.part('head');
    const tail = kaiju.part('tail');
    head.damageBy(500, 0);
    expect(head.partHp).toBe(head.partMaxHp - 500);
    expect(tail.partHp).toBe(tail.partMaxHp);
    expect(kaiju.hp).toBe(kaiju.maxHp - 500);
    tail.damageBy(300, 1);
    expect(kaiju.hp).toBe(kaiju.maxHp - 800);
  });

  it('部位 HP は全体 HP の割合で、壊れた部位にもダメージは入り全体だけが減る（部位 HP は戻らない）', () => {
    const { kaiju } = landed(4);
    const head = kaiju.part('head');
    expect(head.partMaxHp).toBe(Math.round(kaiju.maxHp * K.parts.head.hpShare));
    head.damageBy(head.partMaxHp + 100, 0);
    expect(head.broken).toBe(true);
    expect(head.partHp).toBe(0);
    const before = kaiju.hp;
    head.damageBy(200, 0);
    expect(head.partHp).toBe(0);
    expect(kaiju.hp).toBe(before - 200);
  });

  it('1 人のときは部位ダメージ ×partyDamageScale[0]、ダウン中は ×2', () => {
    const { kaiju } = landed(1);
    const scale = K.partyDamageScale[0];
    kaiju.part('crystal').applyDamage(100);
    expect(kaiju.maxHp - kaiju.hp).toBeCloseTo(100 * scale, 6);
    kaiju.downTimer = 5;
    const before = kaiju.hp;
    kaiju.part('crystal').applyDamage(100);
    expect(before - kaiju.hp).toBeCloseTo(100 * scale * K.down.damageScale, 6);
  });

  it('全体 HP が 0 で倒れる（撃墜として true を返す）。撤退の割合がある（M5）なら倒れずに引き返す', () => {
    const { kaiju } = landed(4);
    expect(kaiju.part('tail').damageBy(kaiju.maxHp, 0)).toBe(true);
    expect(kaiju.stage).toBe('dead');
    expect(kaiju.isDestroyed).toBe(true);
    const k2 = new Kaiju(flat);
    k2.emerge(0, 0, 0, -100, { players: 1, retreatRatio: 0.2 });
    expect(k2.part('head').applyDamage(k2.maxHp)).toBe(false);
    expect(k2.stage).toBe('retreating');
    expect(k2.hp).toBeGreaterThanOrEqual(1);
  });

  it('範囲ダメージは怪獣の部位のうち爆心に最も近い 1 つだけに入る', () => {
    const k = new Kaiju(flat);
    k.emerge(0, 0, 0, -100, { players: 4 });
    for (let i = 0; i < K.riseSeconds * 60 + 1; i++) k.step(DT);
    k.finishStep();
    const combat = new CombatSystem(
      new TargetField(),
      null,
      () => 0.5,
      undefined,
      undefined,
      [],
      [],
      null,
      k.parts,
    );
    const c = k.part('crystal').position;
    const head = k.part('head').position;
    // 結晶と頭の間（どちらの球にも爆風が届く）で起爆
    combat.applyBlast(
      (c.x + head.x) / 2,
      (c.y + head.y) / 2,
      (c.z + head.z) / 2,
      { radius: 80, maxDamage: 100, edgeFraction: 0.5 },
      TEAM_PLAYER,
      TEAM_PLAYER,
    );
    const damaged = k.parts.filter((p) => p.partHp < p.partMaxHp);
    expect(damaged.length).toBe(1);
  });
});

describe('部位破壊の効果', () => {
  it('結晶 → 熱線、尾 → 薙ぎ払い、頭 → 咆哮が封じられる。投擲は封じられない', () => {
    const { kaiju, ai } = landed(4);
    for (const a of KAIJU_ATTACKS) expect(ai.usable(a)).toBe(true);
    kaiju.part('crystal').damageBy(kaiju.part('crystal').partMaxHp, 0);
    expect(ai.usable('beam')).toBe(false);
    kaiju.part('tail').damageBy(kaiju.part('tail').partMaxHp, 0);
    expect(ai.usable('sweep')).toBe(false);
    kaiju.part('head').damageBy(kaiju.part('head').partMaxHp, 0);
    expect(ai.usable('roar')).toBe(false);
    expect(ai.usable('throw')).toBe(true);
  });

  it('脚を壊すと 15 秒ダウン（止まって攻撃しない、攻撃中なら取り消す）。左右それぞれ 1 回', () => {
    const { kaiju, ai } = landed(4);
    ai.begin('throw', 0);
    const leg = kaiju.part('leftLeg');
    leg.damageBy(leg.partMaxHp, 0);
    expect(kaiju.downTimer).toBe(K.down.seconds);
    expect(kaiju.attack).toBeNull();
    const x = kaiju.feet.z;
    for (let i = 0; i < 10 * 60; i++) ai.step([target(0, 0, 300, -800)], DT);
    expect(kaiju.feet.z).toBe(x);
    expect(kaiju.attack).toBeNull();
    for (let i = 0; i < 6 * 60; i++) ai.step([], DT);
    expect(kaiju.downTimer).toBe(0);
    const right = kaiju.part('rightLeg');
    right.damageBy(right.partMaxHp, 0);
    expect(kaiju.downTimer).toBe(K.down.seconds);
  });

  it('予兆の間に部位を壊されたらその攻撃は取り消す', () => {
    const { kaiju, ai } = landed(4);
    ai.begin('beam', 0);
    ai.step([target(0, 0, 300, -1000)], DT);
    expect(kaiju.attack).toBe('beam');
    kaiju.part('crystal').damageBy(kaiju.part('crystal').partMaxHp, 0);
    ai.step([target(0, 0, 300, -1000)], DT);
    expect(kaiju.attack).toBeNull();
  });
});

describe('フェーズ', () => {
  it('HP 70% でフェーズ 2（攻撃間隔 ×0.8）、40% でフェーズ 3（最終フェーズの制限時間が始まる）', () => {
    const { kaiju, ai } = landed(4);
    const max = kaiju.maxHp;
    kaiju.part('crystal').damageBy(max * 0.29, 0);
    expect(kaiju.phase).toBe(1);
    kaiju.part('crystal').damageBy(max * 0.02, 0);
    expect(kaiju.phase).toBe(2);
    expect(kaiju.finalRemaining).toBeNull();
    // 攻撃が終わった後の間隔
    ai.begin('throw', 0);
    for (let i = 0; i < 4 * 60 && kaiju.attack; i++) ai.step([], DT);
    expect(ai.cooldown).toBeCloseTo(A.intervalSeconds * K.phases.phase2IntervalScale, 6);
    kaiju.part('crystal').damageBy(max * 0.3, 0);
    expect(kaiju.phase).toBe(3);
    expect(kaiju.finalRemaining).toBe(K.phases.finalSeconds);
  });

  it('フェーズ 2 から歩くのが ×1.3 速い', () => {
    const a = landed(4);
    const b = landed(4);
    b.kaiju.part('crystal').damageBy(b.kaiju.maxHp * 0.35, 0);
    a.ai.cooldown = b.ai.cooldown = 999;
    const z0 = a.kaiju.feet.z;
    for (let i = 0; i < 10 * 60; i++) {
      a.ai.step([], DT);
      b.ai.step([], DT);
    }
    const da = z0 - a.kaiju.feet.z;
    const db = z0 - b.kaiju.feet.z;
    expect(da).toBeCloseTo((K.walk.strideLength / K.walk.stepSeconds) * 10, 0);
    expect(db / da).toBeCloseTo(K.phases.phase2WalkScale, 2);
  });

  it('フェーズ 3 の熱線は 2 連射', () => {
    const { kaiju, ai } = landed(4);
    kaiju.part('tail').damageBy(kaiju.maxHp * 0.65, 0);
    expect(kaiju.phase).toBe(3);
    let shots = 0;
    ai.onEvent((e) => {
      if (e.kind === 'fire' && e.attack === 'beam') shots++;
    });
    ai.begin('beam', 0);
    for (let i = 0; i < 15 * 60 && (kaiju.attack || i === 0); i++)
      ai.step([target(0, 0, 300, -1500)], DT);
    expect(shots).toBe(2);
  });

  it('最終フェーズの制限時間が切れると街に到達（失敗）', () => {
    const { kaiju, ai } = landed(4);
    kaiju.part('tail').damageBy(kaiju.maxHp * 0.61, 0);
    for (let i = 0; i < (K.phases.finalSeconds + 1) * 60; i++) ai.step([], DT);
    expect(kaiju.cityReached).toBe(true);
  });
});

describe('ブレイク', () => {
  it('同じ部位に 3 秒以内に 2 人がダメージ → 5 秒間その部位 ×3', () => {
    const { kaiju, ai } = landed(4);
    const leg = kaiju.part('leftLeg');
    leg.damageBy(10, 0);
    for (let i = 0; i < 2.5 * 60; i++) ai.step([], DT);
    leg.damageBy(10, 1);
    expect(leg.breakTimer).toBe(K.break.seconds);
    const before = kaiju.hp;
    leg.damageBy(10, 2);
    expect(before - kaiju.hp).toBeCloseTo(10 * K.break.damageScale, 6);
    // ほかの部位には効かない
    const b2 = kaiju.hp;
    kaiju.part('tail').damageBy(10, 0);
    expect(b2 - kaiju.hp).toBeCloseTo(10, 6);
    for (let i = 0; i < 5.1 * 60; i++) ai.step([], DT);
    expect(leg.breakTimer).toBe(0);
  });

  it('3 秒より離れた 2 人・同じ人の連打・別の部位では成立しない', () => {
    const { kaiju, ai } = landed(4);
    const leg = kaiju.part('leftLeg');
    leg.damageBy(10, 0);
    for (let i = 0; i < 3.2 * 60; i++) ai.step([], DT);
    leg.damageBy(10, 1);
    expect(leg.breakTimer).toBe(0);
    for (let i = 0; i < 10; i++) leg.damageBy(10, 1);
    expect(leg.breakTimer).toBe(0);
    for (let i = 0; i < 4 * 60; i++) ai.step([], DT);
    kaiju.part('head').damageBy(10, 2);
    kaiju.part('tail').damageBy(10, 3);
    expect(kaiju.parts.every((p) => p.breakTimer === 0)).toBe(true);
  });

  it('1 人のときは成立しない', () => {
    const { kaiju } = landed(1);
    const leg = kaiju.part('leftLeg');
    leg.damageBy(10, 0);
    leg.damageBy(10, 1);
    expect(leg.breakTimer).toBe(0);
  });
});

describe('人数スケール', () => {
  it('全体 HP = 基礎 × (0.55 + 0.45 × 人数)', () => {
    expect(kaijuMaxHp(1)).toBe(Math.round(K.baseHp * K.hpScale.solo));
    expect(kaijuMaxHp(2)).toBe(Math.round(K.baseHp * 1.45));
    expect(kaijuMaxHp(4)).toBe(Math.round(K.baseHp * 2.35));
    const k = new Kaiju(flat);
    k.emerge(0, 0, 0, -1, { players: 3 });
    expect(k.maxHp).toBe(Math.round(K.baseHp * 1.9));
  });
});
