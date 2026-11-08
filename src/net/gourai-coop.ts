// 10-4b: 協力レイドのメカ怪獣ゴウライ（10-2 の差し込み口 net/raid-plugin.ts の 1 件。ゴウライの遅延チャンクが登録する）。
// - ホスト: ソロと同じ GouraiRaid を動かし、部位を PvpArena の怪獣の部位に入れる（攻撃した人の ID 付き）。弾幕の砲台はそれぞれ
//   向きの範囲にいるいちばん近い人を見越して狙い、弾は全員に当たる。一斉発射・回転掃射は「攻撃を向ける人」1 人（いちばん近い人。
//   2 秒ごとに選び直す）へ。ミサイルは全員のフレアに乗り換える。体は通り抜けられない（ホストが参加者の機体を弾く）。
//   全体 HP は人数で増やす（gourai-raid.ts の reset）
// - 写し: state（体・段・熱・部位・ミサイル）を受けて GouraiRaid（ダメージを受けない）に写し、間は同じ式で進める。機銃の弾は
//   できごと（砲台と向き）で写しの砲台から撃ち、回転掃射の弾は写しが同じ式で撃つ（どちらも見た目だけ。当たりはホストが決める）
// - 通信: state はミサイルなしで約 90 バイト・1 発 10 バイト（15Hz で 1.4〜3KB/s）。機銃の弾は 1 発 4 バイトを 3 ステップごとにまとめる
// Three.js 非依存
import type { PvpArena } from '../combat/pvp-arena';
import type { GouraiTarget } from '../ai/gourai-ai';
import { fireSweep } from '../ai/gourai-attacks';
import { stepGouraiPose } from '../ai/gourai-step';
import { createHullContact } from '../ai/albion-hull';
import { gouraiContact } from '../ai/gourai-hull';
import type { ShotOrder } from '../ai/raid-kit/barrage';
import { bodyPoint } from '../ai/raid-kit/frame';
import { GOURAI_CONFIG as C, GOURAI_PARTS, GOURAI_TURRETS } from '../data/gourai';
import { GOURAI_RAID_CONFIG as R } from '../data/gourai-raid';
import { RAID_CONFIG } from '../data/kaiju';
import { findMap } from '../data/maps';
import { RamGrace, ramDamage } from '../combat/kaiju-ram';
import { createGouraiTargets, type GouraiPartTarget } from '../entities/gourai/gourai-target';
import { bayPatrol, spawnOnPatrol } from '../missions/gourai-dev';
import { GOURAI_ID } from '../missions/gourai-mission';
import { GouraiRaid } from '../missions/gourai-raid';
import { ByteWriter } from './codec';
import { readGouraiState, writeGouraiState } from './gourai-codec';
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

const at = (p: string): number => GOURAI_PARTS.indexOf(p as never);

/** ホスト（判定の正） */
export class GouraiCoopHost implements RaidPluginHost {
  readonly raid: GouraiRaid;
  readonly parts: readonly GouraiPartTarget[];
  /** 大きな攻撃を向ける人（いなければ -1） */
  focusId = -1;
  private focusTimer = 0;
  private readonly nobody: GouraiTarget = { position: { x: 0, y: -1e6, z: 0 }, active: false };
  private readonly crowd: GouraiTarget[] = [];
  /** 人ごとの、体への衝突の後に続けて当たらない残り秒 */
  /** 10-4c: 体への衝突の「続けて当たらない」間（人ごと。共通の部品） */
  private readonly ram = new RamGrace();
  /** 体への衝突でダメージを受けた回数・弾の種類ごとの当たり（全員の合計。調整の表） */
  bodyHits = 0;
  readonly taken: Record<string, number> = {};
  private readonly contact = createHullContact();
  /** 写しへ知らせる機銃の弾（まとめて送る） */
  private readonly notes: ShotNote[] = [];
  private eventSteps = 0;

  constructor(
    private readonly arena: PvpArena,
    ctx: RaidPluginHostContext,
  ) {
    const ground = ctx.kaijuGround ?? (() => 0);
    this.raid = new GouraiRaid(ground);
    this.parts = createGouraiTargets(this.raid);
    this.raid.reset(true, ctx.settings.hard ? 'hard' : 'normal', ctx.players);
    const center = findMap(RAID_CONFIG.mapId).center;
    const patrol = bayPatrol(center);
    const st = RAID_CONFIG.start;
    const s = spawnOnPatrol(patrol, { x: st.x, y: st.y, z: st.z });
    this.raid.spawn(patrol, s.x, s.z, s.heading, ctx.seed >>> 0, center);
    for (const p of this.parts) p.place(true);
    arena.setKaijuParts(this.parts);
    this.raid.kaiju.onShot = (o: ShotOrder) => {
      if (o.weapon === 'gun') this.notes.push(shotNote(o));
    };
  }

  step(dt: number): void {
    this.chooseFocus(dt);
    const focus = this.focusId >= 0 ? this.arena.fighters.get(this.focusId) : undefined;
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
    const target = focus ? (crowd.find((c) => c.id === focus.id) ?? this.nobody) : this.nobody;
    this.raid.step(
      dt,
      target,
      this.arena.flares.flares,
      (kind, damage, who, sweep) => {
        if (who.id === undefined) return;
        const key = kind === 'missile' ? 'missile' : sweep ? 'sweep' : 'gun';
        this.taken[key] = (this.taken[key] ?? 0) + 1;
        this.arena.kaijuDamage(who.id, damage);
      },
      crowd,
    );
    this.collide(dt);
    for (const p of this.parts) p.place();
    this.eventSteps++;
  }

  /** 10-4c: 体への衝突（ソロの GouraiDev と同じ共通の扱い）。ホストが参加者に最大 HP の約 8 割のダメージを配る（跳ねない） */
  private collide(dt: number): void {
    const k = this.raid.kaiju;
    const B = C.collision;
    this.ram.tick(dt);
    if (this.raid.dead || !k.body.visible) return;
    for (const f of this.arena.all) {
      if (!f.active) continue;
      const a = f.aircraft;
      if (
        !gouraiContact(
          k.body,
          k.phase === 1,
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
      this.arena.kaijuDamage(f.id, ramDamage(f.maxHp));
    }
  }

  /** 大きな攻撃を向ける人を選び直す（攻撃の途中は変えない。狙っていた人が落ちた・抜けたらすぐ） */
  private chooseFocus(dt: number): void {
    const k = this.raid.kaiju;
    this.focusTimer -= dt;
    const current = this.focusId >= 0 ? this.arena.fighters.get(this.focusId) : undefined;
    const lost = !current?.active;
    if (!lost && (k.action !== 'idle' || this.focusTimer > 0)) return;
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

  /** 大きな攻撃の対象（予兆・攻撃の間だけ） */
  get targetId(): number | null {
    const a = this.raid.kaiju.action;
    return this.focusId >= 0 && (a === 'windup' || a === 'active') ? this.focusId : null;
  }

  get remaining(): number {
    return this.raid.timeLeft;
  }

  /** 成績の部位の列: 胴（前の装甲も）・核・砲台（6 つの合計）・排気口（2 つの合計） */
  fields(id: number): Pick<ScoreEntry, 'partDamage' | 'breaks'> {
    const s = this.raid.kaiju.parts.scoreOf(id);
    const d = s.partDamage;
    const sum = (...ps: string[]): number => ps.reduce((n, p) => n + (d[at(p)] ?? 0), 0);
    return {
      partDamage: [
        sum('hull', 'armor'),
        sum('core'),
        sum('gunL', 'gunR', 'podL', 'podR', 'hipL', 'hipR'),
        sum('exhaustL', 'exhaustR'),
      ],
      breaks: s.breaks,
    };
  }

  state(): Uint8Array {
    return writeGouraiState(this.raid, this.targetId);
  }

  takeEvents(): Uint8Array | null {
    if (this.notes.length === 0 || this.eventSteps < R.coop.eventSteps) return null;
    this.eventSteps = 0;
    const w = new ByteWriter(8 + this.notes.length * 4);
    writeShots(w, this.notes.splice(0, 255));
    return bytesOf(w);
  }
}

const origin = { x: 0, y: 0, z: 0 };
const dir = { x: 0, y: 0, z: 0 };

/** 写し（クライアント）。届いた state を GouraiRaid に写し、間は同じ式で進める */
export class GouraiCoopMirror implements RaidPluginMirror {
  readonly raid: GouraiRaid;
  readonly parts: readonly GouraiPartTarget[];
  /** 大きな攻撃の対象（なしは null） */
  targetId: number | null = null;
  private sweepGap = 0;

  constructor(ground: (x: number, z: number) => number) {
    this.raid = new GouraiRaid(ground, true);
    this.parts = createGouraiTargets(this.raid);
    this.raid.kaiju.body.visible = false;
  }

  receiveState(bytes: Uint8Array): void {
    readGouraiState(bytes, this.raid, this);
  }

  /** 機銃の弾の知らせ: 写しの砲台の位置から、知らされた向きへ撃つ（見た目だけ） */
  receiveEvents(bytes: Uint8Array): void {
    const k = this.raid.kaiju;
    for (const n of readShots(readerOf(bytes))) {
      const t = GOURAI_TURRETS[n.turret];
      if (!t || !k.body.visible) continue;
      bodyPoint(origin, k.body, t.offset);
      const yaw = (n.yawDeg * Math.PI) / 180;
      const pitch = (n.pitchDeg * Math.PI) / 180;
      dir.x = -Math.sin(yaw) * Math.cos(pitch);
      dir.y = Math.sin(pitch);
      dir.z = -Math.cos(yaw) * Math.cos(pitch);
      k.shots.fire({ turret: n.turret, weapon: 'gun', origin, direction: dir, targetId: 0 });
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
    if (!raid.dead) {
      b.position.x += b.velocity.x * dt;
      b.position.z += b.velocity.z * dt;
      k.actionTime += dt;
      // 回転掃射は写しが同じ式で撃つ（向きは届いた値から進める）
      if (k.attack === 'sweep' && k.action === 'active') {
        const s = C.attacks.sweep;
        k.sweepAngle += s.spinDeg * dt;
        this.sweepGap -= dt;
        while (this.sweepGap <= 0) {
          this.sweepGap += s.gap;
          fireSweep(k, k.sweepAngle, k.random.next, k.shots.fire);
        }
      }
      stepGouraiPose(k, dt);
    }
    // 弾は進めるだけ（当たりはホスト）
    k.shots.step(
      dt,
      [],
      () => null,
      () => undefined,
    );
    raid.flash = Math.max(0, raid.flash - dt);
    for (const p of this.parts) p.place();
  }
}

/** 差し込み口の 1 件 */
export function gouraiRaidPlugin(
  onView: (v: RaidPluginView | null) => void,
  briefing?: () => { readonly title: string; readonly lines: readonly string[] },
): RaidPlugin {
  return {
    kaiju: GOURAI_ID,
    ...(briefing ? { briefing } : {}),
    createHost: (ctx) => new GouraiCoopHost(ctx.arena, ctx),
    createMirror: (ground) => new GouraiCoopMirror(ground),
    attachView: onView,
  };
}
