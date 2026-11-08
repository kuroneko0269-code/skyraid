// 10-4b: メカ怪獣ゴウライのソロのレイド: 登録（怪獣選び・リプレイの題）・報酬と残機・体力の倍率（難易度・人数）・制限時間で失敗・
// 撃破で沈んで消える・体は通り抜けられない（弾く・ダメージ・続けて当たらない間・後半は装甲の箱が無い）・機銃は進む先を見越す
// （まっすぐ飛ぶと当たり、曲がり続けると当たりにくい）・勲章の印・HUD の警告・決定性とリプレイ・文言の言語のそろい
import { describe, expect, it } from 'vitest';
import { GouraiKaiju } from '../src/ai/gourai-ai';
import { gouraiPenetration } from '../src/ai/gourai-hull';
import type { HullHit } from '../src/ai/albion-hull';
import { createCombatInput } from '../src/combat/combat-input';
import { GOURAI_CONFIG as C, GOURAI_PARTS } from '../src/data/gourai';
import { GOURAI_RAID_CONFIG as R, gouraiCoopHpScale } from '../src/data/gourai-raid';
import { GOURAI_TEXT } from '../src/data/gourai-text';
import { RAID_RULES } from '../src/data/raid';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import { bayPatrol } from '../src/missions/gourai-dev';
import { GOURAI_VARIANT, gouraiRaidMission } from '../src/missions/gourai-mission';
import { GouraiRaid } from '../src/missions/gourai-raid';
import { findRaidVariant } from '../src/missions/raid-variants';
import { createHeightField } from '../src/render/terrain-height';
import { replayTitle } from '../src/replay/outcome';
import { missionFor, startFromHeader, stepWorld } from '../src/replay/sim';
import { gouraiOpening, gouraiWarning } from '../src/ui/gourai-hud';
import { createGouraiWorld, gouraiStart, runGouraiBot } from './gourai-raid-bots';
import { replay } from './replay-helpers';
import './i18n-setup';

const DT = 1 / 60;
const ground = createHeightField(HARBOR_TERRAIN).getGroundHeight;

function makeRaid(difficulty: 'normal' | 'hard' = 'normal', players = 1): GouraiRaid {
  const r = new GouraiRaid(ground);
  r.reset(true, difficulty, players);
  const p = bayPatrol({ x: 0, z: 0 });
  r.spawn(p, p.x, p.z - p.radius, Math.PI, 7, { x: 0, z: 0 });
  return r;
}

const far = { position: { x: 0, y: 3000, z: -4800 }, active: true };

describe('メカ怪獣ゴウライのソロのレイド（10-4b）', () => {
  it('登録: 怪獣選び・リプレイの題・報酬の式・残機・失敗の条件', () => {
    createGouraiWorld();
    expect(findRaidVariant('gourai')).toBe(GOURAI_VARIANT);
    expect(missionFor({ mode: 'raid', raidDifficulty: 'hard', raidKaiju: 'gourai' })?.id).toBe(
      'raidGourai',
    );
    expect(replayTitle(gouraiStart(1, 'hard'))).toBe('ゴウライ（高難度）');
    const def = gouraiRaidMission('normal');
    expect(def.reward.raid).toEqual({ difficulty: 'normal', kaiju: 'gourai' });
    expect(def.lives).toBe(RAID_RULES.lives.normal);
    expect(def.lives).toBe(3);
    expect(def.failConditions).toEqual(['totalTimeUp', 'outOfBounds', 'livesOut']);
  });

  it('体力: 通常 C.hp・高難度 ×1.3（攻撃・弾幕が速い・当たりが重い）・協力の人数で ×1 / ×1.6 / ×2.2 / ×2.8（部位も同じ割合）', () => {
    expect(makeRaid().kaiju.parts.maxHp).toBe(C.hp);
    const hard = makeRaid('hard');
    expect(hard.kaiju.parts.maxHp).toBeCloseTo(C.hp * R.hard.hpScale);
    expect(hard.kaiju.intervalScale).toBe(R.hard.intervalScale);
    expect(hard.kaiju.damageScale).toBe(R.hard.damageScale);
    expect(hard.kaiju.barrageScale).toBe(R.hard.barrageRate);
    const core = GOURAI_PARTS.indexOf('core');
    for (let n = 1; n <= 4; n++) {
      const r = makeRaid('normal', n);
      expect(r.kaiju.parts.maxHp).toBeCloseTo(C.hp * gouraiCoopHpScale(n));
      expect(r.kaiju.parts.partMaxHp[core]).toBeCloseTo(C.hp * gouraiCoopHpScale(n) * 0.12);
    }
    expect(gouraiCoopHpScale(1)).toBe(1);
  });

  it('制限時間が切れると失敗（時間切れ）・倒すと傾いて海へ沈んで消え、弾も消える', () => {
    const r = makeRaid();
    r.elapsed = R.totalSeconds.normal - 0.05;
    for (let i = 0; i < 10; i++) r.step(DT, far, null, () => undefined);
    expect(r.timeUp).toBe(true);
    expect(r.timeLeft).toBe(0);
    const r2 = makeRaid();
    const near = { position: { x: 0, y: 200, z: 0 }, active: true };
    for (let i = 0; i < 60 * 20; i++) {
      const b = r2.kaiju.body.position;
      near.position.x = b.x;
      near.position.z = b.z - 900;
      r2.step(DT, near, null, () => undefined);
    }
    expect(r2.kaiju.shots.activeCount).toBeGreaterThan(0);
    // 胴の球（0）に当てて倒す
    expect(r2.damageSphere(0, 1e9)).toBe(true);
    expect(r2.dead).toBe(true);
    r2.step(DT, far, null, () => undefined);
    expect(r2.kaiju.shots.activeCount).toBe(0);
    for (let i = 0; i < 60 * 60 && r2.kaiju.body.visible; i++)
      r2.step(DT, far, null, () => undefined);
    expect(r2.kaiju.body.visible).toBe(false);
    expect(r2.landedTime).toBeGreaterThanOrEqual(R.vanishSeconds);
  });

  it('体の当たり: 胴・前の装甲の箱の中はめり込み、外向きは浅い面へ。後半は装甲の箱が無い', () => {
    const k = new GouraiKaiju(ground);
    k.spawn({ x: 0, z: 2700, radius: 900 }, 0, 1800, 0, 1);
    const b = k.body.position;
    const hit: HullHit = { depth: 0, normal: { x: 0, y: 0, z: 0 }, shape: 'body' };
    // 胴の真上の少し下（上の面へ出る）
    expect(gouraiPenetration(k.body, true, { x: b.x, y: b.y + 28, z: b.z }, 6, hit)).toBe(true);
    expect(hit.normal.y).toBe(1);
    // 前の装甲の楔の先（向き 0 = 北 −z が前）
    expect(gouraiPenetration(k.body, true, { x: b.x, y: b.y, z: b.z - 90 }, 6, hit)).toBe(true);
    expect(gouraiPenetration(k.body, false, { x: b.x, y: b.y, z: b.z - 90 }, 6, hit)).toBe(false);
    // 外（横 80m）
    expect(gouraiPenetration(k.body, true, { x: b.x + 80, y: b.y, z: b.z }, 6, hit)).toBe(false);
  });

  it('10-4c: 体の当たり（ソロのレイド）: 体へ突っ込むと最大 HP の約 8 割・跳ねない（向き・速さはそのまま）・演出の知らせ。1.5 秒は続けて当たらない', () => {
    const { w, dev } = createGouraiWorld();
    startFromHeader(w, gouraiStart(3, 'normal'));
    const s = w.play.session;
    const k = dev.kaiju;
    k.cooldown = 1e9;
    const b = k.body.position;
    const a = s.aircraft;
    const p = a.state.position;
    // 体の横 150m から、体へ向かって（機首を体へ）
    const put = (): void => {
      const rx = Math.cos(k.body.heading);
      const rz = -Math.sin(k.body.heading);
      p.x = b.x + rx * 150;
      p.y = b.y;
      p.z = b.z + rz * 150;
      a.prevPosition.x = p.x;
      a.prevPosition.y = p.y;
      a.prevPosition.z = p.z;
      const yaw = Math.atan2(rx, rz);
      const q = a.state.orientation;
      q.x = 0;
      q.y = Math.sin(yaw / 2);
      q.z = 0;
      q.w = Math.cos(yaw / 2);
    };
    put();
    const hp = s.player.hp;
    let rams = 0;
    s.combat.ramListeners.on(() => rams++);
    let hitAt = -1;
    for (let i = 0; i < 60; i++) {
      const qBefore = { ...a.state.orientation };
      const speed = a.state.speed;
      stepWorld(w.play, w.buildings(), w.controls, createCombatInput(), DT);
      if (hitAt < 0 && dev.taken.body === 1) {
        hitAt = i;
        // 跳ねない: ぶつかったステップで向きが跳ね返らない・速さが大きく落ちない
        const q = a.state.orientation;
        expect(
          Math.abs(q.x * qBefore.x + q.y * qBefore.y + q.z * qBefore.z + q.w * qBefore.w),
        ).toBeGreaterThan(0.99);
        expect(a.state.speed).toBeGreaterThan(speed * 0.95);
      }
    }
    expect(dev.taken.body).toBe(1);
    expect(rams).toBe(1);
    expect(hp - s.player.hp).toBeCloseTo(s.player.maxHp * 0.8, 0);
    // すぐにもう一度突っ込んでも、続けて当たらない間はダメージなし
    put();
    for (let i = 0; i < 20; i++)
      stepWorld(w.play, w.buildings(), w.controls, createCombatInput(), DT);
    expect(dev.taken.body).toBe(1);
  });

  it('機銃は進む先を見越す: 正面 900m を横切ってまっすぐ飛ぶと当たり、曲がり続けると当たりにくい（予兆を見て避ければ当たらない）', () => {
    const run = (turn: boolean): number => {
      const k = new GouraiKaiju(ground);
      k.spawn({ x: 0, z: 3000, radius: 900 }, 0, 3000, 0, 9);
      k.immortal = true;
      k.cooldown = 1e9;
      const pos = { x: 0, y: 0, z: 0 };
      const vel = { x: 0, y: 0, z: 0 };
      const me = { position: pos, velocity: vel, active: true, id: 0, radius: 6 };
      const b0 = { ...k.body.position };
      let hits = 0;
      for (let i = 0; i < 60 * 20; i++) {
        const t = i * DT;
        if (turn) {
          // 体の前 900m を中心に半径 300m を回り続ける（曲がる速さ 250/300 ラジアン/秒）
          const a = t * (250 / 300);
          vel.x = -Math.sin(a) * 250;
          vel.z = Math.cos(a) * 250;
          pos.x = b0.x + Math.cos(a) * 300;
          pos.z = b0.z - 900 + Math.sin(a) * 300;
        } else {
          // 体の前 900m を東西に往復（まっすぐ 6 秒ずつ）
          const leg = Math.floor(t / 6) % 2 === 0 ? 1 : -1;
          const u = (t % 6) - 3;
          vel.x = 250 * leg;
          vel.z = 0;
          pos.x = b0.x + 250 * u * leg;
          pos.z = b0.z - 900;
        }
        pos.y = b0.y + 60;
        k.step(DT, me, null, (kind) => {
          if (kind === 'gun') hits++;
        });
      }
      return hits;
    };
    const straight = run(false);
    const turning = run(true);
    console.info(`gourai lead: straight hits ${String(straight)}, turning hits ${String(turning)}`);
    expect(straight).toBeGreaterThanOrEqual(3);
    expect(turning).toBeLessThan(straight);
  });

  it('勲章の印: 砲台をすべて壊した・放熱の間に核を壊した・ミサイルを一度も受けず 4 発以上外した', () => {
    const r = makeRaid();
    const p = r.kaiju.parts;
    for (const id of ['gunL', 'gunR', 'podL', 'podR', 'hipL', 'hipR']) {
      const i = p.indexOf(id);
      p.damage(i, (p.partMaxHp[i] ?? 0) + 1, 0);
    }
    expect(r.gouraiTurretsGone).toBe(true);
    // 放熱の間（核が開いている）に核を壊す
    r.kaiju.action = 'vent';
    const coreSphere = 3;
    const core = p.indexOf('core');
    expect(r.damageSphere(coreSphere, (p.partMaxHp[core] ?? 0) + 1)).toBe(false);
    expect(r.gouraiVentCore).toBe(true);
    expect(r.gouraiFlared).toBe(false);
    r.kaiju.decoyed = 4;
    expect(r.gouraiFlared).toBe(true);
    r.missileTaken = 1;
    expect(r.gouraiFlared).toBe(false);
    // 核は閉じている間は当たらない（放熱でなければ印は付かない）
    const r2 = makeRaid();
    expect(r2.damageSphere(coreSphere, 1e9)).toBe(false);
    expect(r2.gouraiVentCore).toBe(false);
  });

  it('HUD: 予兆の警告（一斉発射・回転掃射と残り秒、掃射は攻撃の間も）・攻めどき（放熱・装甲を捨てる・隙）', () => {
    const r = makeRaid();
    const k = r.kaiju;
    k.attack = 'volley';
    k.action = 'windup';
    k.actionTime = 0.5;
    expect(gouraiWarning(r)).toContain('一斉発射');
    expect(gouraiWarning(r)).toContain('1.5');
    k.attack = 'sweep';
    k.action = 'active';
    expect(gouraiWarning(r)).toContain('回転掃射');
    k.attack = null;
    k.action = 'vent';
    k.actionTime = 2;
    expect(gouraiOpening(r)).toContain('放熱');
    k.action = 'purge';
    expect(gouraiOpening(r)).toContain('装甲');
    k.action = 'idle';
    expect(gouraiWarning(r)).toBe('');
    expect(gouraiOpening(r)).toBe('');
  });

  it('決定性: 同じ種のボットは同じ結果、記録を再生すると同じ状態（リプレイ）', () => {
    const a = runGouraiBot({ role: 'skilled', seed: 1, record: true, preset: 'easy' });
    const b = runGouraiBot({ role: 'skilled', seed: 1, record: true, preset: 'easy' });
    expect(a.status).toBe('success');
    expect(b.seconds).toBe(a.seconds);
    expect(b.hash).toBe(a.hash);
    const data = a.data;
    if (!data) throw new Error('no data');
    expect(data.header.raidKaiju).toBe('gourai');
    const { w, dev } = createGouraiWorld();
    const back = replay(w, data, 1000);
    expect(back.player.ended).toBe(true);
    expect(w.play.runner?.status).toBe('success');
    expect(dev.raid.dead).toBe(true);
  }, 300_000);

  it('文言: 日本語と英語のキーがそろう', () => {
    expect(Object.keys(GOURAI_TEXT.en).sort()).toEqual(Object.keys(GOURAI_TEXT.ja).sort());
    expect(GOURAI_TEXT.ja.briefing).toHaveLength(GOURAI_TEXT.en.briefing?.length ?? -1);
  });
});
