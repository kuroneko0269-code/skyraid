// 9-6d: ネフィルガの手応え: レイドの残機（ソロ・協力）・止まり木の降り方（一瞬で移らない）・狙いの補助（怪獣だけ弱める）・
// 狙われたら避ける・部位を壊すと怯む・雷球の見越し・突風の押し流し・攻撃を重ねる
import { describe, expect, it } from 'vitest';
import { applyAimAssist, assistSpecFor } from '../src/combat/aim-assist';
import { allOutOfLives, outOfLives } from '../src/combat/arena-raid';
import { assistedHitRadius } from '../src/combat/gun';
import { AIM_ASSIST_LEVEL_SPECS } from '../src/data/assist';
import { KAIJU2_CONFIG as C } from '../src/data/kaiju2';
import { KAIJU2_RAID_CONFIG as R } from '../src/data/kaiju2-raid';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import { RAID_RULES } from '../src/data/raid';
import { raidMission } from '../src/data/missions-special';
import { nephirgaRaidMission } from '../src/missions/kaiju2-mission';
import { Kaiju2Raid } from '../src/missions/kaiju2-raid';
import { MissionRunner } from '../src/missions/runner';
import { coopOutcome } from '../src/net/host-raid';
import { RAID_OUTCOME } from '../src/net/raid-host';
import { PvpArena } from '../src/combat/pvp-arena';
import { createHeightField } from '../src/render/terrain-height';
import { DT, FakeWorld } from './mission-helpers';
import './i18n-setup';

const ground = createHeightField(HARBOR_TERRAIN).getGroundHeight;
const still = { position: { x: 0, y: 900, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, active: true };

function makeRaid(): Kaiju2Raid {
  const r = new Kaiju2Raid(ground, { hit: () => undefined });
  r.reset(true, 'normal');
  r.ai.spawn(0, 800, -2300, 0, 7);
  r.placeTargets();
  return r;
}

describe('レイドの残機（9-6d）', () => {
  it('ヴォルガス・ネフィルガとも通常 3 機・高難度 2 機。使い切ったら livesOut で失敗', () => {
    for (const make of [raidMission, nephirgaRaidMission]) {
      expect(make('normal').lives).toBe(RAID_RULES.lives.normal);
      expect(make('hard').lives).toBe(RAID_RULES.lives.hard);
      expect(make('normal').failConditions).toContain('livesOut');
    }
    expect(RAID_RULES.lives).toEqual({ normal: 3, hard: 2 });
    const w = new FakeWorld();
    const def = { ...nephirgaRaidMission('normal'), failConditions: ['livesOut' as const] };
    const r = new MissionRunner(def, w);
    r.start();
    expect(r.livesLeft).toBe(3);
    w.playerDowns = 2;
    r.step(DT);
    expect(r.livesLeft).toBe(1);
    expect(r.status).toBe('running');
    w.playerDowns = 3;
    r.step(DT);
    expect(r.livesLeft).toBe(0);
    expect(r.status).toBe('failed');
    expect(r.failReason).toBe('livesOut');
  });

  it('協力: 使い切った人は復帰しない（観戦）。今いる全員が使い切ったら livesOut', () => {
    expect(outOfLives({ deaths: 3 }, 3)).toBe(true);
    expect(outOfLives({ deaths: 2 }, 3)).toBe(false);
    expect(outOfLives({ deaths: 9 }, null)).toBe(false);
    const list = [
      { deaths: 3, away: false },
      { deaths: 1, away: true },
    ];
    // 再接続待ちの人は数えない
    expect(allOutOfLives(list, 3)).toBe(true);
    expect(allOutOfLives(list, null)).toBe(false);
    expect(
      allOutOfLives(
        [
          { deaths: 3, away: false },
          { deaths: 2, away: false },
        ],
        3,
      ),
    ).toBe(false);
    const arena = new PvpArena(() => undefined);
    arena.lives = 2;
    const raid = { outcome: RAID_OUTCOME.none };
    expect(coopOutcome(raid, null, arena)).toBe(RAID_OUTCOME.none);
    expect(coopOutcome({ outcome: RAID_OUTCOME.clear }, null, arena)).toBe(RAID_OUTCOME.clear);
  });
});

describe('止まり木への降り方（9-6d）', () => {
  it('上空から一瞬で移らない: 旋回しながら降り、寄せて着地してから翼をたたみ、羽ばたいて真上へ上がる', () => {
    const r = makeRaid();
    const k = r.body;
    k.stamina = 0.01;
    let maxStep = 0;
    const stages = new Set<number>();
    let foldedInAir = false;
    let perched = false;
    let liftedUp = false;
    for (let i = 0; i < 120 * 60 && !(perched && k.state === 'cruise'); i++) {
      const before = { x: k.position.x, y: k.position.y, z: k.position.z };
      r.step(DT, still, null);
      const d = Math.hypot(
        k.position.x - before.x,
        k.position.y - before.y,
        k.position.z - before.z,
      );
      maxStep = Math.max(maxStep, d);
      if (k.state === 'landing') {
        stages.add(k.landStage);
        if (k.pose.wingFold > 0.5) foldedInAir = true;
      }
      if (k.state === 'perched') perched = true;
      if (
        k.state === 'takeoff' &&
        k.stateTime < C.perch.liftSeconds &&
        k.position.y > before.y + 0.05
      )
        liftedUp = true;
    }
    expect(perched).toBe(true);
    expect([...stages].sort()).toEqual([0, 1, 2]);
    // 1 ステップ（1/60 秒）で 4m 以下（240 m/s 以下。前は最後に 400m 跳んでいた）
    expect(maxStep).toBeLessThan(4);
    expect(foldedInAir).toBe(false);
    expect(liftedUp).toBe(true);
  });
});

describe('当てにくさ（9-6d）', () => {
  it('狙いの補助は怪獣の部位だけ弱める（判定の拡大・補正の強さ）。ほかの的は今までと同じ', () => {
    const r = makeRaid();
    const part = r.targets[0];
    if (!part) throw new Error('part');
    expect(part.assistScale).toBe(R.assistScale);
    expect(assistedHitRadius(part, 1.3)).toBeCloseTo(part.hitRadius * (1 + 0.3 * R.assistScale), 6);
    expect(assistedHitRadius({ hitRadius: 10 }, 1.3)).toBeCloseTo(13, 6);
    const spec = AIM_ASSIST_LEVEL_SPECS.normal;
    expect(assistSpecFor(spec, {})).toBe(spec);
    expect(assistSpecFor(spec, part).maxCorrection).toBeCloseTo(
      spec.maxCorrection * R.assistScale,
      6,
    );
    // 補正の量も弱まる
    const at = { x: 0, y: 0, z: 0 };
    const q = { x: 0, y: 0, z: 0, w: 1 };
    const aim = { x: 20, y: 0, z: -1000 };
    const a = { pitch: 0, roll: 0.5, yaw: 0, throttle: 0.7, afterburner: false };
    const b = { ...a };
    applyAimAssist(a, at, q, aim, false, spec);
    applyAimAssist(b, at, q, aim, false, assistSpecFor(spec, part));
    expect(b.yaw).toBeCloseTo(a.yaw * R.assistScale, 6);
  });

  it('巡航中に機首から狙われ続けると横へ避ける（予兆・攻撃の間は避けない）', () => {
    const r = makeRaid();
    const k = r.body;
    k.attackCooldown = 99;
    k.stamina = 999;
    const me = {
      position: { x: 0, y: 800, z: -1300 },
      velocity: { x: 0, y: 0, z: 0 },
      active: true,
      forward: { x: 0, y: 0, z: -1 },
    };
    let evaded = false;
    for (let i = 0; i < 20 * 60 && !evaded; i++) {
      // 機首をいつも怪獣へ向ける
      const dx = k.position.x - me.position.x;
      const dy = k.position.y - me.position.y;
      const dz = k.position.z - me.position.z;
      const l = Math.hypot(dx, dy, dz);
      me.forward = { x: dx / l, y: dy / l, z: dz / l };
      r.step(DT, me, null);
      if (k.evadeLeft > 0) evaded = true;
    }
    expect(evaded).toBe(true);
    expect(k.evadeCooldown).toBeGreaterThan(C.evade.cooldown);
  });

  it('部位を壊すと怯む: 予兆を取り消し、flinch 秒は攻撃せず、受けるダメージは止まり木と同じ倍率', () => {
    const r = makeRaid();
    const k = r.body;
    for (let i = 0; i < 30 && k.state !== 'windup'; i++) {
      k.attackCooldown = 0;
      r.step(
        DT,
        { ...still, position: { x: k.position.x + 1200, y: k.position.y, z: k.position.z } },
        null,
      );
    }
    const tail = r.targets.find((t) => t.id === 'tail');
    const body = r.targets.find((t) => t.id === 'body');
    if (!tail || !body) throw new Error('targets');
    r.damageTarget(tail, tail.partHp + 1);
    expect(k.broken.tail).toBe(true);
    expect(k.flinch).toBeCloseTo(C.flinch.seconds, 3);
    expect(k.state).toBe('cruise');
    const hp = r.hp;
    r.damageTarget(body, 100);
    expect(hp - r.hp).toBeCloseTo(100 * R.targets.body.damageScale * R.perchedDamageScale, 6);
    for (let i = 0; i < (C.flinch.seconds - 0.1) * 60; i++) {
      r.step(DT, still, null);
      expect(k.state === 'windup' || k.state === 'attack').toBe(false);
    }
  });
});

describe('攻撃の脅威（9-6d）', () => {
  it('雷球は見越しの点へ撃つ（まっすぐ飛ぶ自機の先へ）', () => {
    const r = makeRaid();
    const k = r.body;
    k.attackCooldown = 0;
    const me = {
      position: { x: k.position.x + 1500, y: k.position.y, z: k.position.z },
      velocity: { x: 0, y: 0, z: -200 },
      active: true,
    };
    for (let i = 0; i < 10 * 60 && !k.orbs.some((o) => o.active); i++) r.step(DT, me, null);
    const orb = k.orbs.find((o) => o.active);
    if (!orb) throw new Error('orb');
    // 自機は −z へ進むので、雷球の向きも −z 側
    expect(k.orbs.filter((o) => o.active).reduce((a, o) => a + o.velocity.z, 0)).toBeLessThan(0);
  });

  it('突風に当たると押し流す（怪獣の向きへ・pushSeconds で弱まる）。段階 2 からは攻撃を重ねる', () => {
    const r = makeRaid();
    const k = r.body;
    let pushed = false;
    for (let i = 0; i < 60 * 60 && !pushed; i++) {
      // いつも怪獣の正面 400m
      const me = {
        position: {
          x: k.position.x + k.forward.x * 400,
          y: k.position.y,
          z: k.position.z + k.forward.z * 400,
        },
        velocity: { x: 0, y: 0, z: 0 },
        active: true,
      };
      r.step(DT, me, null);
      if (k.pushLeft > 0) pushed = true;
    }
    expect(pushed).toBe(true);
    expect(Math.hypot(k.pushX, k.pushZ)).toBeCloseTo(1, 6);
    expect(C.chain[1]).toBeGreaterThanOrEqual(1);
    expect(C.chain[2]).toBeGreaterThan(C.chain[1] ?? 0);
  });
});
