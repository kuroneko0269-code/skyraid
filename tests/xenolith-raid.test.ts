// 10-5b: UFO ゼノリスのソロのレイド: 登録（怪獣選び・リプレイの題）・報酬と残機・体力の倍率（難易度・人数）・制限時間で失敗・
// 撃破で落ちて消える（光の弾も消える）・人を狙う攻撃は予兆を見て正しく避ければ当たらず、まっすぐ飛び続けると当たる（溜め撃ちの
// ロックの見越し・光の弾の格子）・光の弾は光線の間だけ・勲章の印・HUD の警告と攻めどき・決定性とリプレイ・文言の言語のそろい
import { describe, expect, it } from 'vitest';
import { XenolithKaiju, type XenolithTarget } from '../src/ai/xenolith-ai';
import { startAttack } from '../src/ai/xenolith-attacks';
import { XENOLITH_CHARGED, XENOLITH_CONFIG as C, XENOLITH_PARTS } from '../src/data/xenolith';
import { XENOLITH_RAID_CONFIG as R, xenolithCoopHpScale } from '../src/data/xenolith-raid';
import { XENOLITH_TEXT } from '../src/data/xenolith-text';
import { RAID_RULES } from '../src/data/raid';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import { vec3, type Vec3 } from '../src/flight/math';
import { XENOLITH_VARIANT, xenolithRaidMission } from '../src/missions/xenolith-mission';
import { XenolithRaid } from '../src/missions/xenolith-raid';
import { findRaidVariant } from '../src/missions/raid-variants';
import { createHeightField } from '../src/render/terrain-height';
import { replayTitle } from '../src/replay/outcome';
import { missionFor } from '../src/replay/sim';
import { xenolithLockedOn, xenolithOpening, xenolithWarning } from '../src/ui/xenolith-hud';
import { createXenolithWorld, runXenolithBot, xenolithStart } from './xenolith-raid-bots';
import { replay } from './replay-helpers';
import './i18n-setup';

const DT = 1 / 60;
const ground = createHeightField(HARBOR_TERRAIN).getGroundHeight;
const flat = (): number => 0;

function makeRaid(difficulty: 'normal' | 'hard' = 'normal', players = 1): XenolithRaid {
  const r = new XenolithRaid(ground);
  r.reset(true, difficulty, players);
  r.spawn(0, 900, 2000, 0, 7, { x: 0, z: 0 });
  return r;
}

const far = { position: { x: 0, y: 3000, z: -4800 }, active: true };

/** まっすぐ飛ぶ / 合図で曲がる人（速さ 250 m/s・水平） */
function mover(): XenolithTarget & { position: Vec3; velocity: Vec3; turn: () => void } {
  const position = vec3(0, 0, 0);
  const velocity = vec3(250, 0, 0);
  return {
    position,
    velocity,
    active: true,
    id: 0,
    radius: 8,
    turn() {
      // 90° 曲がる（体から離れる向きへ）
      const vx = velocity.x;
      velocity.x = -velocity.z;
      velocity.z = vx;
    },
  };
}

describe('UFO ゼノリスのソロのレイド（10-5b）', () => {
  it('登録: 怪獣選び・リプレイの題・報酬の式・残機・失敗の条件', () => {
    createXenolithWorld();
    expect(findRaidVariant('xenolith')).toBe(XENOLITH_VARIANT);
    expect(missionFor({ mode: 'raid', raidDifficulty: 'hard', raidKaiju: 'xenolith' })?.id).toBe(
      'raidXenolith',
    );
    expect(replayTitle(xenolithStart(1, 'hard'))).toBe('ゼノリス（高難度）');
    const def = xenolithRaidMission('normal');
    expect(def.reward.raid).toEqual({ difficulty: 'normal', kaiju: 'xenolith' });
    expect(def.lives).toBe(RAID_RULES.lives.normal);
    expect(def.lives).toBe(3);
    expect(def.failConditions).toEqual(['totalTimeUp', 'outOfBounds', 'livesOut']);
  });

  it('体力: 通常 C.hp・高難度 ×1.3（光線が速く重い）・協力の人数で ×1 / ×1.4 / ×1.8 / ×2.2（部位も同じ割合）', () => {
    expect(makeRaid().kaiju.parts.maxHp).toBe(C.hp);
    const hard = makeRaid('hard');
    expect(hard.kaiju.parts.maxHp).toBeCloseTo(C.hp * R.hard.hpScale);
    expect(hard.kaiju.intervalScale).toBe(R.hard.intervalScale);
    expect(hard.kaiju.damageScale).toBe(R.hard.damageScale);
    const dome = XENOLITH_PARTS.indexOf('dome');
    for (let n = 1; n <= 4; n++) {
      const r = makeRaid('normal', n);
      expect(r.kaiju.parts.maxHp).toBeCloseTo(C.hp * xenolithCoopHpScale(n));
      expect(r.kaiju.parts.partMaxHp[dome]).toBeCloseTo(C.hp * xenolithCoopHpScale(n) * 0.12);
    }
    // レイドは最初の光線・瞬間移動を遅らせる（ブリーフィングを読む間）
    const r = makeRaid();
    expect(r.kaiju.cooldown).toBe(R.firstAttackDelay);
    expect(r.kaiju.warpTimer).toBe(R.firstWarpDelay);
  });

  it('制限時間が切れると失敗（時間切れ）・倒すと落ちて消え、光の弾も消える', () => {
    const r = makeRaid();
    r.elapsed = R.totalSeconds.normal - 0.05;
    for (let i = 0; i < 10; i++) r.step(DT, far, () => undefined);
    expect(r.timeUp).toBe(true);
    expect(r.timeLeft).toBe(0);
    const r2 = makeRaid();
    const near = { position: vec3(0, 900, 1000), velocity: vec3(0, 0, 0), active: true, id: 0 };
    let flew = 0;
    for (let i = 0; i < 60 * 30; i++) {
      r2.step(DT, near, () => undefined);
      flew = Math.max(flew, r2.kaiju.orbs.activeCount);
    }
    expect(flew).toBeGreaterThan(0);
    r2.kaiju.barrier.phase = 'down';
    expect(r2.damageSphere(0, 1e9)).toBe(true);
    expect(r2.dead).toBe(true);
    r2.step(DT, far, () => undefined);
    expect(r2.kaiju.orbs.activeCount).toBe(0);
    for (let i = 0; i < 60 * 60 && r2.kaiju.body.visible; i++) r2.step(DT, far, () => undefined);
    expect(r2.kaiju.body.visible).toBe(false);
    expect(r2.landedTime).toBeGreaterThanOrEqual(R.vanishSeconds);
  });

  it('溜め撃ちのロックは進む先を見越す: まっすぐ飛び続けると当たり、線が止まったら曲がると外れる', () => {
    const shot = (turn: boolean): number => {
      const k = new XenolithKaiju(flat);
      k.spawn(0, 600, -1500, 0, 5);
      k.immortal = true;
      k.orbsEnabled = false;
      const t = mover();
      const p = k.body.position;
      t.position.x = p.x - 600;
      t.position.y = p.y + 40;
      t.position.z = p.z + 1000;
      k.cooldown = 99;
      k.warpTimer = 99;
      startAttack(k, 'charged', t, k.random.next);
      let dmg = 0;
      let turned = false;
      for (let i = 0; i < 6 / DT; i++) {
        if (turn && !turned && k.beam.phase === 'charge') {
          t.turn();
          turned = true;
        }
        t.position.x += t.velocity.x * DT;
        t.position.z += t.velocity.z * DT;
        k.step(DT, t, (_a, d) => {
          dmg += d;
        });
      }
      return dmg;
    };
    expect(shot(false)).toBe(XENOLITH_CHARGED.damage);
    expect(shot(true)).toBe(0);
  });

  it('光の弾: 光線の間だけ・予兆の後に格子で撃つ。まっすぐ飛び続けると当たり、予兆を見て曲がると外れる', () => {
    const run = (turn: boolean): { hits: number; duringBeam: boolean; volleys: number } => {
      const k = new XenolithKaiju(flat);
      k.spawn(0, 600, 0, 0, 11);
      k.immortal = true;
      k.warpTimer = 1e9;
      const t = mover();
      let hits = 0;
      let duringBeam = false;
      let warnSeen = -1;
      for (let i = 0; i < 60 / DT; i++) {
        // 体の周り 1,000m を、横切るように往復する（まっすぐ 6 秒ずつ）
        const b = k.body.position;
        const leg = Math.floor((i * DT) / 6) % 2 === 0 ? 1 : -1;
        if (!turn || warnSeen < 0) {
          t.velocity.x = 250 * leg;
          t.velocity.z = 0;
        }
        if (Math.floor((i * DT) / 6) !== Math.floor(((i - 1) * DT) / 6)) {
          t.position.x = b.x - 750 * leg;
          t.position.z = b.z + 1000;
          t.position.y = b.y + 30;
        }
        if (k.orbPhase === 'warn' && k.beam.busy) duringBeam = true;
        if (turn && k.orbPhase === 'warn' && warnSeen !== k.orbVolleys && k.orbTime > 0.3) {
          warnSeen = k.orbVolleys;
          t.turn();
        }
        if (turn && k.orbPhase === 'idle' && warnSeen >= 0 && k.orbs.activeCount === 0)
          warnSeen = -1;
        t.position.x += t.velocity.x * DT;
        t.position.z += t.velocity.z * DT;
        k.step(DT, t, (a) => {
          if (a === 'orbs') hits++;
        });
      }
      return { hits, duringBeam, volleys: k.orbVolleys };
    };
    const straight = run(false);
    const turning = run(true);
    console.info(
      `xenolith orbs: straight ${String(straight.hits)}/${String(straight.volleys)} volleys, turning ${String(turning.hits)}/${String(turning.volleys)}`,
    );
    expect(straight.duringBeam).toBe(false);
    expect(straight.volleys).toBeGreaterThanOrEqual(4);
    expect(straight.hits).toBeGreaterThanOrEqual(2);
    expect(turning.hits).toBe(0);
  });

  it('勲章の印: 発生器をすべて壊した・発光体をすべて壊した・溜め撃ちを 3 回以上撃たせて一度も当たらない', () => {
    const r = makeRaid();
    const p = r.kaiju.parts;
    const breakAll = (ids: readonly string[]): void => {
      for (const id of ids) {
        const i = p.indexOf(id);
        p.damage(i, (p.partMaxHp[i] ?? 0) + 1, 0);
      }
    };
    expect(r.xenolithGensGone).toBe(false);
    breakAll(['gen0', 'gen1', 'gen2']);
    expect(r.xenolithGensGone).toBe(true);
    breakAll(['emitter0', 'emitter1', 'emitter2']);
    expect(r.xenolithWarpStopped).toBe(false);
    breakAll(['emitter3']);
    expect(r.xenolithWarpStopped).toBe(true);
    expect(r.xenolithChargedDodged).toBe(false);
    r.kaiju.attacksUsed.charged = 3;
    expect(r.xenolithChargedDodged).toBe(true);
    r.count('charged');
    expect(r.xenolithChargedDodged).toBe(false);
  });

  it('HUD: 予兆の警告（LOCK は自分が狙われているときだけ赤・なぎ払い・瞬間移動・光の弾）・攻めどき（バリアが外れた）', () => {
    const r = makeRaid();
    const k = r.kaiju;
    const t = { position: vec3(500, 900, 2000), active: true, id: 0 };
    k.cooldown = 99;
    startAttack(k, 'charged', t, k.random.next);
    expect(xenolithWarning(r, 0)).toMatchObject({ lock: true });
    expect(xenolithWarning(r, 0).text).toContain('LOCK');
    expect(xenolithLockedOn(r, 0)).toBe(true);
    expect(xenolithWarning(r, 2)).toMatchObject({ lock: false });
    expect(xenolithLockedOn(r, 2)).toBe(false);
    k.beam.cancel();
    startAttack(k, 'sweep', t, k.random.next);
    expect(xenolithWarning(r).text).toContain('なぎ払い');
    k.beam.cancel();
    k.attack = null;
    k.warp.phase = 'telegraph';
    expect(xenolithWarning(r).text).toContain('瞬間移動');
    k.warp.phase = 'idle';
    k.orbPhase = 'warn';
    expect(xenolithWarning(r).text).toContain('光の弾');
    k.orbPhase = 'idle';
    expect(xenolithWarning(r).text).toBe('');
    expect(xenolithOpening(r)).toBe('');
    k.barrier.phase = 'down';
    k.barrier.time = 1;
    expect(xenolithOpening(r)).toContain('バリアが外れた');
  });

  it('決定性: 同じ種のボットは同じ結果、記録を再生すると同じ状態（リプレイ）', () => {
    const a = runXenolithBot({ role: 'average', seed: 1, record: true, preset: 'easy' });
    const b = runXenolithBot({ role: 'average', seed: 1, record: true, preset: 'easy' });
    expect(a.status).toBe('success');
    expect(b.seconds).toBe(a.seconds);
    expect(b.hash).toBe(a.hash);
    const data = a.data;
    if (!data) throw new Error('no data');
    expect(data.header.raidKaiju).toBe('xenolith');
    const { w, dev } = createXenolithWorld();
    const back = replay(w, data, 1000);
    expect(back.player.ended).toBe(true);
    expect(w.play.runner?.status).toBe('success');
    expect(dev.raid.dead).toBe(true);
  }, 300_000);

  it('文言: 日本語と英語のキーがそろう', () => {
    expect(Object.keys(XENOLITH_TEXT.en).sort()).toEqual(Object.keys(XENOLITH_TEXT.ja).sort());
    expect(XENOLITH_TEXT.ja.briefing).toHaveLength(XENOLITH_TEXT.en.briefing?.length ?? -1);
  });
});
