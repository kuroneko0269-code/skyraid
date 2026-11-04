// 9-6b: ネフィルガのソロのレイド（?dev=kaiju2）: 登録しないときは今までと同じ・部位の破壊で動きが変わる・段階と制限時間・
// 撃破・一撃で落ちない・決定性とリプレイ・NaN が出ない・戦域と地形・文言の言語のそろい
import { describe, expect, it } from 'vitest';
import { attackUsable } from '../src/ai/kaiju2-attacks';
import { Kaiju2SoundWatch } from '../src/audio/kaiju2-watch';
import type { KaijuSounds } from '../src/audio/sfx/kaiju-sounds';
import type { Kaiju2Sounds } from '../src/audio/sfx/kaiju2-sounds';
import { KAIJU2_CONFIG as C } from '../src/data/kaiju2';
import { KAIJU2_RAID_CONFIG as R } from '../src/data/kaiju2-raid';
import { KAIJU2_TEXT } from '../src/data/kaiju2-text';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import { NEPHIRGA_VARIANT, nephirgaRaidMission } from '../src/missions/kaiju2-mission';
import { Kaiju2Raid } from '../src/missions/kaiju2-raid';
import { findRaidVariant } from '../src/missions/raid-variants';
import { raidReward } from '../src/progression/raid-reward';
import { createHeightField } from '../src/render/terrain-height';
import { missionFor } from '../src/replay/sim';
import { replayTitle } from '../src/replay/outcome';
import { createKaiju2World, nephirgaStart, runKaiju2Bot } from './kaiju2-raid-bots';
import { replay } from './replay-helpers';
import './i18n-setup';

const DT = 1 / 60;
const ground = createHeightField(HARBOR_TERRAIN).getGroundHeight;
const still = { position: { x: 0, y: 900, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, active: true };

/** 山の手前（北）に出す（止まり木の候補がある。本番は建物の屋根も止まり木になる） */
function makeRaid(difficulty: 'normal' | 'hard' = 'normal'): Kaiju2Raid {
  const r = new Kaiju2Raid(ground, { hit: () => undefined });
  r.reset(true, difficulty);
  r.ai.spawn(0, 800, -2300, 0, 7);
  r.placeTargets();
  return r;
}

const part = (r: Kaiju2Raid, id: string) => {
  const t = r.targets.find((x) => x.id === id);
  if (!t) throw new Error(id);
  return t;
};

describe('ネフィルガのソロのレイド（9-6b）', () => {
  it('登録するまで（?dev=kaiju2 を付けないとき）はレイドの別の怪獣は無い（リプレイ・題も今までと同じ）', () => {
    expect(findRaidVariant('nephirga')).toBeNull();
    expect(
      missionFor({ mode: 'raid', raidDifficulty: 'normal', raidKaiju: 'nephirga' }),
    ).toBeNull();
    expect(missionFor({ mode: 'raid', raidDifficulty: 'normal' })?.id).toBe('raid');
    createKaiju2World();
    expect(findRaidVariant('nephirga')).toBe(NEPHIRGA_VARIANT);
    expect(missionFor({ mode: 'raid', raidDifficulty: 'hard', raidKaiju: 'nephirga' })?.id).toBe(
      'raidNephirga',
    );
    expect(replayTitle(nephirgaStart(1, 'hard'))).toBe('ネフィルガ（高難度）');
  });

  it('報酬はヴォルガスと同じ式（2,000 CR × 時間ボーナス × 高難度 1.8・失敗 300）', () => {
    const def = nephirgaRaidMission('hard');
    expect(def.reward.raid).toEqual({ difficulty: 'hard', kaiju: 'nephirga' });
    expect(raidReward({ coop: false, cleared: true, seconds: 200, difficulty: 'hard' })).toBe(5400);
    expect(def.failConditions).toEqual(['stormTimeUp', 'totalTimeUp', 'outOfBounds']);
  });

  it('一撃で落ちない: 1 回の攻撃のダメージは高難度でも Swift の HP 140 より少ない・突風の操作不能は 0.6 秒', () => {
    const A = C.attacks;
    const worst = Math.max(
      A.orbs.damage * A.orbs.maxHits,
      A.gust.damage,
      A.dive.damage,
      A.tail.damage,
    );
    expect(worst * R.hard.damageScale).toBeLessThan(140);
    expect(A.gust.stun).toBeLessThanOrEqual(0.6);
  });

  it('部位の破壊で動きが変わる: 翼 → 遅く低く・突風と急降下なし、頭 → 雷球なし、尾 → 大回り、両翼 → 降りる', () => {
    const r = makeRaid();
    const k = r.body;
    const speed = k.cruiseSpeed;
    const turn = k.turnRate;
    const wl = part(r, 'wingL');
    wl.applyDamage(wl.maxHp + 1);
    expect(wl.broken).toBe(true);
    expect(k.broken.wingL).toBe(true);
    expect(k.cruiseSpeed).toBeLessThan(speed);
    expect(k.ceiling).toBe(C.ceiling.wingBroken);
    expect(attackUsable('gust', k.broken)).toBe(false);
    expect(attackUsable('dive', k.broken)).toBe(false);
    const h = part(r, 'head');
    h.applyDamage(h.maxHp + 1);
    expect(attackUsable('orbs', k.broken)).toBe(false);
    const t = part(r, 'tail');
    t.applyDamage(t.maxHp + 1);
    expect(k.turnRate).toBeLessThan(turn * C.broken.wingTurn);
    expect(r.brokenCount).toBe(3);
    const wr = part(r, 'wingR');
    wr.applyDamage(wr.maxHp + 1);
    expect(r.lastBroken).toBe('both');
    expect(k.state).toBe('landing');
    // 天井が下がっても瞬間移動しない（下げる速さまで）
    k.position.y = 1500;
    const y = k.position.y;
    r.step(DT, still, null);
    expect(y - k.position.y).toBeLessThanOrEqual(C.ceilingDrop * DT + 5);
  });

  it('予兆の間に部位が壊れたら、その攻撃は取り消す', () => {
    const r = makeRaid();
    const k = r.body;
    k.setState('windup', 'orbs');
    const h = part(r, 'head');
    h.applyDamage(h.maxHp + 1);
    expect(k.state).toBe('cruise');
    expect(k.attack).toBeNull();
  });

  it('段階（70% / 40%）と嵐の制限時間、全体の制限時間、撃破で落ちて消える', () => {
    const r = makeRaid();
    const k = r.body;
    const body = part(r, 'body');
    const hit = (ratio: number) => {
      body.applyDamage((r.hp - r.maxHp * ratio) / R.targets.body.damageScale + 0.01);
    };
    hit(0.69);
    expect(k.phase).toBe(2);
    expect(r.shout).toBeGreaterThan(0);
    hit(0.39);
    expect(k.phase).toBe(3);
    expect(r.stormAt).toBe(0);
    for (let i = 0; i < R.finalSeconds.normal * 60 - 30; i++) r.step(DT, still, null);
    expect(r.stormReached).toBe(false);
    for (let i = 0; i < 60; i++) r.step(DT, still, null);
    expect(r.stormReached).toBe(true);
    expect(r.timeUp).toBe('storm');
    // 全体の制限時間（段階 1 のまま）
    const r2 = makeRaid('hard');
    for (let i = 0; i < R.totalSeconds.hard * 60 + 5; i++) r2.step(DT, still, null);
    expect(r2.stormReached).toBe(true);
    expect(r2.timeUp).toBe('total');
    // 撃破
    const r3 = makeRaid();
    expect(part(r3, 'tail').applyDamage(r3.maxHp * 10)).toBe(true);
    expect(r3.dead).toBe(true);
    expect(r3.targetable).toBe(false);
    for (let i = 0; i < 60 * 40 && r3.body.visible; i++) r3.step(DT, still, null);
    expect(r3.body.visible).toBe(false);
  });

  it('止まり木の間は受けるダメージが増え、胴は硬い・高難度は体力 ×1.55', () => {
    const r = makeRaid();
    const tail = part(r, 'tail');
    tail.applyDamage(10);
    expect(r.maxHp - r.hp).toBeCloseTo(10, 6);
    part(r, 'body').applyDamage(10);
    expect(r.maxHp - r.hp).toBeCloseTo(10 + 10 * R.targets.body.damageScale, 6);
    r.body.setState('perched', null);
    const before = r.hp;
    tail.applyDamage(10);
    expect(before - r.hp).toBeCloseTo(10 * R.perchedDamageScale, 6);
    expect(makeRaid('hard').maxHp).toBeCloseTo(R.hp * R.hard.hpScale, 6);
  });

  it('決定性: 同じ種のボットは同じ結果、記録を再生すると同じ状態（リプレイ）', () => {
    const a = runKaiju2Bot({ role: 'skilled', seed: 2, record: true });
    const b = runKaiju2Bot({ role: 'skilled', seed: 2, record: true });
    expect(a.status).toBe('success');
    expect(b.seconds).toBe(a.seconds);
    expect(b.hash).toBe(a.hash);
    const data = a.data;
    if (!data) throw new Error('no data');
    expect(data.header.raidKaiju).toBe('nephirga');
    const { w, dev } = createKaiju2World();
    const back = replay(w, data, 600);
    expect(back.player.ended).toBe(true);
    expect(w.play.runner?.status).toBe('success');
    expect(dev.raid.dead).toBe(true);
  }, 120_000);

  it('NaN が出ない・戦域から出ない・地形と海に潜らない（模擬の人が通常・高難度で最後まで）', () => {
    for (const difficulty of ['normal', 'hard'] as const) {
      let checked = 0;
      const r = runKaiju2Bot({
        role: 'human',
        seed: 5,
        difficulty,
        onStep: (dev) => {
          const k = dev.body;
          if (!k.visible) return;
          const p = k.position;
          expect(Number.isFinite(p.x + p.y + p.z + k.forward.x + k.bank + k.speed)).toBe(true);
          expect(Math.hypot(p.x - k.center.x, p.z - k.center.z)).toBeLessThanOrEqual(
            C.arena.hard + 1,
          );
          const floor = Math.max(0, ground(p.x, p.z));
          expect(p.y).toBeGreaterThanOrEqual(floor + C.perch.standHeight - 1);
          for (const t of dev.raid.targets)
            expect(Number.isFinite(t.position.x + t.position.y + t.position.z)).toBe(true);
          for (const o of k.orbs)
            if (o.active) expect(Number.isFinite(o.position.x + o.position.y)).toBe(true);
          checked++;
        },
      });
      expect(checked).toBeGreaterThan(60 * 60);
      expect(r.status).toBe('success');
    }
  }, 120_000);

  it('音: 予兆・攻撃・部位の破壊・段階・撃破で鳴らす（初めて見えたフレームは鳴らさない）', () => {
    const calls: string[] = [];
    const log = (name: string) => () => {
      calls.push(name);
    };
    const sounds = {
      flap: log('flap'),
      orbCharge: log('orbCharge'),
      orbLaunch: log('orbLaunch'),
      gustCharge: log('gustCharge'),
      gust: log('gust'),
      scream: (kind: string) => {
        calls.push(kind);
      },
      tail: log('tail'),
    } as unknown as Kaiju2Sounds;
    const shared = { partBreak: log('partBreak') } as unknown as KaijuSounds;
    const watch = new Kaiju2SoundWatch(sounds, shared);
    const r = makeRaid();
    const ear = { x: 0, y: 800, z: -2000 };
    r.body.setState('windup', 'orbs');
    watch.update(r, ear);
    expect(calls).toEqual([]);
    r.body.setState('attack', 'orbs');
    watch.update(r, ear);
    const head = part(r, 'head');
    head.applyDamage(head.maxHp + 1);
    watch.update(r, ear);
    part(r, 'body').applyDamage(r.maxHp * 10);
    watch.update(r, ear);
    expect(calls).toEqual(['orbLaunch', 'partBreak', 'shout', 'shout', 'partBreak']);
  });

  it('文言は日本語と英語でキーがそろう', () => {
    expect(Object.keys(KAIJU2_TEXT.en).sort()).toEqual(Object.keys(KAIJU2_TEXT.ja).sort());
    expect(KAIJU2_TEXT.en.briefing).toHaveLength(KAIJU2_TEXT.ja.briefing?.length ?? -1);
  });
});
