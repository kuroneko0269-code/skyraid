// 10-3b: 白鯨アルビオンの協力レイド（差し込み口 net/albion-coop.ts）: state の大きさと往復・帯域（4KB/s 以下）・ホストの判定（部位と子分に
// 攻撃した人の ID 付きで当たる・攻撃は向けた人にだけ・子分の体当たりは人ごと・人数の補正）・2 人の対戦（インメモリの通信）で写しが
// ホストに付いていく・終わりの理由（倒した / 時間切れ）
import { describe, expect, it } from 'vitest';
import { PvpArena } from '../src/combat/pvp-arena';
import { ALBION_CONFIG as C } from '../src/data/albion';
import { albionCoopHpScale } from '../src/data/albion-raid';
import { NET_CONFIG } from '../src/data/net';
import { raidKaijuIndex } from '../src/data/raid-kaiju';
import { Aircraft } from '../src/entities/aircraft';
import { writeAlbionState } from '../src/net/albion-codec';
import { AlbionCoopHost, AlbionCoopMirror, albionRaidPlugin } from '../src/net/albion-coop';
import { KAIJU2_OUTCOME } from '../src/net/kaiju2-host';
import { fighterSpec } from '../src/net/host-state';
import type { GameSettings } from '../src/net/protocol';
import { netLoadout } from '../src/net/loadout';
import { ClientGame } from '../src/net/client-game';
import { RAID_EXTRA_MAX_BYTES, registerRaidPlugin } from '../src/net/raid-plugin';
import { RAID_OUTCOME } from '../src/net/raid-host';
import { albionHostOf, runAlbionCoop } from './albion-coop-bots';

const SPEC = fighterSpec(netLoadout('kestrel', undefined));

registerRaidPlugin(albionRaidPlugin(() => undefined));

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

function settingsOf(hard: boolean): GameSettings {
  return {
    mapId: 'harbor',
    timeLimitSeconds: 900,
    scoreLimit: 0,
    mode: 'raid',
    noUpgrades: true,
    rookieGuard: false,
    hard,
    weather: 'clear',
    aimAssist: false,
    autoFire: false,
    raidKaiju: raidKaijuIndex('albion'),
  };
}

function host(arena: PvpArena, players: number, hard = false): AlbionCoopHost {
  const settings = settingsOf(hard);
  return new AlbionCoopHost(arena, { arena, players, settings, seed: 7 });
}

describe('アルビオンの協力の state（10-3b）', () => {
  it('子分なし 約 90 バイト・1 匹 11 バイト（16 匹でも上限 1KB の内）。15Hz で 4KB/s 以下。往復で体・段階・部位・子分が戻る', () => {
    const h = host(arenaWith(4), 4);
    const raid = h.raid;
    for (let i = 0; i < 60 * 40; i++) h.step(1 / 60);
    raid.kaiju.parts.damage(raid.kaiju.parts.indexOf('nestFront'), 1e6, 1);
    const sw = raid.kaiju.swarm;
    sw.minions.forEach((m, i) => {
      m.active = true;
      m.position.x = raid.kaiju.body.position.x + 30 * i;
      m.position.y = raid.kaiju.body.position.y - 100;
      m.position.z = raid.kaiju.body.position.z - 20 * i;
      m.velocity.x = C.minions.speed;
      m.velocity.y = 0;
      m.velocity.z = 0;
      m.hp = 36;
    });
    const empty = writeAlbionState(
      new AlbionCoopHost(arenaWith(1), {
        arena: arenaWith(1),
        players: 1,
        settings: settingsOf(false),
        seed: 1,
      }).raid,
      null,
    ).length;
    expect(empty).toBeLessThan(100);
    const full = writeAlbionState(raid, 2);
    expect(full.length).toBe(empty + C.minions.cap * 11);
    expect(full.length).toBeLessThanOrEqual(RAID_EXTRA_MAX_BYTES);
    // state 全体の他の欄（機体 4 機など）を足しても 4KB/s 以下（ネフィルガの協力は約 3.1KB/s）
    expect(full.length * NET_CONFIG.rates.stateHz).toBeLessThan(4000);
    const m = new AlbionCoopMirror(() => 0);
    m.receiveState(full);
    const k = m.raid.kaiju;
    expect(m.targetId).toBe(2);
    expect(k.body.visible).toBe(true);
    expect(k.body.position.x).toBeCloseTo(raid.kaiju.body.position.x, 1);
    expect(k.body.heading).toBeCloseTo(raid.kaiju.body.heading, 4);
    expect(k.phase).toBe(raid.kaiju.phase);
    expect(k.action).toBe(raid.kaiju.action);
    expect(k.parts.ratio).toBeCloseTo(raid.kaiju.parts.ratio, 3);
    expect(k.parts.isBroken(k.parts.indexOf('nestFront'))).toBe(true);
    expect(k.swarm.activeCount).toBe(C.minions.cap);
    const m5 = k.swarm.minions[5];
    expect(m5?.position.x).toBeCloseTo(raid.kaiju.body.position.x + 150, 0);
    expect(m5?.hp).toBeCloseTo(36, -1);
    expect(m.raid.timeLeft).toBeCloseTo(raid.timeLeft, 0);
    // 写しはダメージを受けない
    expect(m.raid.damagePart(0, 1000)).toBe(false);
  });
});

describe('アルビオンの協力のホスト（10-3b）', () => {
  it('部位・子分は攻撃した人の ID 付き（成績の列: 胴・巣・背びれ・尾・頭・子分）。人数で体力が増える', () => {
    const arena = arenaWith(2);
    const h = host(arena, 2);
    expect(h.raid.kaiju.parts.maxHp).toBeCloseTo(C.hp * albionCoopHpScale(2));
    const nest = h.parts.find((p) => p.id === 'nestMid');
    nest?.damageBy(100, 1);
    const head = h.parts.find((p) => p.id === 'head');
    head?.damageBy(50, 0);
    for (let i = 0; i < 60 * 12; i++) h.step(1 / 60);
    const mi = h.raid.kaiju.swarm.minions.findIndex((m) => m.active);
    expect(mi).toBeGreaterThanOrEqual(0);
    h.minions[mi]?.damageBy(1000, 1);
    // 10-3c: 子分を落とすと本体も全体 HP の 1% 減る（胴の硬さ ×0.8 を戻して渡すので、胴の列は 1% ÷ 0.8）
    const reward = (h.raid.kaiju.parts.maxHp * C.minionReward.hpRatio) / 0.8;
    const f1 = h.fields(1).partDamage;
    expect(f1[0]).toBeCloseTo(reward, 0);
    expect(f1.slice(1)).toEqual([100, 0, 0, 0, C.minions.hp]);
    expect(h.fields(0).partDamage).toEqual([0, 0, 0, 0, 50, 0]);
    expect(h.raid.kaiju.swarm.killsBy[1]).toBe(1);
  });

  it('潮吹きは攻撃を向けた人にだけ当たる。子分の体当たりは当たった人に', () => {
    const arena = arenaWith(2);
    const h = host(arena, 2);
    const k = h.raid.kaiju;
    const b = k.body;
    const fx = -Math.sin(b.heading);
    const fz = -Math.cos(b.heading);
    const top = {
      x: b.position.x + fx * C.attacks.spout.forward,
      y: b.position.y + 200,
      z: b.position.z + fz * C.attacks.spout.forward,
    };
    // 2 人とも噴気孔の真上（0 がいちばん近い → 攻撃を向ける人）
    const f0 = arena.fighters.get(0);
    const f1 = arena.fighters.get(1);
    if (!f0 || !f1) throw new Error('fighters');
    Object.assign(f0.aircraft.state.position, top);
    Object.assign(f1.aircraft.state.position, { ...top, y: top.y + 50 });
    k.cooldown = 1e9;
    h.step(1 / 60);
    expect(h.focusId).toBe(0);
    k.action = 'windup';
    k.attack = 'spout';
    k.actionTime = 0;
    k.swarm.clear();
    k.swarm.timer = 1e9;
    const hp0 = f0.hp;
    const hp1 = f1.hp;
    for (let i = 0; i < 60 * 4; i++) {
      Object.assign(f0.aircraft.state.position, top);
      Object.assign(f1.aircraft.state.position, { ...top, y: top.y + 50 });
      h.step(1 / 60);
    }
    expect(f0.hp).toBeLessThan(hp0);
    expect(f1.hp).toBe(hp1);
    // 子分の体当たり（1 の目の前に子分を置く）
    const m = k.swarm.minions[0];
    if (!m) throw new Error('minion');
    m.active = true;
    m.age = 5;
    m.hp = C.minions.hp;
    Object.assign(m.position, f1.aircraft.state.position);
    m.velocity.x = 1;
    const before = f1.hp;
    h.step(1 / 60);
    expect(f1.hp).toBeLessThan(before);
  });

  it('終わり: 倒した → 成功・時間切れ → 失敗（全体の時間切れと同じ理由）', () => {
    const h = host(arenaWith(1), 1);
    expect(h.outcome).toBe(RAID_OUTCOME.none);
    h.raid.timeUp = true;
    expect(h.outcome).toBe(KAIJU2_OUTCOME.totalFail);
    const h2 = host(arenaWith(1), 1);
    h2.raid.damagePart(0, 1e9, 0);
    expect(h2.outcome).toBe(RAID_OUTCOME.clear);
  });
});

describe('アルビオンの協力の対戦（インメモリの通信）', () => {
  it('2 人: 写しがホストに付いていく（位置 40m 以内・段階・子分の数）・state は 4KB/s 以下', async () => {
    let checked = 0;
    let maxBytes = 0;
    const mirror = new AlbionCoopMirror(() => 0);
    let version = -1;
    const r = await runAlbionCoop({
      role: 'average',
      players: 2,
      seed: 1,
      maxSeconds: 60,
      onSecond: (m) => {
        const h = albionHostOf(m);
        const c = m.game(1);
        if (!h || !(c instanceof ClientGame)) return;
        const x = c.raidExtra;
        if (x && c.kaijuVersion !== version) {
          version = c.kaijuVersion;
          mirror.receiveState(x.bytes);
          maxBytes = Math.max(maxBytes, x.bytes.length);
        }
        mirror.step(0);
        const a = h.raid.kaiju.body.position;
        const b = mirror.raid.kaiju.body.position;
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(40);
        expect(mirror.raid.kaiju.phase).toBe(h.raid.kaiju.phase);
        // 最後の state（1/15 秒前）から 1 回分の子分（巣 3 × 2 匹）が出た・消えたぶんだけずれてよい
        expect(
          Math.abs(mirror.raid.kaiju.swarm.activeCount - h.raid.kaiju.swarm.activeCount),
        ).toBeLessThanOrEqual(C.minions.perNest * 3);
        checked++;
      },
    });
    expect(r.outcome).toBe(0);
    expect(checked).toBeGreaterThan(50);
    expect(maxBytes * NET_CONFIG.rates.stateHz).toBeLessThan(4000);
  }, 120_000);
});
