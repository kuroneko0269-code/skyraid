// 10-3b: 白鯨アルビオンのソロのレイド: 登録（怪獣選び・リプレイの題）・報酬と残機・体力の倍率（難易度・人数）・制限時間で失敗・
// 撃破で落ちて消える・予兆を見て正しく避ければ当たらない・雲の中のロックの距離・攻撃が止まらない（同じ攻撃の 3 回目）・
// 決定性とリプレイ・文言の言語のそろい
import { describe, expect, it } from 'vitest';
import { AlbionKaiju } from '../src/ai/albion-ai';
import { createCombatInput } from '../src/combat/combat-input';
import { attackTimes, attackWeights, inSlam, inSpout, slamRadius } from '../src/ai/albion-attacks';
import { ALBION_CONFIG as C } from '../src/data/albion';
import { ALBION_RAID_CONFIG as R, albionCoopHpScale } from '../src/data/albion-raid';
import { ALBION_TEXT } from '../src/data/albion-text';
import { RAID_RULES } from '../src/data/raid';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import { ALBION_VARIANT, albionRaidMission } from '../src/missions/albion-mission';
import { AlbionRaid } from '../src/missions/albion-raid';
import { bayRoute } from '../src/missions/albion-dev';
import { findRaidVariant } from '../src/missions/raid-variants';
import { createHeightField } from '../src/render/terrain-height';
import { replayTitle } from '../src/replay/outcome';
import { missionFor, stepWorld, startFromHeader } from '../src/replay/sim';
import { albionStart, createAlbionWorld, runAlbionBot } from './albion-raid-bots';
import { replay } from './replay-helpers';
import './i18n-setup';

const DT = 1 / 60;
const ground = createHeightField(HARBOR_TERRAIN).getGroundHeight;

function makeRaid(difficulty: 'normal' | 'hard' = 'normal', players = 1): AlbionRaid {
  const r = new AlbionRaid(ground);
  r.reset(true, difficulty, players);
  r.spawn(bayRoute({ x: 0, z: 0 }), 0, 7, { x: 0, z: 0 });
  return r;
}

describe('白鯨アルビオンのソロのレイド（10-3b）', () => {
  it('登録: 怪獣選び・リプレイの題・報酬の式・残機・失敗の条件', () => {
    createAlbionWorld();
    expect(findRaidVariant('albion')).toBe(ALBION_VARIANT);
    expect(missionFor({ mode: 'raid', raidDifficulty: 'hard', raidKaiju: 'albion' })?.id).toBe(
      'raidAlbion',
    );
    expect(replayTitle(albionStart(1, 'hard'))).toBe('アルビオン（高難度）');
    const def = albionRaidMission('normal');
    expect(def.reward.raid).toEqual({ difficulty: 'normal', kaiju: 'albion' });
    expect(def.lives).toBe(RAID_RULES.lives.normal);
    expect(def.lives).toBe(3);
    expect(def.failConditions).toEqual(['totalTimeUp', 'outOfBounds', 'livesOut']);
  });

  it('体力: 通常 C.hp・高難度 ×1.3・協力の人数で ×1 / ×1.6 / ×2.2 / ×2.8（部位も同じ割合）。子分の上限は人数で 12〜16', () => {
    expect(makeRaid().kaiju.parts.maxHp).toBe(C.hp);
    expect(makeRaid('hard').kaiju.parts.maxHp).toBeCloseTo(C.hp * R.hard.hpScale);
    for (let n = 1; n <= 4; n++) {
      const r = makeRaid('normal', n);
      expect(r.kaiju.parts.maxHp).toBeCloseTo(C.hp * albionCoopHpScale(n));
      expect(r.kaiju.parts.partMaxHp[1]).toBeCloseTo(C.hp * albionCoopHpScale(n) * 0.04);
      expect(r.kaiju.swarm.limit).toBe(R.minionCap[n - 1]);
    }
    expect(albionCoopHpScale(1)).toBe(1);
  });

  it('制限時間が切れると失敗（時間切れ）・倒すと海へ落ちて消え、子分も消える', () => {
    const r = makeRaid();
    const me = { position: { x: 0, y: 3000, z: -4000 }, active: true };
    r.elapsed = R.totalSeconds.normal - 0.05;
    for (let i = 0; i < 10; i++) r.step(DT, me, () => undefined);
    expect(r.timeUp).toBe(true);
    expect(r.timeLeft).toBe(0);
    const r2 = makeRaid();
    for (let i = 0; i < 60 * 30; i++) r2.step(DT, me, () => undefined);
    expect(r2.kaiju.swarm.activeCount).toBeGreaterThan(0);
    const body = r2.kaiju.parts.indexOf('body');
    expect(r2.damagePart(body, 1e9)).toBe(true);
    expect(r2.dead).toBe(true);
    expect(r2.kaiju.swarm.activeCount).toBe(0);
    for (let i = 0; i < 60 * 60 && r2.kaiju.body.visible; i++) r2.step(DT, me, () => undefined);
    expect(r2.kaiju.body.visible).toBe(false);
    expect(r2.landedTime).toBeGreaterThanOrEqual(R.vanishSeconds);
  });

  it('攻撃が止まらない: 背の上・真後ろに誰もいない段階 1 でも潮吹きを続ける（同じ攻撃は候補がほかにあるときだけ 3 回続けない）', () => {
    const k = new AlbionKaiju(ground);
    k.spawn(bayRoute({ x: 0, z: 0 }), 0, 3);
    const far = { position: { x: 0, y: 3000, z: -4500 }, active: true };
    for (let i = 0; i < 60 * 180; i++) k.step(DT, far);
    expect(k.attacksUsed.spout).toBeGreaterThanOrEqual(10);
    const chooser = {
      body: k.body,
      phase: 1,
      lastAttack: 'spout' as const,
      repeat: 2,
      cloudLeft: 0,
      disabled: () => false,
    };
    expect(attackWeights(chooser, far.position).map((c) => c.attack)).toEqual(['spout']);
  });

  it('予兆を見て正しく避ければ当たらない: 予兆の 0.6 秒後に範囲の外へ（巡航 250 m/s）動けば、潮吹き・尾とも当たらない', () => {
    for (const attack of ['spout', 'slam'] as const) {
      for (const phase of [1, 3]) {
        const k = new AlbionKaiju(ground);
        k.spawn(bayRoute({ x: 0, z: 0 }), 0, 5);
        k.phase = phase;
        k.cooldown = 1e9;
        const b = k.body;
        const fx = -Math.sin(b.heading);
        const fz = -Math.cos(b.heading);
        // いちばん逃げにくい所: 潮吹きは噴気孔の真上、尾は扇の真ん中（尾の付け根から後ろ 200m・同じ高さ）
        const p =
          attack === 'spout'
            ? {
                x: b.position.x + fx * C.attacks.spout.forward,
                y: b.position.y + 200,
                z: b.position.z + fz * C.attacks.spout.forward,
              }
            : {
                x: b.position.x - fx * (C.attacks.slam.pivotBack + 200),
                y: b.position.y,
                z: b.position.z - fz * (C.attacks.slam.pivotBack + 200),
              };
        const me = { position: p, active: true };
        k.action = 'windup';
        k.attack = attack;
        k.actionTime = 0;
        let hits = 0;
        const total = attackTimes(attack);
        const steps = Math.ceil((total.windup + total.active + total.recover) * 60);
        // 横（体の軸に直角）へ出る。尾は横に加えて上へ（扇の上下 ±130m の外へ）
        const rx = -fz;
        const rz = fx;
        for (let i = 0; i < steps; i++) {
          const t = i * DT;
          if (t >= 0.6) {
            const v = 250 * DT;
            if (attack === 'spout') {
              p.x += rx * v;
              p.z += rz * v;
            } else {
              p.x += rx * v * 0.7;
              p.z += rz * v * 0.7;
              p.y += v * 0.7;
            }
          }
          if (attack === 'spout' && i === 0) expect(inSpout(b, phase, p)).toBe(true);
          if (attack === 'slam' && i === 0) expect(inSlam(b, slamRadius(k), p)).toBe(true);
          k.step(DT, me, () => {
            hits++;
          });
        }
        expect([attack, phase, hits]).toEqual([attack, phase, 0]);
        // 動かなければ当たる（範囲は合っている）
        const k2 = new AlbionKaiju(ground);
        k2.spawn(bayRoute({ x: 0, z: 0 }), 0, 5);
        k2.phase = phase;
        k2.action = 'windup';
        k2.attack = attack;
        k2.actionTime = 0;
        k2.cooldown = 1e9;
        const stay = {
          position:
            attack === 'spout'
              ? { x: b.position.x + fx * 210, y: b.position.y + 200, z: b.position.z + fz * 210 }
              : { x: b.position.x - fx * 430, y: b.position.y, z: b.position.z - fz * 430 },
          active: true,
        };
        let stayHits = 0;
        for (let i = 0; i < steps; i++)
          k2.step(DT, stay, () => {
            stayHits++;
          });
        expect([attack, phase, stayHits]).toEqual([attack, phase, 1]);
      }
    }
  });

  it('雲の中はロックの距離が縮み、雲が晴れると戻る', () => {
    const { w, dev } = createAlbionWorld();
    startFromHeader(w, albionStart(3, 'normal'));
    const s = w.play.session;
    const base = s.combat.targeting.spec.lockRange;
    const k = dev.kaiju;
    k.cloudLeft = 10;
    const p = s.aircraft.state.position;
    p.x = k.body.position.x;
    p.y = k.body.position.y + 200;
    p.z = k.body.position.z;
    s.aircraft.prevPosition.x = p.x;
    s.aircraft.prevPosition.y = p.y;
    s.aircraft.prevPosition.z = p.z;
    stepWorld(w.play, w.buildings(), w.controls, createCombatInput(), DT);
    expect(dev.inCloud).toBe(true);
    expect(s.combat.targeting.spec.lockRange).toBeCloseTo(base * C.attacks.cloud.lockRange);
    k.cloudLeft = 0;
    stepWorld(w.play, w.buildings(), w.controls, createCombatInput(), DT);
    expect(s.combat.targeting.spec.lockRange).toBe(base);
  });

  it('決定性: 同じ種のボットは同じ結果、記録を再生すると同じ状態（リプレイ）', () => {
    const a = runAlbionBot({ role: 'skilled', seed: 2, record: true, preset: 'easy' });
    const b = runAlbionBot({ role: 'skilled', seed: 2, record: true, preset: 'easy' });
    expect(a.status).toBe('success');
    expect(b.seconds).toBe(a.seconds);
    expect(b.hash).toBe(a.hash);
    const data = a.data;
    if (!data) throw new Error('no data');
    expect(data.header.raidKaiju).toBe('albion');
    const { w, dev } = createAlbionWorld();
    const back = replay(w, data, 600);
    expect(back.player.ended).toBe(true);
    expect(w.play.runner?.status).toBe('success');
    expect(dev.raid.dead).toBe(true);
  }, 300_000);

  it('文言: 日本語と英語のキーがそろう', () => {
    expect(Object.keys(ALBION_TEXT.en).sort()).toEqual(Object.keys(ALBION_TEXT.ja).sort());
    expect(ALBION_TEXT.ja.briefing).toHaveLength(ALBION_TEXT.en.briefing?.length ?? -1);
  });
});
