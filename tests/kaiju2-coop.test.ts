// 9-6c: ネフィルガの協力レイド: state の大きさと往復、ホストの判定（部位への機銃・攻撃した人の ID・狙う人だけに当たる・人数の補正）、
// 2〜4 人の対戦（インメモリの通信）で写しがホストに付いていく・結果が全員で一致・再接続、ロビーの設定（怪獣）・通信の版
import { describe, expect, it } from 'vitest';
import { PvpArena, KAIJU_ID_BASE } from '../src/combat/pvp-arena';
import { RAID_CONFIG } from '../src/data/kaiju';
import { KAIJU2_RAID_CONFIG as R } from '../src/data/kaiju2-raid';
import { NET_CONFIG } from '../src/data/net';
import { Aircraft, createControls } from '../src/entities/aircraft';
import { headingQuat } from '../src/entities/enemy-aircraft';
import { coopHpScale } from '../src/missions/kaiju2-raid';
import { KAIJU2_ORB_BYTES, KAIJU2_STATE_BASE_BYTES } from '../src/net/codec-kaiju2';
import { fighterSpec } from '../src/net/host-state';
import { Kaiju2Host } from '../src/net/kaiju2-host';
import { Kaiju2Mirror } from '../src/net/kaiju2-mirror';
import { initialSettings } from '../src/net/lobby-rules';
import { netLoadout } from '../src/net/loadout';
import { NO_TARGET, decodeMessage, encodeMessage, type StateMsg } from '../src/net/protocol';
import { RAID_OUTCOME } from '../src/net/raid-host';
import { raidSummary } from '../src/net/raid-result';
import { DT, startMatch } from './pvp-match';
import { runKaiju2Coop } from './kaiju2-coop-bots';

const SPEC = fighterSpec(netLoadout('kestrel', undefined));

function arenaWith(n: number): PvpArena {
  const arena = new PvpArena(
    () => undefined,
    null,
    () => 0.5,
  );
  arena.setTeams(new Map(Array.from({ length: n }, (_, i) => [i, 0])));
  for (let i = 0; i < n; i++)
    arena.add(i, new Aircraft(netLoadout('kestrel', undefined).flight), SPEC);
  return arena;
}

function host(arena: PvpArena, players: number, hard = false): Kaiju2Host {
  return new Kaiju2Host(arena, players, {
    difficulty: hard ? 'hard' : 'normal',
    start: RAID_CONFIG.start,
    seed: 7,
  });
}

function stateMsg(k: StateMsg['kaiju2']): StateMsg {
  return {
    type: 'state',
    tick: 1,
    aircraft: [],
    missiles: [],
    kaiju: null,
    defense: null,
    kaiju2: k,
  };
}

describe('ネフィルガの state（9-6c）', () => {
  it('雷球なし 30 バイト・1 個 10 バイト（5 個で 80）。往復で位置・向き・体力・段階・部位・雷球が戻る', () => {
    const h = host(arenaWith(1), 1);
    const raid = h.raid;
    raid.body.setHpRatio(0.3);
    raid.hp = raid.maxHp * 0.3;
    raid.stormAt = 100;
    raid.elapsed = 123.4;
    const wing = raid.targets.find((t) => t.id === 'wingL');
    if (!wing) throw new Error('wing');
    wing.partHp = 0;
    raid.body.broken.wingL = true;
    const none = encodeMessage(stateMsg(null)).byteLength;
    const base = encodeMessage(stateMsg(h.state())).byteLength - none + 1;
    expect(base).toBe(KAIJU2_STATE_BASE_BYTES);
    for (const o of raid.body.orbs) {
      o.active = true;
      o.position.x = 1000.4;
      o.position.y = 600;
      o.position.z = -2000;
      o.velocity.x = 196;
      o.velocity.y = -20;
    }
    const full = encodeMessage(stateMsg(h.state()));
    expect(full.byteLength - none + 1).toBe(KAIJU2_STATE_BASE_BYTES + 5 * KAIJU2_ORB_BYTES);
    const back = decodeMessage(full);
    if (back?.type !== 'state' || !back.kaiju2) throw new Error('decode');
    const k = back.kaiju2;
    expect(k.position.x).toBeCloseTo(raid.body.position.x, 0);
    expect(k.position.y).toBeCloseTo(raid.body.position.y, 0);
    expect(
      Math.hypot(k.forward.x - raid.body.forward.x, k.forward.z - raid.body.forward.z),
    ).toBeLessThan(1e-3);
    expect(k.hp).toBe(Math.round(raid.hp));
    expect(k.phase).toBe(3);
    expect(k.broken & 1).toBe(1);
    expect(k.parts[0]).toBe(0);
    expect(k.stormAt).toBeCloseTo(100, 1);
    expect(k.elapsed).toBeCloseTo(123.4, 1);
    expect(k.orbs).toHaveLength(5);
    expect(k.orbs[0]?.position.x).toBeCloseTo(1000.5, 1);
    expect(k.orbs[0]?.velocity.x).toBeCloseTo(196, 0);
    // 写しが受け取ると同じ値になる（壊れた部位はお知らせの数も進む）
    const m = new Kaiju2Mirror();
    m.receive(k);
    m.step(DT);
    expect(m.raid.body.phase).toBe(3);
    expect(m.raid.body.broken.wingL).toBe(true);
    expect(m.raid.brokenCount).toBe(1);
    expect(m.raid.stormAt).toBeCloseTo(100, 1);
    expect(m.raid.body.orbs.filter((o) => o.active)).toHaveLength(5);
  });

  it('写しはダメージを受けない（当たりはホスト）', () => {
    const m = new Kaiju2Mirror();
    const h = host(arenaWith(1), 1);
    m.receive(h.state());
    const t = m.raid.targets[0];
    if (!t) throw new Error('target');
    expect(t.applyDamage(1000)).toBe(false);
    expect(m.raid.hp).toBe(h.raid.hp);
  });
});

describe('ネフィルガの協力のホストの判定（9-6c）', () => {
  it('部位はロックの対象・機銃が当たると攻撃した人の ID 付きで部位別の与ダメージに入る', () => {
    const arena = arenaWith(2);
    const h = host(arena, 2);
    for (let i = 0; i < 5; i++) h.step(DT);
    const wing = h.raid.targets.find((t) => t.id === 'wingR');
    const f = arena.fighters.get(1);
    if (!wing || !f) throw new Error('setup');
    // 部位の右 500m から部位へ向けて撃つ
    const p = wing.position;
    f.aircraft.respawn(
      { x: p.x + 500, y: p.y, z: p.z },
      headingQuat({ x: 0, y: 0, z: 0, w: 1 }, -90),
    );
    const fire = {
      ...createControls(),
      autoLevel: false,
      invertPitch: false,
      fire: true,
      missile: false,
      flare: false,
      locked: true,
      targetId: KAIJU_ID_BASE + wing.kaijuIndex,
    };
    const before = h.raid.hp;
    for (let i = 0; i < 60; i++) {
      arena.tick++;
      arena.stepFighter(1, fire, DT, null);
      arena.endTick(DT);
    }
    expect(h.raid.hp).toBeLessThan(before);
    expect(f.lockPart).toBe(wing.kaijuIndex);
    const s1 = h.scoreFields(1);
    const s0 = h.scoreFields(0);
    expect(s1.partDamage.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(s0.partDamage.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('攻撃は狙う人（いちばん近い人）にだけ当たる・予兆と攻撃の間は state の targetId に出る', () => {
    const arena = arenaWith(2);
    const h = host(arena, 2);
    const k = h.raid.body;
    // 1 番を怪獣の近くへ、0 番を遠くへ
    const near = arena.fighters.get(1);
    const far = arena.fighters.get(0);
    if (!near || !far) throw new Error('setup');
    near.aircraft.respawn(
      { x: k.position.x + 600, y: k.position.y, z: k.position.z },
      headingQuat({ x: 0, y: 0, z: 0, w: 1 }, 0),
    );
    far.aircraft.respawn(
      { x: k.position.x - 4000, y: 900, z: k.position.z },
      headingQuat({ x: 0, y: 0, z: 0, w: 1 }, 0),
    );
    let sawTarget = false;
    for (let i = 0; i < 60 * 40; i++) {
      h.step(DT);
      // 機体は動かさない（その場で止める）
      if (h.targetId !== null) {
        sawTarget = true;
        expect(h.targetId).toBe(1);
        expect(h.state().targetId).toBe(1);
      }
    }
    expect(h.focusId).toBe(1);
    expect(sawTarget).toBe(true);
    expect(far.hp).toBe(far.maxHp);
    expect(h.state().targetId === NO_TARGET || h.state().targetId === 1).toBe(true);
  });

  it('全体 HP は人数で増える（1〜4 人 ×1・×1.85・×2.65・×3.5 の設定値）。高難度は ×1.55', () => {
    for (let n = 1; n <= 4; n++) {
      const h = host(arenaWith(n), n);
      expect(h.raid.maxHp).toBeCloseTo(R.hp * coopHpScale(n), 3);
      expect(h.raid.targets.find((t) => t.id === 'head')?.partMaxHp).toBe(
        Math.round(R.hp * coopHpScale(n) * R.targets.head.hpShare),
      );
    }
    expect(host(arenaWith(2), 2, true).raid.maxHp).toBeCloseTo(
      R.hp * coopHpScale(2) * R.hard.hpScale,
      3,
    );
  });
});

describe('ロビーと通信の版（9-6c）', () => {
  it('協力のネフィルガの部屋の初期設定・設定の往復・通信の版 15（10-2 で 11 → 12、10-3b でアルビオンを足して 13、10-3c でアルビオンの state を変えて 14、10-4b でゴウライを足して 15、10-5b でゼノリスを足して 16）', () => {
    expect(NET_CONFIG.protocolVersion).toBe(16);
    const s = initialSettings(true, null, 1);
    expect(s?.raidKaiju).toBe(1);
    expect(s?.mode).toBe('raid');
    expect(initialSettings(true)?.raidKaiju).toBe(0);
  });
});

describe('2〜4 人の協力（インメモリの通信）', () => {
  it('写しがホストのネフィルガに付いていき、撃破の結果が全員で一致する（ボット 2 人・通常）', async () => {
    let worst = 0;
    // 9-6d: 協力のボットは撃墜が多いので残機を外す（このテストは写しと結果の一致を見る。残機は kaiju2-threat.test.ts）
    const r = await runKaiju2Coop({
      role: 'skilled',
      players: 2,
      seed: 1,
      lives: false,
      onSecond: (m) => {
        const h = m.host.raid2;
        const c = m.clients[0];
        if (!h || !c?.kaiju2 || h.raid.dead) return;
        const k = c.kaiju2;
        const p = h.raid.body.position;
        worst = Math.max(
          worst,
          Math.hypot(k.position.x - p.x, k.position.y - p.y, k.position.z - p.z),
        );
      },
    });
    expect(r.cleared).toBe(true);
    // 15Hz の state と 30ms の遅れで、届いた位置はホストの今の位置から数十 m 以内（115〜230 m/s）
    expect(worst).toBeLessThan(150);
    const m = r.match;
    const over = [0, 1].map((id) => m.events[id]?.find((e) => e.kind === 'over'));
    expect(over[0]?.b).toBe(RAID_OUTCOME.clear);
    expect(over[1]?.b).toBe(RAID_OUTCOME.clear);
    expect(over[1]?.n).toBe(over[0]?.n);
    const sums = [0, 1].map((id) => {
      const s = m.scores[id];
      if (!s?.over) throw new Error(`score ${String(id)}`);
      return raidSummary(s.players, {
        cleared: true,
        difficulty: 'normal',
        seconds: (over[id]?.n ?? 0) / 60,
        protectedBuildings: null,
        kaiju: 'nephirga',
      });
    });
    expect(sums[1]).toEqual(sums[0]);
    const total = sums[0]?.rows.reduce((a, row) => a + row.total, 0) ?? 0;
    expect(Math.abs(total - (m.host.raid2?.raid.maxHp ?? 0))).toBeLessThan(10);
    expect(sums[0]?.rows.every((row) => row.partDamage.length === 5)).toBe(true);
  }, 60_000);

  it('途切れても 10 秒以内なら戻って続く（ネフィルガの state は届き直す）', async () => {
    const m = await startMatch(
      1,
      { latencyMs: 40, jitterMs: 10 },
      { mode: 'raid', mapId: RAID_CONFIG.mapId, raidKaiju: 1 },
    );
    const room = m.lobby.clients[0];
    const game = m.clients[0];
    if (!room || !game) throw new Error('client');
    const cruise = (): void => {
      for (const c of m.controls) {
        c.roll = 0.05;
        c.throttleTarget = 0.6;
      }
    };
    await m.run(2, cruise);
    expect(game.kaiju2).not.toBeNull();
    m.lobby.net.setOffline(room.transportId, true);
    await m.run(NET_CONFIG.room.silenceTimeoutSeconds + 1, cruise);
    const stale = game.kaiju2?.elapsed ?? 0;
    m.lobby.net.setOffline(room.transportId, false);
    await m.run(4, cruise);
    expect(room.reconnecting).toBe(false);
    expect(room.ended).toBe(false);
    const k = game.kaiju2;
    const h = m.host.raid2;
    if (!k || !h) throw new Error('kaiju2');
    expect(k.elapsed).toBeGreaterThan(stale + 3);
    expect(Math.abs(k.elapsed - h.raid.elapsed)).toBeLessThan(0.5);
  }, 60_000);
});
