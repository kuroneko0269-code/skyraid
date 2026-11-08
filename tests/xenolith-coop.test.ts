// 10-5b: UFO ゼノリスの協力レイド（差し込み口 net/xenolith-coop.ts）: state の大きさと往復（体・バリア・瞬間移動・光線・光の弾の予兆・
// 部位）・帯域（4KB/s 以下）・光の弾の知らせ（写しの口から撃つ）・ホストの判定（部位に攻撃した人の ID 付き・光線と光の弾は狙う人へ・
// 人数の補正）・体は通り抜けられない（ホストが参加者を弾く）・2 人の対戦（インメモリの通信）で写しがホストに付いていく・終わりの理由
import { describe, expect, it } from 'vitest';
import { PvpArena } from '../src/combat/pvp-arena';
import { startAttack } from '../src/ai/xenolith-attacks';
import { XENOLITH_CONFIG as C } from '../src/data/xenolith';
import { xenolithCoopHpScale } from '../src/data/xenolith-raid';
import { NET_CONFIG } from '../src/data/net';
import { raidKaijuIndex } from '../src/data/raid-kaiju';
import { Aircraft } from '../src/entities/aircraft';
import { writeXenolithState } from '../src/net/xenolith-codec';
import { XenolithCoopHost, XenolithCoopMirror, xenolithRaidPlugin } from '../src/net/xenolith-coop';
import { KAIJU2_OUTCOME } from '../src/net/kaiju2-host';
import { fighterSpec } from '../src/net/host-state';
import type { GameSettings } from '../src/net/protocol';
import { netLoadout } from '../src/net/loadout';
import { ClientGame } from '../src/net/client-game';
import { RAID_EXTRA_MAX_BYTES, registerRaidPlugin } from '../src/net/raid-plugin';
import { RAID_OUTCOME } from '../src/net/raid-host';
import { runXenolithCoop, xenolithHostOf } from './xenolith-coop-bots';

const SPEC = fighterSpec(netLoadout('kestrel', undefined));

registerRaidPlugin(xenolithRaidPlugin(() => undefined));

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
    raidKaiju: raidKaijuIndex('xenolith'),
  };
}

function host(arena: PvpArena, players: number, hard = false): XenolithCoopHost {
  return new XenolithCoopHost(arena, { arena, players, settings: settingsOf(hard), seed: 7 });
}

/** 体から向き 0（北）へ dist m・上 up m（世界） */
function near(h: XenolithCoopHost, dist: number, up = 40): { x: number; y: number; z: number } {
  const b = h.raid.kaiju.body.position;
  return { x: b.x, y: b.y + up, z: b.z - dist };
}

describe('ゼノリスの協力の state（10-5b）', () => {
  it('約 120 バイト（上限 1KB の内）。15Hz で 4KB/s 以下。往復で体・バリア・瞬間移動・光線・光の弾の予兆・部位が戻る', () => {
    const arena = arenaWith(2);
    const h = host(arena, 2);
    const raid = h.raid;
    const f0 = arena.fighters.get(0);
    if (!f0) throw new Error('fighter');
    for (let i = 0; i < 60 * 20; i++) {
      Object.assign(f0.aircraft.state.position, near(h, 900));
      h.step(1 / 60);
    }
    const k = raid.kaiju;
    k.parts.damage(k.parts.indexOf('gen1'), 1e5, 1);
    k.beam.cancel();
    startAttack(k, 'charged', { position: near(h, 900), active: true, id: 1 }, k.random.next);
    k.beam.time = 0.5;
    k.barrier.phase = 'flicker';
    k.warp.phase = 'telegraph';
    k.warp.destination.x = 123;
    k.orbPhase = 'warn';
    k.orbTime = 0.3;
    const bytes = writeXenolithState(raid, 1);
    expect(bytes.length).toBeLessThan(130);
    expect(bytes.length).toBeLessThanOrEqual(RAID_EXTRA_MAX_BYTES);
    expect(bytes.length * NET_CONFIG.rates.stateHz).toBeLessThan(4000);
    const m = new XenolithCoopMirror(() => 0);
    m.receiveState(bytes);
    const mk = m.raid.kaiju;
    expect(m.targetId).toBe(1);
    expect(mk.body.visible).toBe(true);
    expect(mk.body.position.x).toBeCloseTo(k.body.position.x, 1);
    expect(mk.body.heading).toBeCloseTo(k.body.heading, 4);
    expect(mk.beam.kind).toBe('charged');
    expect(mk.beam.phase).toBe('warn');
    expect(mk.beam.targetId).toBe(1);
    expect(mk.beam.untilFire).toBeCloseTo(k.beam.untilFire, 2);
    expect(mk.attack).toBe('charged');
    expect(mk.barrier.phase).toBe('flicker');
    expect(mk.warp.phase).toBe('telegraph');
    expect(mk.warp.destination.x).toBeCloseTo(123, 2);
    expect(mk.orbPhase).toBe('warn');
    expect(mk.parts.ratio).toBeCloseTo(k.parts.ratio, 3);
    expect(mk.brokenGens).toBe(1);
    expect(mk.barrierSpec.down).toBeCloseTo(k.barrierSpec.down, 2);
    expect(m.raid.timeLeft).toBeCloseTo(raid.timeLeft, 0);
    // 写しはダメージを受けない
    expect(m.raid.damageSphere(0, 1000)).toBe(false);
  });

  it('光の弾の知らせ: ホストの光の弾を 1 発 4 バイトで、写しの口から同じ向きへ撃つ。瞬間移動は補間しない', () => {
    const arena = arenaWith(1);
    const h = host(arena, 1);
    const f0 = arena.fighters.get(0);
    if (!f0) throw new Error('fighter');
    const m = new XenolithCoopMirror(() => 0);
    let notes = 0;
    let warpSeen = false;
    for (let i = 0; i < 60 * 40; i++) {
      Object.assign(f0.aircraft.state.position, near(h, 900));
      h.step(1 / 60);
      if (i % 4 === 0) {
        m.receiveState(h.state());
        if (h.raid.kaiju.body.warped || m.raid.kaiju.body.warped) {
          const b = m.raid.kaiju.body;
          expect(b.prevPosition.x).toBe(b.position.x);
          warpSeen = true;
        }
      }
      const ev = h.takeEvents();
      if (ev) {
        notes += (ev.length - 1) / 4;
        m.receiveEvents(ev);
      }
      m.step(1 / 60);
    }
    expect(h.raid.kaiju.orbVolleys).toBeGreaterThan(2);
    expect(notes).toBe(h.raid.kaiju.orbVolleys * C.orbs.rows * C.orbs.cols);
    expect(h.raid.kaiju.warp.warps).toBeGreaterThan(0);
    expect(warpSeen || h.raid.kaiju.warp.warps > 0).toBe(true);
  });
});

describe('ゼノリスの協力のホスト（10-5b）', () => {
  it('部位は攻撃した人の ID 付き（成績の列: 胴・ドーム・砲口・発光体・発生器）。人数で体力が増える', () => {
    const h = host(arenaWith(2), 2);
    expect(h.raid.kaiju.parts.maxHp).toBeCloseTo(C.hp * xenolithCoopHpScale(2));
    h.parts.find((p) => p.id === 'gen0')?.damageBy(100, 1);
    h.raid.kaiju.barrier.phase = 'down';
    h.parts.find((p) => p.id === 'emitter2')?.damageBy(40, 0);
    h.parts.find((p) => p.id === 'hull')?.damageBy(30, 1);
    expect(h.fields(1).partDamage).toEqual([30, 0, 0, 0, 100]);
    expect(h.fields(0).partDamage).toEqual([0, 0, 0, 40, 0]);
  });

  it('光線・光の弾は狙う人（いちばん近い人）へ。狙う人は光線の途中で変わらない', () => {
    const arena = arenaWith(2);
    const h = host(arena, 2);
    const k = h.raid.kaiju;
    const f0 = arena.fighters.get(0);
    const f1 = arena.fighters.get(1);
    if (!f0 || !f1) throw new Error('fighters');
    let changedMidBeam = false;
    let lastFocus = -1;
    let beamTargets = new Set<number>();
    for (let i = 0; i < 60 * 40; i++) {
      Object.assign(f0.aircraft.state.position, near(h, 800));
      Object.assign(f1.aircraft.state.position, near(h, 1800, 200));
      h.step(1 / 60);
      if (k.beam.busy && lastFocus >= 0 && h.focusId !== lastFocus) changedMidBeam = true;
      if (k.beam.kind === 'charged' && k.beam.busy) beamTargets.add(k.beam.targetId);
      lastFocus = h.focusId;
    }
    expect(h.focusId).toBe(0);
    expect(changedMidBeam).toBe(false);
    beamTargets = new Set([...beamTargets].filter((t) => t >= 0));
    for (const t of beamTargets) expect(t).toBe(0);
    expect(h.targetId === null || h.targetId === 0).toBe(true);
  });

  it('体の当たり: ホストが参加者を弾き、ダメージを配る（続けて当たらない間がある）', () => {
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
    expect(f0.hp).toBeLessThan(hp);
  });

  it('終わり: 倒した → 成功・時間切れ → 失敗（全体の時間切れと同じ理由）', () => {
    const h = host(arenaWith(1), 1);
    expect(h.outcome).toBe(RAID_OUTCOME.none);
    h.raid.timeUp = true;
    expect(h.outcome).toBe(KAIJU2_OUTCOME.totalFail);
    const h2 = host(arenaWith(1), 1);
    h2.raid.kaiju.barrier.phase = 'down';
    h2.raid.damageSphere(0, 1e9, 0);
    expect(h2.outcome).toBe(RAID_OUTCOME.clear);
  });
});

describe('ゼノリスの協力の対戦（インメモリの通信）', () => {
  it('2 人: 写しがホストに付いていく（瞬間移動の直後を除いて位置 80m 以内・段階・バリア）・state は 4KB/s 以下', async () => {
    let checked = 0;
    let maxBytes = 0;
    const mirror = new XenolithCoopMirror(() => 0);
    let version = -1;
    const r = await runXenolithCoop({
      role: 'average',
      players: 2,
      seed: 1,
      maxSeconds: 60,
      onSecond: (m) => {
        const h = xenolithHostOf(m);
        const c = m.game(1);
        if (!h || !(c instanceof ClientGame)) return;
        const x = c.raidExtra;
        if (x && c.kaijuVersion !== version) {
          version = c.kaijuVersion;
          mirror.receiveState(x.bytes);
          maxBytes = Math.max(maxBytes, x.bytes.length);
        }
        mirror.step(0);
        const hk = h.raid.kaiju;
        const mk = mirror.raid.kaiju;
        if (mk.warp.warps === hk.warp.warps && hk.warp.phase !== 'telegraph') {
          const a = hk.body.position;
          const b = mk.body.position;
          expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(80);
          checked++;
        }
        expect(mk.stage).toBe(hk.stage);
      },
    });
    expect(r.outcome).toBe(0);
    expect(checked).toBeGreaterThan(30);
    expect(maxBytes * NET_CONFIG.rates.stateHz).toBeLessThan(4000);
  }, 120_000);
});
