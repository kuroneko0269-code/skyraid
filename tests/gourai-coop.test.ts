// 10-4b: メカ怪獣ゴウライの協力レイド（差し込み口 net/gourai-coop.ts）: state の大きさと往復・帯域（4KB/s 以下）・機銃の弾の知らせ
// （写しの砲台から撃つ）・ホストの判定（部位に攻撃した人の ID 付き・大きな攻撃は向けた人へ・弾幕はそれぞれ近い人へ・人数の補正）・
// 体は通り抜けられない（ホストが参加者を弾く）・2 人の対戦（インメモリの通信）で写しがホストに付いていく・終わりの理由
import { describe, expect, it } from 'vitest';
import { PvpArena } from '../src/combat/pvp-arena';
import { GOURAI_CONFIG as C } from '../src/data/gourai';
import { gouraiCoopHpScale } from '../src/data/gourai-raid';
import { NET_CONFIG } from '../src/data/net';
import { raidKaijuIndex } from '../src/data/raid-kaiju';
import { Aircraft } from '../src/entities/aircraft';
import { writeGouraiState } from '../src/net/gourai-codec';
import { GouraiCoopHost, GouraiCoopMirror, gouraiRaidPlugin } from '../src/net/gourai-coop';
import { KAIJU2_OUTCOME } from '../src/net/kaiju2-host';
import { fighterSpec } from '../src/net/host-state';
import type { GameSettings } from '../src/net/protocol';
import { netLoadout } from '../src/net/loadout';
import { ClientGame } from '../src/net/client-game';
import { RAID_EXTRA_MAX_BYTES, registerRaidPlugin } from '../src/net/raid-plugin';
import { RAID_OUTCOME } from '../src/net/raid-host';
import { gouraiHostOf, runGouraiCoop } from './gourai-coop-bots';

const SPEC = fighterSpec(netLoadout('kestrel', undefined));

registerRaidPlugin(gouraiRaidPlugin(() => undefined));

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
    raidKaiju: raidKaijuIndex('gourai'),
  };
}

function host(arena: PvpArena, players: number, hard = false): GouraiCoopHost {
  return new GouraiCoopHost(arena, { arena, players, settings: settingsOf(hard), seed: 7 });
}

/** 体の前 dist m・上 up m（世界） */
function front(h: GouraiCoopHost, dist: number, up = 40): { x: number; y: number; z: number } {
  const b = h.raid.kaiju.body;
  return {
    x: b.position.x - Math.sin(b.heading) * dist,
    y: b.position.y + up,
    z: b.position.z - Math.cos(b.heading) * dist,
  };
}

describe('ゴウライの協力の state（10-4b）', () => {
  it('ミサイルなし 約 100 バイト・1 発 10 バイト（上限 1KB の内）。15Hz で 4KB/s 以下。往復で体・段・熱・部位・ミサイルが戻る', () => {
    const h = host(arenaWith(2), 2);
    const raid = h.raid;
    for (let i = 0; i < 60 * 20; i++) h.step(1 / 60);
    const k = raid.kaiju;
    k.parts.damage(k.parts.indexOf('gunL'), 1e4, 1);
    const empty = writeGouraiState(raid, null);
    const base =
      empty.length - 10 * k.shots.shots.filter((s) => s.active && s.kind === 'missile').length;
    expect(base).toBeLessThan(110);
    // ミサイルを 12 発飛ばす
    k.shots.clear();
    for (let i = 0; i < 12; i++)
      k.shots.fire({
        turret: 2,
        weapon: 'missile',
        origin: { x: k.body.position.x + i * 10, y: k.body.position.y + 50, z: k.body.position.z },
        direction: { x: 0, y: 0.5, z: -0.866 },
        targetId: 1,
      });
    k.heat = 64;
    const full = writeGouraiState(raid, 1);
    expect(full.length).toBe(base + 12 * 10);
    expect(full.length).toBeLessThanOrEqual(RAID_EXTRA_MAX_BYTES);
    expect(full.length * NET_CONFIG.rates.stateHz).toBeLessThan(4000);
    const m = new GouraiCoopMirror(() => 0);
    m.receiveState(full);
    const mk = m.raid.kaiju;
    expect(m.targetId).toBe(1);
    expect(mk.body.visible).toBe(true);
    expect(mk.body.position.x).toBeCloseTo(k.body.position.x, 1);
    expect(mk.body.heading).toBeCloseTo(k.body.heading, 4);
    expect(mk.action).toBe(k.action);
    expect(mk.heat).toBeCloseTo(64, 0);
    expect(mk.parts.ratio).toBeCloseTo(k.parts.ratio, 3);
    expect(mk.parts.isBroken(mk.parts.indexOf('gunL'))).toBe(true);
    expect(mk.turretsAlive).toBe(5);
    const missiles = mk.shots.shots.filter((s) => s.active && s.kind === 'missile');
    expect(missiles).toHaveLength(12);
    expect(missiles[3]?.position.x).toBeCloseTo(k.body.position.x + 30, 0);
    expect(missiles[3]?.targetId).toBe(1);
    expect(m.raid.timeLeft).toBeCloseTo(raid.timeLeft, 0);
    // 写しはダメージを受けない
    expect(m.raid.damageSphere(0, 1000)).toBe(false);
  });

  it('機銃の弾の知らせ: ホストの弾幕の弾を 1 発 4 バイトで、写しの砲台の位置から同じ向きへ撃つ', () => {
    const arena = arenaWith(1);
    const h = host(arena, 1);
    const f0 = arena.fighters.get(0);
    if (!f0) throw new Error('fighter');
    const m = new GouraiCoopMirror(() => 0);
    let notes = 0;
    for (let i = 0; i < 60 * 6; i++) {
      Object.assign(f0.aircraft.state.position, front(h, 800));
      h.step(1 / 60);
      const ev = h.takeEvents();
      if (ev) {
        notes += (ev.length - 1) / 4;
        m.receiveState(h.state());
        m.receiveEvents(ev);
      }
      m.step(1 / 60);
    }
    expect(notes).toBeGreaterThan(5);
    expect(h.raid.kaiju.fired.gun).toBeGreaterThanOrEqual(notes);
    const guns = m.raid.kaiju.shots.shots.filter((s) => s.active && s.kind === 'gun');
    expect(guns.length).toBeGreaterThan(0);
  });
});

describe('ゴウライの協力のホスト（10-4b）', () => {
  it('部位は攻撃した人の ID 付き（成績の列: 胴・核・砲台・排気口）。人数で体力が増える', () => {
    const h = host(arenaWith(2), 2);
    expect(h.raid.kaiju.parts.maxHp).toBeCloseTo(C.hp * gouraiCoopHpScale(2));
    h.parts.find((p) => p.id === 'hipL')?.damageBy(100, 1);
    h.parts.find((p) => p.id === 'exhaustR')?.damageBy(40, 0);
    h.parts.find((p) => p.id === 'hull')?.damageBy(30, 1);
    expect(h.fields(1).partDamage).toEqual([30, 0, 100, 0]);
    expect(h.fields(0).partDamage).toEqual([0, 0, 0, 40]);
  });

  it('弾幕はそれぞれ近い人を狙う（正面の 2 人とも当たりうる）・一斉発射のミサイルは攻撃を向けた人を追う', () => {
    const arena = arenaWith(2);
    const h = host(arena, 2);
    const k = h.raid.kaiju;
    const f0 = arena.fighters.get(0);
    const f1 = arena.fighters.get(1);
    if (!f0 || !f1) throw new Error('fighters');
    k.cooldown = 0.5;
    let volley = false;
    for (let i = 0; i < 60 * 12; i++) {
      Object.assign(f0.aircraft.state.position, front(h, 700, 80));
      const p1 = front(h, 1100, 120);
      Object.assign(f1.aircraft.state.position, { ...p1, x: p1.x + 60 });
      h.step(1 / 60);
      if (k.attack === 'volley' && k.action === 'active') volley = true;
    }
    expect(h.focusId).toBe(0);
    const aimed = new Set(k.shots.shots.filter((s) => s.active).map((s) => s.targetId));
    expect(aimed.has(0)).toBe(true);
    if (volley) {
      const missiles = k.shots.shots.filter((s) => s.active && s.kind === 'missile');
      for (const s of missiles) expect([0, 1]).toContain(s.targetId);
    }
  });

  it('体の当たり（10-4c）: ホストが参加者に最大 HP の約 8 割を配る（跳ねない・続けて当たらない間がある）', () => {
    const arena = arenaWith(1);
    const h = host(arena, 1);
    const f0 = arena.fighters.get(0);
    if (!f0) throw new Error('fighter');
    h.raid.kaiju.cooldown = 1e9;
    const hp = f0.hp;
    const b = h.raid.kaiju.body.position;
    const a = f0.aircraft;
    a.prevPosition.x = b.x + 150;
    a.prevPosition.y = b.y;
    a.prevPosition.z = b.z;
    Object.assign(a.state.position, { x: b.x + 20, y: b.y, z: b.z });
    h.step(1 / 60);
    expect(h.bodyHits).toBe(1);
    expect(hp - f0.hp).toBeCloseTo(f0.maxHp * 0.8, 0);
    // 跳ねない（体の外へ置き直さない）
    expect(Math.abs(a.state.position.x - b.x)).toBeLessThan(50);
    // 続けて当たらない
    h.step(1 / 60);
    expect(h.bodyHits).toBe(1);
  });

  it('終わり: 倒した → 成功・時間切れ → 失敗（全体の時間切れと同じ理由）', () => {
    const h = host(arenaWith(1), 1);
    expect(h.outcome).toBe(RAID_OUTCOME.none);
    h.raid.timeUp = true;
    expect(h.outcome).toBe(KAIJU2_OUTCOME.totalFail);
    const h2 = host(arenaWith(1), 1);
    h2.raid.damageSphere(0, 1e9, 0);
    expect(h2.outcome).toBe(RAID_OUTCOME.clear);
  });
});

describe('ゴウライの協力の対戦（インメモリの通信）', () => {
  it('2 人: 写しがホストに付いていく（位置 40m 以内・段階・砲台の数）・state は 4KB/s 以下', async () => {
    let checked = 0;
    let maxBytes = 0;
    const mirror = new GouraiCoopMirror(() => 0);
    let version = -1;
    const r = await runGouraiCoop({
      role: 'average',
      players: 2,
      seed: 1,
      maxSeconds: 60,
      onSecond: (m) => {
        const h = gouraiHostOf(m);
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
        expect(mirror.raid.kaiju.turretsAlive).toBe(h.raid.kaiju.turretsAlive);
        checked++;
      },
    });
    expect(r.outcome).toBe(0);
    expect(checked).toBeGreaterThan(50);
    expect(maxBytes * NET_CONFIG.rates.stateHz).toBeLessThan(4000);
  }, 120_000);
});
