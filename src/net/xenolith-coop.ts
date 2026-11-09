// 10-5b: 協力レイドの UFO ゼノリス（10-2 の差し込み口 net/raid-plugin.ts の 1 件。ゼノリスの遅延チャンクが登録する）。
// - ホスト: ソロと同じ XenolithRaid を動かし、部位を PvpArena の怪獣の部位に入れる（攻撃した人の ID 付き）。回る中心・光線・瞬間移動・
//   光の弾は「狙う人」1 人（いちばん近い人。4 秒ごとに選び直す。光線・瞬間移動・光の弾の予兆の途中では変えない）へ。光線と光の弾は
//   全員に当たる。体は通り抜けられない（10-4c の扱い: ホストが最大 HP の約 8 割のダメージを配る）。全体 HP は人数で増やす（xenolith-raid.ts の reset）
// - 写し: state（体・バリア・瞬間移動・光線・光の弾の予兆・部位）を受けて XenolithRaid（ダメージを受けない）に写し、間は同じ式で
//   進める（位置は速度で、時計は dt で）。光の弾はできごと（扇の番号と向き）で写しの口から撃つ（見た目だけ。当たりはホストが決める）
// - 通信: state 約 110 バイト（15Hz で 1.7KB/s）。光の弾は 1 発 4 バイト（1 回 5〜7 発）
// Three.js 非依存
import { RamGrace, ramDamage } from '../combat/kaiju-ram';
import type { PvpArena } from '../combat/pvp-arena';
import type { XenolithTarget } from '../ai/xenolith-ai';
import { orbMouth } from '../ai/xenolith-attacks';
import { createHullContact } from '../ai/albion-hull';
import { xenolithContact } from '../ai/xenolith-hull';
import type { ShotOrder } from '../ai/raid-kit/barrage';
import { XENOLITH_CONFIG as C, XENOLITH_PARTS } from '../data/xenolith';
import { XENOLITH_RAID_CONFIG as R } from '../data/xenolith-raid';
import { RAID_CONFIG } from '../data/kaiju';
import { findMap } from '../data/maps';
import {
  createXenolithTargets,
  type XenolithPartTarget,
} from '../entities/xenolith/xenolith-target';
import { raidSpawnPoint } from '../missions/xenolith-dev';
import { XENOLITH_ID } from '../missions/xenolith-mission';
import { XenolithRaid } from '../missions/xenolith-raid';
import { ByteWriter } from './codec';
import { readXenolithState, writeXenolithState } from './xenolith-codec';
import { KAIJU2_OUTCOME } from './kaiju2-host';
import { RAID_OUTCOME } from './raid-host';
import {
  bytesOf,
  readShots,
  readerOf,
  shotNote,
  writeShots,
  type ShotNote,
} from './raid-kit-codec';
import type {
  RaidPlugin,
  RaidPluginHost,
  RaidPluginHostContext,
  RaidPluginMirror,
  RaidPluginView,
} from './raid-plugin';
import type { ScoreEntry } from './protocol';

const at = (p: string): number => XENOLITH_PARTS.indexOf(p as never);

/** ホスト（判定の正） */
export class XenolithCoopHost implements RaidPluginHost {
  readonly raid: XenolithRaid;
  readonly parts: readonly XenolithPartTarget[];
  /** 狙う人（いなければ -1） */
  focusId = -1;
  private focusTimer = 0;
  private readonly nobody: XenolithTarget = { position: { x: 0, y: -1e6, z: 0 }, active: false };
  private readonly crowd: XenolithTarget[] = [];
  /** 人ごとの、体への衝突の後に続けて当たらない残り秒 */
  /** 10-4c: 体への衝突の「続けて当たらない」間（人ごと。共通の部品） */
  private readonly ram = new RamGrace();
  /** 体への衝突でダメージを受けた回数・当たりの種類ごとの数（全員の合計。調整の表） */
  bodyHits = 0;
  readonly taken: Record<string, number> = {};
  private readonly contact = createHullContact();
  /** 写しへ知らせる光の弾（次の takeEvents でまとめて送る） */
  private readonly notes: ShotNote[] = [];

  constructor(
    private readonly arena: PvpArena,
    ctx: RaidPluginHostContext,
  ) {
    const ground = ctx.kaijuGround ?? (() => 0);
    this.raid = new XenolithRaid(ground);
    this.parts = createXenolithTargets(this.raid);
    this.raid.reset(true, ctx.settings.hard ? 'hard' : 'normal', ctx.players);
    const map = findMap(RAID_CONFIG.mapId);
    const s = raidSpawnPoint(RAID_CONFIG.start, map.center);
    this.raid.spawn(s.x, s.y, s.z, s.heading, ctx.seed >>> 0, map.center);
    for (const p of this.parts) p.place(true);
    arena.setKaijuParts(this.parts);
    this.raid.kaiju.onOrb = (o: ShotOrder) => {
      this.notes.push(shotNote(o));
    };
  }

  step(dt: number): void {
    this.chooseFocus(dt);
    const crowd = this.crowd;
    crowd.length = 0;
    for (const f of this.arena.all)
      crowd.push({
        id: f.id,
        position: f.position,
        active: f.active,
        radius: f.hitRadius,
        velocity: f.velocity,
      });
    const target = crowd.find((c) => c.id === this.focusId) ?? this.nobody;
    this.raid.step(
      dt,
      target,
      (kind, damage, who) => {
        if (who.id === undefined) return;
        this.taken[kind] = (this.taken[kind] ?? 0) + 1;
        this.raid.count(kind);
        this.arena.kaijuDamage(who.id, damage);
      },
      crowd,
    );
    for (const p of this.parts) p.place(false, dt);
    this.collide(dt);
  }

  /** 体への衝突（ソロの XenolithDev と同じ 10-4c の共通の扱い）。ホストが参加者に最大 HP の約 8 割のダメージを配る（跳ねない） */
  private collide(dt: number): void {
    const k = this.raid.kaiju;
    const B = C.collision;
    this.ram.tick(dt);
    if (this.raid.dead || !k.body.visible) return;
    for (const f of this.arena.all) {
      if (!f.active) continue;
      const a = f.aircraft;
      if (
        !xenolithContact(
          k.body.prevPosition,
          k.body.position,
          a.prevPosition,
          a.state.position,
          B.margin,
          B.sampleStep,
          this.contact,
        )
      )
        continue;
      if (!this.ram.hit(f.id)) continue;
      this.bodyHits++;
      this.arena.kaijuDamage(f.id, ramDamage(f.maxHp), true);
    }
  }

  /** 狙う人を選び直す（光線・瞬間移動・光の弾の予兆の途中は変えない。狙っていた人が落ちた・抜けたらすぐ） */
  private chooseFocus(dt: number): void {
    const k = this.raid.kaiju;
    this.focusTimer -= dt;
    const current = this.focusId >= 0 ? this.arena.fighters.get(this.focusId) : undefined;
    const lost = !current?.active;
    const busy = k.beam.busy || k.warp.phase === 'telegraph' || k.orbPhase === 'warn';
    if (!lost && (busy || this.focusTimer > 0)) return;
    this.focusTimer = R.coop.focusSeconds;
    const b = k.body.position;
    let best = -1;
    let bestD = Infinity;
    for (const f of this.arena.all) {
      if (!f.active) continue;
      const d = Math.hypot(f.position.x - b.x, f.position.y - b.y, f.position.z - b.z);
      if (d < bestD) {
        bestD = d;
        best = f.id;
      }
    }
    if (best < 0) return;
    if (current?.active) {
      const p = current.position;
      if (Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z) <= bestD * R.coop.focusKeep) return;
    }
    this.focusId = best;
  }

  get outcome(): number {
    if (this.raid.dead) return RAID_OUTCOME.clear;
    if (this.raid.timeUp) return KAIJU2_OUTCOME.totalFail;
    return RAID_OUTCOME.none;
  }

  /** 攻撃の対象（光線の予兆・撃つ間だけ） */
  get targetId(): number | null {
    const beam = this.raid.kaiju.beam;
    return this.focusId >= 0 && beam.busy && beam.phase !== 'recover' ? this.focusId : null;
  }

  get remaining(): number {
    return this.raid.timeLeft;
  }

  /** 成績の部位の列: 胴・ドーム・砲口・発光体（4 つの合計）・発生器（3 つの合計） */
  fields(id: number): Pick<ScoreEntry, 'partDamage' | 'breaks'> {
    const s = this.raid.kaiju.parts.scoreOf(id);
    const d = s.partDamage;
    const sum = (...ps: string[]): number => ps.reduce((n, p) => n + (d[at(p)] ?? 0), 0);
    return {
      partDamage: [
        sum('hull'),
        sum('dome'),
        sum('cannon'),
        sum('emitter0', 'emitter1', 'emitter2', 'emitter3'),
        sum('gen0', 'gen1', 'gen2'),
      ],
      breaks: s.breaks,
    };
  }

  state(): Uint8Array {
    return writeXenolithState(this.raid, this.targetId);
  }

  takeEvents(): Uint8Array | null {
    if (this.notes.length === 0) return null;
    const w = new ByteWriter(8 + this.notes.length * 4);
    writeShots(w, this.notes.splice(0, 255));
    return bytesOf(w);
  }
}

const origin = { x: 0, y: 0, z: 0 };
const dir = { x: 0, y: 0, z: 0 };

/** 写し（クライアント）。届いた state を XenolithRaid に写し、間は同じ式で進める */
export class XenolithCoopMirror implements RaidPluginMirror {
  readonly raid: XenolithRaid;
  readonly parts: readonly XenolithPartTarget[];
  /** 攻撃の対象（なしは null） */
  targetId: number | null = null;

  constructor(ground: (x: number, z: number) => number) {
    this.raid = new XenolithRaid(ground, true);
    this.parts = createXenolithTargets(this.raid);
    this.raid.kaiju.body.visible = false;
  }

  receiveState(bytes: Uint8Array): void {
    readXenolithState(bytes, this.raid, this);
    if (this.raid.kaiju.body.warped) for (const p of this.parts) p.place(true);
  }

  /** 光の弾の知らせ: 写しの口から、知らされた向きへ撃つ（見た目だけ） */
  receiveEvents(bytes: Uint8Array): void {
    const k = this.raid.kaiju;
    if (!k.body.visible) return;
    orbMouth(origin, k);
    for (const n of readShots(readerOf(bytes))) {
      const yaw = (n.yawDeg * Math.PI) / 180;
      const pitch = (n.pitchDeg * Math.PI) / 180;
      dir.x = -Math.sin(yaw) * Math.cos(pitch);
      dir.y = Math.sin(pitch);
      dir.z = -Math.cos(yaw) * Math.cos(pitch);
      k.orbs.fire({ turret: n.turret, weapon: 'gun', origin, direction: dir, targetId: 0 });
    }
  }

  step(dt: number): void {
    const raid = this.raid;
    const k = raid.kaiju;
    const b = k.body;
    b.prevPosition.x = b.position.x;
    b.prevPosition.y = b.position.y;
    b.prevPosition.z = b.position.z;
    b.prevHeading = b.heading;
    b.prevSpin = b.spin;
    b.warped = false;
    if (!raid.dead) {
      b.position.x += b.velocity.x * dt;
      b.position.y += b.velocity.y * dt;
      b.position.z += b.velocity.z * dt;
      b.spin = (b.spin + C.move.spin * dt) % (Math.PI * 2);
      b.ringDeg = (b.ringDeg + C.move.ringDeg * dt) % 360;
      b.moveTime += dt;
      k.beam.time += k.beam.busy ? dt : 0;
      k.barrier.time += dt;
      if (k.warp.phase !== 'idle') k.warp.time += dt;
      if (k.orbPhase === 'warn') k.orbTime += dt;
      k.rippleAge += dt;
      if (!k.beam.busy) k.cooldown = Math.max(0, k.cooldown - dt);
    }
    // 光の弾は進めるだけ（当たりはホスト）
    k.orbs.step(
      dt,
      [],
      () => null,
      () => undefined,
    );
    raid.flash = Math.max(0, raid.flash - dt);
    for (const p of this.parts) p.place(false, dt);
  }
}

/** 差し込み口の 1 件 */
export function xenolithRaidPlugin(
  onView: (v: RaidPluginView | null) => void,
  briefing?: () => { readonly title: string; readonly lines: readonly string[] },
): RaidPlugin {
  return {
    kaiju: XENOLITH_ID,
    ...(briefing ? { briefing } : {}),
    createHost: (ctx) => new XenolithCoopHost(ctx.arena, ctx),
    createMirror: (ground) => new XenolithCoopMirror(ground),
    attachView: onView,
  };
}
