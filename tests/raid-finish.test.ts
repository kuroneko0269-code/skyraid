// 協力レイドの仕上げ（6-6）: 建物の破壊の同期、復帰位置、報酬の式、高難度の数値、ブレイクの貢献者、ブリーフィング、
// ロックの印・攻撃の対象の同期（state の大きさと 4 人で 10 分通す試合は raid-coop-10min.test.ts）
import { describe, expect, it } from 'vitest';
import { KaijuAi } from '../src/ai/kaiju-ai';
import { BuildingField, protectedPercent } from '../src/combat/buildings';
import { KAIJU_ID_BASE } from '../src/combat/pvp-arena';
import { KAIJU_ATTACK_CONFIG, KAIJU_CONFIG, RAID_CONFIG } from '../src/data/kaiju';
import { raidMission } from '../src/data/missions-special';
import { RAID_RULES } from '../src/data/raid';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import { Kaiju, kaijuMaxHp } from '../src/entities/kaiju';
import { KaijuMirror } from '../src/net/kaiju-mirror';
import { spawnPosition } from '../src/net/net-game';
import { raidReward, raidTimeBonus } from '../src/progression/raid-reward';
import { generateCity } from '../src/render/city/layout';
import { createHeightField } from '../src/render/terrain-height';
import { DT, startMatch, type Match } from './pvp-match';
import { cityFields as fields, ruined } from './raid-coop-bots';

const harbor = createHeightField(HARBOR_TERRAIN).getGroundHeight;
const city = generateCity();
const RAID = { mode: 'raid', mapId: RAID_CONFIG.mapId } as const;

/** 上陸を終えた怪獣を街の中（タワー群の東。到達の 450m より外）へ移し、薙ぎ払いをさせる */
async function kaijuIntoCity(m: Match): Promise<void> {
  await m.run(KAIJU_CONFIG.riseSeconds + 0.5);
  const raid = m.host.raid;
  if (!raid) throw new Error('raid');
  raid.kaiju.feet.x = 700;
  raid.kaiju.feet.z = 900;
  raid.ai.begin('sweep', 0);
}

describe('建物の破壊の同期', () => {
  it('建物の番号は生成順の連番で決定的（作り直しても同じ並び）', () => {
    const again = generateCity();
    expect(again.buildings.length).toBe(city.buildings.length);
    for (const i of [0, 1, 500, 2000, city.buildings.length - 1]) {
      expect(again.buildings[i]).toEqual(city.buildings[i]);
    }
  });

  it('ホストが壊した建物の番号が届き、クライアントの建物の集合がホストと一致する（自分では判定しない）', async () => {
    const fs = fields();
    const m = await startMatch(2, { latencyMs: 40, jitterMs: 10 }, RAID, 0, harbor, 11, {
      buildings: (id) => fs[id] ?? null,
    });
    await kaijuIntoCity(m);
    await m.run(15);
    const host = ruined(fs[0] as BuildingField);
    expect(host.length).toBeGreaterThan(20);
    for (const id of [1, 2]) expect(ruined(fs[id] as BuildingField)).toEqual(host);
    // 守れた建物 % も一致
    const pct = protectedPercent(fs[0] as BuildingField);
    for (const id of [1, 2]) expect(protectedPercent(fs[id] as BuildingField)).toBe(pct);
    // ホストの街がないクライアントの写しは自分で壊さない（ruin を受け取るまで何も壊れない）
    const solo = new BuildingField(city);
    const mirror = new KaijuMirror();
    const raid = m.host.raid;
    if (!raid) throw new Error('raid');
    mirror.receive(raid.state(), 1 / 15);
    for (let i = 0; i < 60; i++) mirror.step(DT);
    expect(solo.destroyedCount).toBe(0);
  });

  it('再接続した人には壊れている建物をすべて送り直す', async () => {
    const fs = fields();
    const m = await startMatch(1, {}, RAID, 0, harbor, 11, { buildings: (id) => fs[id] ?? null });
    await kaijuIntoCity(m);
    await m.run(3);
    // クライアントの街を一度まっさらにして（途切れて取りこぼした想定）、ホストに戻ってきたと知らせる
    (fs[1] as BuildingField).reset();
    const room = m.lobby.host as unknown as { awayFns: ((id: number, away: boolean) => void)[] };
    for (const fn of room.awayFns) fn(1, false);
    await m.run(0.5);
    expect(ruined(fs[1] as BuildingField)).toEqual(ruined(fs[0] as BuildingField));
  });
});

describe('協力レイドの復帰', () => {
  it('撃墜から 5 秒で街の北の開始位置（ID ごと）へ。3 秒無敵。復帰回数は成績の被撃墜', async () => {
    const m = await startMatch(1, {}, RAID, 0, harbor);
    await m.run(1);
    m.host.arena.kaijuDamage(1, 1e5);
    await m.run(RAID_RULES.respawnSeconds - 0.3);
    const f = m.host.arena.fighters.get(1);
    expect(f?.alive).toBe(false);
    await m.run(0.5);
    expect(f?.alive).toBe(true);
    expect(f?.invulnerableTimer).toBeGreaterThan(2.5);
    const want = spawnPosition(1, { x: 0, y: 0, z: 0 }, true);
    const p = f?.aircraft.state.position;
    expect(Math.hypot((p?.x ?? 0) - want.x, (p?.z ?? 0) - want.z)).toBeLessThan(120);
    // クライアントの自機も同じ開始位置から計算し直している（入力の溜めの分だけ先へ進んでいる）
    const own = m.owns[1]?.state.position;
    expect(Math.hypot((own?.x ?? 0) - want.x, (own?.z ?? 0) - want.z)).toBeLessThan(150);
    // PvP の輪（半径 4500m）は使わない
    expect(Math.hypot(p?.x ?? 0, p?.z ?? 0)).not.toBeCloseTo(4500, -2);
    await m.run(1.2);
    expect(m.scores[1]?.players.find((s) => s.id === 1)?.deaths).toBe(1);
  });
});

describe('報酬', () => {
  it('協力 3000・ソロ 2000 × 時間ボーナス（7 分未満 ×1.5・9 分未満 ×1.2）× 高難度 1.8、失敗は 300', () => {
    expect(raidTimeBonus(419.9)).toBe(1.5);
    expect(raidTimeBonus(420)).toBe(1.2);
    expect(raidTimeBonus(539.9)).toBe(1.2);
    expect(raidTimeBonus(540)).toBe(1);
    const r = (coop: boolean, seconds: number, hard = false, cleared = true): number =>
      raidReward({ coop, cleared, seconds, difficulty: hard ? 'hard' : 'normal' });
    expect(r(true, 400)).toBe(4500);
    expect(r(true, 500)).toBe(3600);
    expect(r(true, 600)).toBe(3000);
    expect(r(false, 400)).toBe(3000);
    expect(r(false, 500)).toBe(2400);
    expect(r(false, 700)).toBe(2000);
    expect(r(true, 400, true)).toBe(8100);
    expect(r(false, 600, true)).toBe(3600);
    expect(r(true, 100, true, false)).toBe(300);
    expect(r(false, 100, false, false)).toBe(300);
  });

  it('ソロのレイドのミッションは報酬の式を使い、難易度を怪獣に渡す', () => {
    const hard = raidMission('hard');
    expect(hard.id).toBe('raid');
    expect(hard.reward.raid?.difficulty).toBe('hard');
    expect(hard.spawns[0]).toMatchObject({ kind: 'kaiju', hard: true });
    expect(raidMission().spawns[0]).toMatchObject({ kind: 'kaiju', hard: false });
  });
});

describe('高難度の数値', () => {
  it('HP ×1.4（部位 HP も）・予兆 −0.5 秒・最終フェーズ 3.5 分', () => {
    expect(kaijuMaxHp(4, undefined, true)).toBe(Math.round(30550 * 1.4));
    expect(kaijuMaxHp(1, undefined, true)).toBe(Math.round(8840 * 1.4));
    const k = new Kaiju();
    k.emerge(0, 0, 0, -1000, { players: 2, hard: true });
    expect(k.maxHp).toBe(Math.round(KAIJU_CONFIG.baseHp * 1.45 * 1.4));
    expect(k.part('crystal').partMaxHp).toBe(Math.round(k.maxHp * 0.14));
    const ai = new KaijuAi(k, { damage: () => undefined, stun: () => undefined });
    expect(ai.windup(KAIJU_ATTACK_CONFIG.beam.windup)).toBeCloseTo(2.0, 6);
    expect(ai.windup(KAIJU_ATTACK_CONFIG.throw.windup)).toBeCloseTo(0.7, 6);
    expect(ai.windup(KAIJU_ATTACK_CONFIG.beam.repeatWindup)).toBeCloseTo(0.5, 6);
    for (let i = 0; i < KAIJU_CONFIG.riseSeconds * 60 + 2; i++) k.step(DT);
    k.part('tail').damageBy(k.maxHp * 0.65, 0);
    expect(k.phase).toBe(3);
    expect(k.finalRemaining).toBe(210);
    // 通常は今までどおり
    const n = new Kaiju();
    n.emerge(0, 0, 0, -1000, { players: 2 });
    const nai = new KaijuAi(n, { damage: () => undefined, stun: () => undefined });
    expect(nai.windup(KAIJU_ATTACK_CONFIG.beam.windup)).toBe(2.5);
    expect(n.maxHp).toBe(Math.round(KAIJU_CONFIG.baseHp * 1.45));
  });

  it('ロビーの高難度は設定で全員に届き、ホストの怪獣が高難度になる', async () => {
    const m = await startMatch(1, {}, { ...RAID, hard: true });
    expect(m.lobby.clients[0]?.settings.hard).toBe(true);
    expect(m.host.raid?.kaiju.hard).toBe(true);
    expect(m.host.raid?.kaiju.maxHp).toBe(Math.round(KAIJU_CONFIG.baseHp * 1.45 * 1.4));
  });
});

describe('ブレイクの貢献者', () => {
  it('3 秒以内に当てた人を記録し、event のビットで全員に届く', async () => {
    const k = new Kaiju();
    k.emerge(0, 0, 0, -1000, { players: 3 });
    for (let i = 0; i < KAIJU_CONFIG.riseSeconds * 60 + 2; i++) k.step(DT);
    const events: { by: readonly number[] }[] = [];
    k.onEvent((e) => {
      if (e.kind === 'break') events.push({ by: e.by });
    });
    k.part('head').damageBy(10, 2);
    for (let i = 0; i < 60; i++) k.step(DT);
    k.part('head').damageBy(10, 0);
    expect(events).toEqual([{ by: [0, 2] }]);
    expect(k.stats.breaks.get(0)).toBe(1);
    expect(k.stats.breaks.get(2)).toBe(1);
    expect(k.stats.breaks.get(1)).toBeUndefined();
    expect(k.stats.breakLog).toEqual([{ part: 0, by: [0, 2] }]);
    // 与ダメージは攻撃した人・部位ごと（倍率込み）
    expect(k.stats.damageOf(2)[0]).toBeCloseTo(10 * KAIJU_CONFIG.partyDamageScale[2], 6);

    const m = await startMatch(2, {}, RAID);
    await m.run(KAIJU_CONFIG.riseSeconds + 0.5);
    const head = m.host.raid?.kaiju.part('head');
    head?.damageBy(10, 1);
    head?.damageBy(10, 2);
    await m.run(0.3);
    for (const id of [0, 1, 2]) {
      const e = m.events[id]?.find((x) => x.kind === 'break');
      expect(e).toMatchObject({ a: 0, b: 0b110 });
    }
  });
});

describe('ブリーフィング・ロックの印・攻撃の対象', () => {
  it('ブリーフィング 5 秒の後にカウントダウン。全員がスキップを押すと早く終わる', async () => {
    const m = await startMatch(2, {}, RAID, 3, harbor, 11, { briefingSeconds: 5 });
    await m.run(1);
    expect(m.host.briefingRemaining).toBeCloseTo(4, 1);
    expect(m.host.countdownRemaining).toBe(3);
    m.host.skipBriefing();
    m.clients[0]?.skipBriefing();
    await m.run(0.5);
    // 1 人がまだ押していない（初めての人は待つ）
    expect(m.host.briefingRemaining).toBeGreaterThan(3);
    m.clients[1]?.skipBriefing();
    await m.run(0.5);
    expect(m.host.briefingRemaining).toBe(0);
    for (const c of m.clients) expect(c.briefingRemaining).toBe(0);
    expect(m.host.countdownRemaining).toBeGreaterThan(2);
    await m.run(3);
    expect(m.host.countdownRemaining).toBe(0);
    expect(m.host.playTicks).toBeGreaterThan(0);
  });

  it('他の人がロックしている部位と、怪獣の攻撃の対象が全員に届く', async () => {
    const m = await startMatch(2, {}, RAID, 0, harbor);
    await m.run(KAIJU_CONFIG.riseSeconds + 0.5, (k) => {
      const c = m.combat[1];
      if (c && k > 30) {
        c.locked = true;
        c.targetId = KAIJU_ID_BASE + 2;
      }
    });
    expect(m.host.lockPartOf(1)).toBe(2);
    expect(m.clients[1]?.lockPartOf(1)).toBe(2);
    expect(m.clients[1]?.lockPartOf(0)).toBe(-1);
    const raid = m.host.raid;
    if (!raid) throw new Error('raid');
    raid.ai.begin('throw', 2);
    await m.run(0.3);
    expect(m.host.kaijuTarget).toBe(2);
    for (const c of m.clients) expect(c.kaijuTarget).toBe(2);
  });
});
