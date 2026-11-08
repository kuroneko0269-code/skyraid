// 10-4b: メカ怪獣ゴウライのソロのボットの型と、熟練の狙う対象の選び方（gourai-raid-bots.ts から分けた）
import type { CombatTarget } from '../src/combat/target';
import type { AssistPreset } from '../src/data/assist';
import type { RaidDifficulty } from '../src/data/raid';
import type { GouraiPartTarget } from '../src/entities/gourai/gourai-target';
import { inSweepBand } from '../src/ai/gourai-attacks';
import type { FlightSession } from '../src/missions/flight-session';
import type { GouraiDev } from '../src/missions/gourai-dev';
import type { ReplayData } from '../src/replay/types';
import { GOURAI_FOCUS } from './gourai-bot-parts';
import type { Kaiju2Role } from './kaiju2-bot-roles';

export interface GouraiBotOptions {
  readonly role: Kaiju2Role;
  readonly seed: number;
  readonly difficulty?: RaidDifficulty;
  readonly maxSeconds?: number;
  readonly record?: boolean;
  readonly preset?: AssistPreset;
  /** 予兆への反応を上書き（避ける確率・遅れ。「正しく避ければ当たらない」の確かめ） */
  readonly dodge?: { readonly chance: number; readonly react: number };
  /** 体を避けない（変える前の比べ） */
  readonly noHullAvoid?: boolean;
  /** 熟練が厚い正面から斜め後ろへ回り込む（比べ） */
  readonly flank?: boolean;
}

export interface GouraiBotResult {
  readonly status: string;
  readonly reason: string | null;
  readonly seconds: number;
  readonly playerDowns: number;
  readonly partsBroken: number;
  readonly turretsAlive: number;
  /** 大きな攻撃（予兆の回数）と、そのうち当たった攻撃・種類ごと */
  readonly attacks: number;
  readonly hitAttacks: number;
  readonly attackKinds: Readonly<Record<string, number>>;
  readonly hitKinds: Readonly<Record<string, number>>;
  readonly taken: Readonly<Record<string, number>>;
  readonly kaijuHp: number;
  readonly partHits: number;
  readonly hpLostAtClear: number | null;
  readonly damageRatio: number;
  /** 撃墜の内訳（弾幕の機銃 / 回転掃射 / ミサイル / 体。残りは墜落） */
  readonly downs: Readonly<Record<string, number>>;
  readonly bodyHits: number;
  readonly vents: number;
  readonly coreInVent: boolean;
  readonly decoyed: number;
  readonly meanSpeed: number;
  readonly medianDist: number;
  readonly fireShare: number;
  readonly modes: readonly number[];
  /** 回転掃射の攻撃の間に輪の中（射程の内）にいた割合 */
  readonly inBand: number;
  readonly data: ReplayData | null;
  readonly hash: string;
}

/** 狙う対象を選ぶ（熟練 focus: 放熱で開いた核 → 腰 → 肩 → ミサイル → 排気口 → 胴。ほかはロックした部位・初めは胴） */
export function focusPicker(
  s: FlightSession,
  focus: boolean,
  parts: readonly GouraiPartTarget[],
): () => CombatTarget {
  return (): CombatTarget => {
    if (focus) {
      const core = parts.find((x) => x.id === 'core' && x.active);
      if (core) return core;
      for (const id of GOURAI_FOCUS) {
        const t = parts.find((x) => x.id === id && x.active);
        if (t) return t;
      }
    }
    const sel = s.combat.targeting.selected;
    return sel?.active ? sel : ((parts[0] ?? parts[1]) as CombatTarget);
  };
}

const hitKey = (a: string): string => (a === 'volley' ? 'missile' : 'sweep');

/**
 * 手応えの数え（1 ステップごと）: 大きな攻撃（予兆の回数）と当たった攻撃・撃墜の内訳（0.5 秒以内の当たりの種類、無ければ墜落）・
 * 速さ・距離・撃っていた割合・回転掃射の間に輪の中にいた割合
 */
export class GouraiTally {
  attacks = 0;
  hitAttacks = 0;
  readonly attackKinds: Record<string, number> = {};
  readonly hitKinds: Record<string, number> = {};
  readonly downs: Record<string, number> = { gun: 0, sweep: 0, missile: 0, body: 0, crash: 0 };
  private counted = false;
  private kindAtStart = 0;
  private lastTaken: Record<string, number> = { gun: 0, sweep: 0, missile: 0, body: 0 };
  private lastSource = '';
  private sourceAge = 0;
  private lastDowns: number;
  private speedSum = 0;
  private fireSteps = 0;
  private aliveSteps = 0;
  private readonly dists: number[] = [];
  private sweepSteps = 0;
  private bandSteps = 0;

  constructor(
    s: FlightSession,
    private lastAction: string,
  ) {
    this.lastDowns = s.playerDowns;
  }

  step(s: FlightSession, dev: GouraiDev, trigger: boolean, steps: number, dt: number): void {
    const k = dev.kaiju;
    const me = s.aircraft.state.position;
    const b = k.body.position;
    const taken = dev.taken as Record<string, number>;
    if (s.player.active) {
      this.aliveSteps++;
      this.speedSum += s.aircraft.state.speed;
      if (trigger) this.fireSteps++;
      if (steps % 30 === 0) this.dists.push(Math.hypot(me.x - b.x, me.y - b.y, me.z - b.z));
    }
    for (const key of ['gun', 'sweep', 'missile', 'body']) {
      if ((taken[key] ?? 0) > (this.lastTaken[key] ?? 0)) {
        this.lastSource = key;
        this.sourceAge = 0;
      }
    }
    this.sourceAge += dt;
    this.lastTaken = { ...taken };
    if (s.playerDowns > this.lastDowns) {
      const key = this.sourceAge < 0.5 && this.lastSource !== '' ? this.lastSource : 'crash';
      this.downs[key] = (this.downs[key] ?? 0) + 1;
    }
    this.lastDowns = s.playerDowns;
    if (k.action === 'windup' && this.lastAction !== 'windup' && k.attack) {
      this.attacks++;
      this.attackKinds[k.attack] = (this.attackKinds[k.attack] ?? 0) + 1;
      this.kindAtStart = taken[hitKey(k.attack)] ?? 0;
      this.counted = false;
    } else if (
      !this.counted &&
      this.attacks > 0 &&
      k.lastAttack !== null &&
      (taken[hitKey(k.lastAttack)] ?? 0) > this.kindAtStart
    ) {
      this.counted = true;
      this.hitAttacks++;
      this.hitKinds[k.lastAttack] = (this.hitKinds[k.lastAttack] ?? 0) + 1;
    }
    if (k.attack === 'sweep' && k.action === 'active' && s.player.active) {
      this.sweepSteps++;
      if (inSweepBand(k, me) && Math.hypot(me.x - b.x, me.z - b.z) < 1300) this.bandSteps++;
    }
    this.lastAction = k.action;
  }

  result(): Pick<
    GouraiBotResult,
    | 'attacks'
    | 'hitAttacks'
    | 'attackKinds'
    | 'hitKinds'
    | 'downs'
    | 'meanSpeed'
    | 'medianDist'
    | 'fireShare'
    | 'inBand'
  > {
    const d = [...this.dists].sort((x, y) => x - y);
    return {
      attacks: this.attacks,
      hitAttacks: this.hitAttacks,
      attackKinds: this.attackKinds,
      hitKinds: this.hitKinds,
      downs: this.downs,
      meanSpeed: this.speedSum / Math.max(1, this.aliveSteps),
      medianDist: d[Math.floor(d.length / 2)] ?? 0,
      fireShare: this.fireSteps / Math.max(1, this.aliveSteps),
      inBand: this.bandSteps / Math.max(1, this.sweepSteps),
    };
  }
}
