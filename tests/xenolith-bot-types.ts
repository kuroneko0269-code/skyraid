// 10-5b: UFO ゼノリスのソロのボットの型と手応えの数え（xenolith-raid-bots.ts から分けた）
import type { AssistPreset } from '../src/data/assist';
import type { RaidDifficulty } from '../src/data/raid';
import type { FlightSession } from '../src/missions/flight-session';
import type { XenolithDev } from '../src/missions/xenolith-dev';
import type { ReplayData } from '../src/replay/types';
import type { Kaiju2Role } from './kaiju2-bot-roles';

export interface XenolithBotOptions {
  readonly role: Kaiju2Role;
  readonly seed: number;
  readonly difficulty?: RaidDifficulty;
  readonly maxSeconds?: number;
  readonly record?: boolean;
  readonly preset?: AssistPreset;
  /** 予兆への反応を上書き（避ける確率・遅れ。「正しく避ければ当たらない」の確かめ） */
  readonly dodge?: { readonly chance: number; readonly react: number };
  /** 体を避けない（比べ） */
  readonly noHullAvoid?: boolean;
  /** 光の弾を出さない（10-5b で足す前の比べ） */
  readonly noOrbs?: boolean;
}

export interface XenolithBotResult {
  readonly status: string;
  readonly reason: string | null;
  readonly seconds: number;
  readonly playerDowns: number;
  readonly partsBroken: number;
  /** 人を狙う攻撃（光線・光の弾）の回数と、そのうち当たった回数・種類ごと */
  readonly attacks: number;
  readonly hitAttacks: number;
  readonly attackKinds: Readonly<Record<string, number>>;
  readonly hitKinds: Readonly<Record<string, number>>;
  readonly taken: Readonly<Record<string, number>>;
  readonly kaijuHp: number;
  readonly hpLostAtClear: number | null;
  readonly damageRatio: number;
  /** 撃墜の内訳（なぎ払い / 溜め撃ち / 光の弾 / 体。残りは墜落） */
  readonly downs: Readonly<Record<string, number>>;
  readonly bodyHits: number;
  readonly gensBroken: number;
  readonly emittersBroken: number;
  readonly warps: number;
  readonly orbVolleys: number;
  readonly beams: number;
  readonly fireShare: number;
  readonly medianDist: number;
  /** 狙われていない時間（光線・光の弾・瞬間移動の予兆と、飛んでいる光の弾が無い）の割合と、続いた長さの中央値・最長（秒） */
  readonly calmShare: number;
  readonly calmMedian: number;
  readonly calmMax: number;
  readonly modes: readonly number[];
  readonly data: ReplayData | null;
  readonly hash: string;
}

const KINDS = ['sweep', 'charged', 'orbs', 'body'] as const;

/** 手応えの数え（1 ステップごと） */
export class XenolithTally {
  attacks = 0;
  hitAttacks = 0;
  readonly attackKinds: Record<string, number> = {};
  readonly hitKinds: Record<string, number> = {};
  readonly downs: Record<string, number> = { sweep: 0, charged: 0, orbs: 0, body: 0, crash: 0 };
  private lastBeams = 0;
  private lastVolleys = 0;
  /** 今の光線・光の弾の種類と、始めたときの当たりの数（同じ種類の次が始まるまでに増えたら当たった） */
  private open: { kind: string; at: number; counted: boolean }[] = [];
  private lastTaken: Record<string, number> = { sweep: 0, charged: 0, orbs: 0, body: 0 };
  private lastSource = '';
  private sourceAge = 0;
  private lastDowns: number;
  private fireSteps = 0;
  private aliveSteps = 0;
  private readonly dists: number[] = [];
  private calmSteps = 0;
  private steps = 0;
  private calmRun = 0;
  private readonly calmRuns: number[] = [];

  constructor(s: FlightSession) {
    this.lastDowns = s.playerDowns;
  }

  step(s: FlightSession, dev: XenolithDev, trigger: boolean, steps: number, dt: number): void {
    const k = dev.kaiju;
    const me = s.aircraft.state.position;
    const b = k.body.position;
    const taken = dev.taken as Record<string, number>;
    this.steps++;
    if (s.player.active) {
      this.aliveSteps++;
      if (trigger) this.fireSteps++;
      if (steps % 30 === 0) this.dists.push(Math.hypot(me.x - b.x, me.y - b.y, me.z - b.z));
    }
    for (const key of KINDS) {
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
    // 新しい攻撃
    const beams = k.attacksUsed.sweep + k.attacksUsed.charged;
    if (beams > this.lastBeams && k.attack) this.begin(k.attack, taken);
    this.lastBeams = beams;
    if (k.orbVolleys > this.lastVolleys) this.begin('orbs', taken);
    this.lastVolleys = k.orbVolleys;
    for (const a of this.open) {
      if (a.counted || (taken[a.kind] ?? 0) <= a.at) continue;
      a.counted = true;
      this.hitAttacks++;
      this.hitKinds[a.kind] = (this.hitKinds[a.kind] ?? 0) + 1;
    }
    // 狙われていない時間
    const beam = k.beam;
    const threat =
      (beam.busy && beam.phase !== 'recover') ||
      k.orbPhase === 'warn' ||
      k.orbs.activeCount > 0 ||
      k.warp.phase === 'telegraph';
    if (!threat && k.body.visible && !dev.raid.dead) {
      this.calmSteps++;
      this.calmRun++;
    } else if (this.calmRun > 0) {
      this.calmRuns.push(this.calmRun * dt);
      this.calmRun = 0;
    }
  }

  private begin(kind: string, taken: Record<string, number>): void {
    this.attacks++;
    this.attackKinds[kind] = (this.attackKinds[kind] ?? 0) + 1;
    // 同じ種類の前の攻撃は閉じる（光線どうしは種類を分けずに 1 つずつ）
    this.open = this.open.filter((a) => a.kind !== kind);
    this.open.push({ kind, at: taken[kind] ?? 0, counted: false });
  }

  result(): Pick<
    XenolithBotResult,
    | 'attacks'
    | 'hitAttacks'
    | 'attackKinds'
    | 'hitKinds'
    | 'downs'
    | 'fireShare'
    | 'medianDist'
    | 'calmShare'
    | 'calmMedian'
    | 'calmMax'
  > {
    const d = [...this.dists].sort((x, y) => x - y);
    const c = [...this.calmRuns].sort((x, y) => x - y);
    return {
      attacks: this.attacks,
      hitAttacks: this.hitAttacks,
      attackKinds: this.attackKinds,
      hitKinds: this.hitKinds,
      downs: this.downs,
      fireShare: this.fireSteps / Math.max(1, this.aliveSteps),
      medianDist: d[Math.floor(d.length / 2)] ?? 0,
      calmShare: this.calmSteps / Math.max(1, this.steps),
      calmMedian: c[Math.floor(c.length / 2)] ?? 0,
      calmMax: c[c.length - 1] ?? 0,
    };
  }
}
