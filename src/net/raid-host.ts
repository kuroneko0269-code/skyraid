// レイドのホスト側（6-2）: 怪獣（本体 + AI）をホストで動かし、部位を PvpArena の機銃・ミサイルの対象に入れる。
// 怪獣の攻撃の当たり・スタンは PvpArena に渡す（撃墜・スタンの event もそこから）。state に入れる怪獣の状態を作り、
// 倒した（成功）・最終フェーズの時間切れで街に到達（失敗）で終わりを知らせる。
// 6-6: 街の建物を壊すのはホストだけ（壊れた建物の番号を溜めて host-game.ts が ruin で配る）。岩の投擲・落下とブレイク
// （貢献者）は event、攻撃の対象は state。高難度。与ダメージは本体の stats。Three.js 非依存
import { KaijuAi } from '../ai/kaiju-ai';
import type { BuildingField } from '../combat/buildings';
import { applyKaijuToCity } from '../combat/city-damage';
import type { PvpArena } from '../combat/pvp-arena';
import { KAIJU_ATTACKS, KAIJU_PARTS, RAID_CONFIG } from '../data/kaiju';
import type { GroundHeightFn } from '../entities/aircraft';
import { KAIJU_STAGES, Kaiju } from '../entities/kaiju';
import { ATTACK_STEPS } from '../entities/kaiju-pose';
import {
  NO_ATTACK,
  NO_TARGET,
  eventMsg,
  packRockVelocity,
  type EventMsg,
  type KaijuStateMsg,
} from './protocol';

/** レイドの結果（over の event の b） */
export const RAID_OUTCOME = { none: 0, clear: 1, fail: 2 } as const;

export interface RaidHostOptions {
  readonly groundHeight?: GroundHeightFn;
  /** 高難度（6-6） */
  readonly hard?: boolean;
  /** 街の建物（6-6。ホストだけが壊す。null は街なし） */
  readonly buildings?: BuildingField | null;
  /** 岩・ブレイクの event を全員へ（tick は呼び出し側が入れる） */
  readonly emit?: (e: EventMsg) => void;
}

export class RaidHost {
  readonly kaiju: Kaiju;
  readonly ai: KaijuAi;
  /** 壊れた建物のうち、まだ配っていない番号（host-game.ts が ruin で送って空にする） */
  readonly ruins: number[] = [];
  private readonly msg: KaijuStateMsg;
  private readonly buildings: BuildingField | null;
  private readonly emit: (e: EventMsg) => void;

  constructor(
    private readonly arena: PvpArena,
    players: number,
    o: RaidHostOptions = {},
  ) {
    this.kaiju = new Kaiju(o.groundHeight ?? (() => 0));
    this.buildings = o.buildings ?? null;
    this.emit = o.emit ?? (() => undefined);
    this.ai = new KaijuAi(this.kaiju, {
      damage: (id, amount) => {
        arena.kaijuDamage(id, amount);
      },
      stun: (id, seconds) => {
        arena.stun(id, seconds);
      },
    });
    const f = RAID_CONFIG.kaijuFrom;
    const c = RAID_CONFIG.cityCenter;
    this.kaiju.emerge(f.x, f.z, c.x, c.z, { players, hard: o.hard ?? false });
    this.ai.configure({ goal: c, stopRadius: RAID_CONFIG.reachRadius, arrivalFails: true });
    arena.setKaijuParts(this.kaiju.parts);
    this.buildings?.onCollapse((e) => {
      this.ruins.push(e.index);
    });
    this.kaiju.onEvent((e) => {
      if (e.kind !== 'break') return;
      const mask = e.by.reduce((m, id) => m | (1 << (id & 7)), 0);
      this.emit(eventMsg('break', KAIJU_PARTS.indexOf(e.part), mask, 0));
    });
    this.ai.onEvent((e) => {
      if (e.kind === 'rockImpact') this.emit(eventMsg('rock', 0, 1, 0, 0, e.x, e.y, e.z));
    });
    this.msg = {
      stage: 0,
      feet: { x: 0, y: 0, z: 0 },
      heading: 0,
      attack: NO_ATTACK,
      attackStep: 0,
      attackTime: 0,
      attackDuration: 0,
      downTimer: 0,
      walkPhase: 0,
      hp: 0,
      maxHp: 1,
      phase: 1,
      finalRemaining: null,
      parts: this.kaiju.parts.map(() => ({ hpRatio: 1, breakTimer: 0 })),
      beam: null,
      targetId: NO_TARGET,
    };
  }

  /** 固定ステップ 1 回分（全機を動かした後）。怪獣が街を壊す（ホストだけ） */
  step(dt: number): void {
    this.ai.step(this.arena.all, dt);
    // このステップで投げた岩（岩はステップの初めに動くので、投げたばかりは age 0）
    this.ai.rocks.forEach((r, i) => {
      if (!r.active || r.age > 0) return;
      const p = r.position;
      this.emit(eventMsg('rock', i, 0, 0, packRockVelocity(r.velocity), p.x, p.y, p.z));
    });
    if (this.buildings) applyKaijuToCity(this.buildings, this.kaiju, this.ai);
  }

  /** 終わったか（成功 / 失敗。続いていれば none） */
  get outcome(): number {
    if (this.kaiju.isDestroyed) return RAID_OUTCOME.clear;
    if (this.kaiju.cityReached) return RAID_OUTCOME.fail;
    return RAID_OUTCOME.none;
  }

  /** 攻撃の対象（攻撃中だけ。なしは null） */
  get targetId(): number | null {
    return this.kaiju.attack ? this.ai.targetId : null;
  }

  /** state に入れる怪獣の状態（入れ物は使い回す） */
  state(): KaijuStateMsg {
    const k = this.kaiju;
    const m = this.msg;
    m.stage = KAIJU_STAGES.indexOf(k.stage);
    m.feet.x = k.feet.x;
    m.feet.y = k.feet.y;
    m.feet.z = k.feet.z;
    m.heading = k.heading;
    m.attack = k.attack ? KAIJU_ATTACKS.indexOf(k.attack) : NO_ATTACK;
    m.attackStep = ATTACK_STEPS.indexOf(k.attackStep);
    m.attackTime = k.attackTime;
    m.attackDuration = k.attackDuration;
    m.downTimer = k.downTimer;
    m.walkPhase = k.walkPhase;
    m.hp = k.hp;
    m.maxHp = k.maxHp;
    m.phase = k.phase;
    m.finalRemaining = k.finalRemaining;
    k.parts.forEach((p, i) => {
      const s = m.parts[i];
      if (!s) return;
      s.hpRatio = p.partHp / p.partMaxHp;
      s.breakTimer = p.breakTimer;
    });
    const b = this.ai.beam;
    m.beam = b.on ? { x: b.direction.x, y: b.direction.y, z: b.direction.z } : null;
    m.targetId = this.targetId ?? NO_TARGET;
    return m;
  }
}
