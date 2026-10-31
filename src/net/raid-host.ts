// レイドのホスト側（6-2。最小限）: 怪獣（本体 + AI）をホストで動かし、部位を PvpArena の機銃・ミサイルの対象に入れる。
// 怪獣の攻撃の当たり・スタンは PvpArena に渡す（撃墜・スタンの event もそこから）。state に入れる怪獣の状態を作り、
// 倒した（成功）・最終フェーズの時間切れで街に到達（失敗）で終わりを知らせる。補間・演出の本格的な同期は 6-6。Three.js 非依存
import { KaijuAi } from '../ai/kaiju-ai';
import type { PvpArena } from '../combat/pvp-arena';
import { KAIJU_ATTACKS, RAID_CONFIG } from '../data/kaiju';
import type { GroundHeightFn } from '../entities/aircraft';
import { KAIJU_STAGES, Kaiju } from '../entities/kaiju';
import { ATTACK_STEPS } from '../entities/kaiju-pose';
import { NO_ATTACK, type KaijuStateMsg } from './protocol';

/** レイドの結果（over の event の b） */
export const RAID_OUTCOME = { none: 0, clear: 1, fail: 2 } as const;

export class RaidHost {
  readonly kaiju: Kaiju;
  readonly ai: KaijuAi;
  private readonly msg: KaijuStateMsg;

  constructor(
    private readonly arena: PvpArena,
    players: number,
    groundHeight: GroundHeightFn = () => 0,
  ) {
    this.kaiju = new Kaiju(groundHeight);
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
    this.kaiju.emerge(f.x, f.z, c.x, c.z, { players });
    this.ai.configure({ goal: c });
    arena.setKaijuParts(this.kaiju.parts);
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
      rocks: [],
    };
  }

  /** 固定ステップ 1 回分（全機を動かした後） */
  step(dt: number): void {
    this.ai.step(this.arena.all, dt);
  }

  /** 終わったか（成功 / 失敗。続いていれば none） */
  get outcome(): number {
    if (this.kaiju.isDestroyed) return RAID_OUTCOME.clear;
    if (this.kaiju.cityReached) return RAID_OUTCOME.fail;
    return RAID_OUTCOME.none;
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
    m.rocks = this.ai.rocks.filter((r) => r.active).map((r) => ({ ...r.position }));
    return m;
  }
}
