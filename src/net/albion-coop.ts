// 10-3b: 協力レイドの白鯨アルビオン（10-2 の差し込み口 net/raid-plugin.ts の 1 件。アルビオンの遅延チャンクが登録する）。
// - ホスト: ソロと同じ AlbionRaid を動かし、部位を PvpArena の怪獣の部位、子分を「ほかの対象」（防衛戦の敵と同じ口）に入れる
//   （攻撃した人の ID 付き）。潮吹き・尾は「攻撃を向ける人」1 人（いちばん近い人。2 秒ごとに選び直す）にだけ当たり、子分は
//   それぞれいちばん近い人を追って体当たりする。全体 HP と子分の上限は人数で増やす（albion-raid.ts の reset）
// - 写し: state（体の位置と周回路・攻撃の段・部位・子分）を受けて AlbionRaid（ダメージを受けない）に写し、間は同じ式で進める
// - 通信: 子分は飛んでいるものだけ、怪獣からの相対で 1 匹 10 バイト。上限 16 匹で state は 約 230 バイト（15Hz で 3.4KB/s）
// Three.js 非依存
import type { PvpArena } from '../combat/pvp-arena';
import type { AlbionTarget } from '../ai/albion-ai';
import { ALBION_PARTS } from '../data/albion';
import { ALBION_RAID_CONFIG as R } from '../data/albion-raid';
import { RAID_CONFIG } from '../data/kaiju';
import { findMap } from '../data/maps';
import { nearestOnRoute } from '../entities/albion/albion-route';
import {
  createAlbionTargets,
  type AlbionMinionTarget,
  type AlbionPartTarget,
} from '../entities/albion/albion-target';
import { ALBION_ID } from '../missions/albion-mission';
import { AlbionRaid } from '../missions/albion-raid';
import { bayRoute } from '../missions/albion-dev';
import { readAlbionState, writeAlbionState } from './albion-codec';
import { KAIJU2_OUTCOME } from './kaiju2-host';
import { RAID_OUTCOME } from './raid-host';
import type {
  RaidPlugin,
  RaidPluginHost,
  RaidPluginHostContext,
  RaidPluginMirror,
  RaidPluginView,
} from './raid-plugin';
import type { ScoreEntry } from './protocol';

/** 成績の部位の列（partDamage の順）: 胴・巣（3 つの合計）・背びれ・尾・頭・子分（子分へのダメージ） */
export const ALBION_SCORE_COLUMNS = ['body', 'nests', 'dorsal', 'tail', 'head', 'minions'] as const;

/** ホスト（判定の正） */
export class AlbionCoopHost implements RaidPluginHost {
  readonly raid: AlbionRaid;
  readonly parts: readonly AlbionPartTarget[];
  readonly minions: readonly AlbionMinionTarget[];
  /** 攻撃を向ける人（いなければ -1） */
  focusId = -1;
  private focusTimer = 0;
  private readonly nobody: AlbionTarget = { position: { x: 0, y: -1e6, z: 0 }, active: false };

  constructor(
    private readonly arena: PvpArena,
    ctx: RaidPluginHostContext,
  ) {
    const ground = ctx.kaijuGround ?? (() => 0);
    this.raid = new AlbionRaid(ground);
    const t = createAlbionTargets(this.raid);
    this.parts = t.parts;
    this.minions = t.minions;
    this.raid.reset(true, ctx.settings.hard ? 'hard' : 'normal', ctx.players);
    const center = findMap(RAID_CONFIG.mapId).center;
    const route = bayRoute(center);
    const st = RAID_CONFIG.start;
    this.raid.spawn(route, nearestOnRoute(route, st.x, st.z), ctx.seed >>> 0, center);
    for (const p of this.parts) p.place(true);
    arena.setKaijuParts(this.parts);
    arena.setExtraTargets(this.minions, (shooter, target, amount) => {
      const i = this.minions.findIndex((m) => m === target);
      if (i >= 0) this.raid.damageMinion(i, amount, shooter);
    });
  }

  step(dt: number): void {
    this.chooseFocus(dt);
    const focus = this.focusId >= 0 ? this.arena.fighters.get(this.focusId) : undefined;
    for (const m of this.minions) m.beginStep();
    this.raid.step(
      dt,
      focus ?? this.nobody,
      (_kind, damage, who) => {
        if (who.id !== undefined) this.arena.kaijuDamage(who.id, damage);
      },
      this.arena.all,
    );
    for (const p of this.parts) p.place();
  }

  /** 攻撃を向ける人を選び直す（攻撃の途中は変えない。狙っていた人が落ちた・抜けたらすぐ） */
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

  /** 攻撃の対象（予兆・攻撃の間だけ） */
  get targetId(): number | null {
    const a = this.raid.kaiju.action;
    return this.focusId >= 0 && (a === 'windup' || a === 'active') ? this.focusId : null;
  }

  get remaining(): number {
    return this.raid.timeLeft;
  }

  fields(id: number): Pick<ScoreEntry, 'partDamage' | 'breaks'> {
    const s = this.raid.kaiju.parts.scoreOf(id);
    const d = s.partDamage;
    const at = (p: string): number => d[ALBION_PARTS.indexOf(p as never)] ?? 0;
    return {
      partDamage: [
        at('body'),
        at('nestFront') + at('nestMid') + at('nestRear'),
        at('dorsal'),
        at('tail'),
        at('head'),
        Math.round(this.raid.minionDamageBy[id] ?? 0),
      ],
      breaks: s.breaks,
    };
  }

  state(): Uint8Array {
    return writeAlbionState(this.raid, this.targetId);
  }

  takeEvents(): Uint8Array | null {
    return null;
  }
}

/** 写し（クライアント）。届いた state を AlbionRaid に写し、間は同じ式で進める */
export class AlbionCoopMirror implements RaidPluginMirror {
  readonly raid: AlbionRaid;
  readonly parts: readonly AlbionPartTarget[];
  readonly minions: readonly AlbionMinionTarget[];
  /** 攻撃の対象（なしは null） */
  targetId: number | null = null;
  constructor(ground: (x: number, z: number) => number) {
    this.raid = new AlbionRaid(ground, true);
    const t = createAlbionTargets(this.raid);
    this.parts = t.parts;
    this.minions = t.minions;
    this.raid.kaiju.body.visible = false;
  }

  receiveState(bytes: Uint8Array): void {
    readAlbionState(bytes, this.raid, this);
  }

  receiveEvents(): void {
    // できごとは使わない（すべて state で配る）
  }

  step(dt: number): void {
    for (const m of this.minions) m.beginStep();
    const raid = this.raid;
    if (raid.dead) {
      const b = raid.kaiju.body;
      b.prevPosition.x = b.position.x;
      b.prevPosition.y = b.position.y;
      b.prevPosition.z = b.position.z;
      b.prevHeading = b.heading;
      b.prevBank = b.bank;
    } else raid.kaiju.stepMirror(dt);
    raid.flash = Math.max(0, raid.flash - dt);
    for (const p of this.parts) p.place();
  }
}

/** 差し込み口の 1 件 */
export function albionRaidPlugin(
  onView: (v: RaidPluginView | null) => void,
  briefing?: () => { readonly title: string; readonly lines: readonly string[] },
): RaidPlugin {
  return {
    kaiju: ALBION_ID,
    ...(briefing ? { briefing } : {}),
    createHost: (ctx) => new AlbionCoopHost(ctx.arena, ctx),
    createMirror: (ground) => new AlbionCoopMirror(ground),
    attachView: onView,
  };
}
