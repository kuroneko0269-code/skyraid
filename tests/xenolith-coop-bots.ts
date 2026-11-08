// 10-5b: UFO ゼノリスの協力レイドの調整のボット（ゴウライの gourai-coop-bots.ts と同じ形）。インメモリの通信（pvp-match.ts）で
// 本物のホスト（HostGame + 差し込み口の XenolithCoopHost）とクライアント（ClientGame + 写し）を動かし、各プレイヤーを敵機と同じ AI に
// 役の腕前を渡して操縦させる。狙うもの: 役（auto = 熟練はバリアが外れていればドーム・張っていれば発生器、ほかは胴 / gens = 張っている間は
// 発生器 / body = 胴だけ）。予兆への反応: なぎ払い・溜め撃ち・光の弾は狙われているとき（狙う人 focusId）。体へ入りそうなら上か下へ
// 役割が生まれるか: 人ごとの「発生器へのダメージ ÷ 与えたダメージ」の差（成績の partDamage の 5 列目が発生器）
import { EnemyFighterAI, createCommand, type AiSelf, type AiSenses } from '../src/ai/enemy-fighter';
import { KAIJU_ID_BASE } from '../src/combat/pvp-arena';
import { createRandom } from '../src/core/random';
import { STARTER_AIRCRAFT } from '../src/data/aircraft';
import { XENOLITH_RAID_CONFIG } from '../src/data/xenolith-raid';
import { RAID_CONFIG } from '../src/data/kaiju';
import type { RaidDifficulty } from '../src/data/raid';
import { raidKaijuIndex } from '../src/data/raid-kaiju';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import { GUN_CONFIG } from '../src/data/weapons';
import type { XenolithPartTarget } from '../src/entities/xenolith/xenolith-target';
import { LOCAL_FORWARD } from '../src/flight/flight-model';
import { rotateVec3, vec3 } from '../src/flight/math';
import { XenolithCoopHost, xenolithRaidPlugin } from '../src/net/xenolith-coop';
import { registerRaidPlugin } from '../src/net/raid-plugin';
import { RAID_OUTCOME } from '../src/net/raid-host';
import { createHeightField } from '../src/render/terrain-height';
import { gunOnBody } from './albion-bot-types';
import {
  XENOLITH_HULL_LOOKAHEAD,
  breakPoint,
  pullPoint,
  sweepDodgePoint,
  sweepThreat,
  xenolithHullAvoid,
} from './xenolith-bot-parts';
import { KAIJU2_ROLES, type Kaiju2Role, type RoleSpec } from './kaiju2-bot-roles';
import { pursue } from './pvp-bots';
import { startMatch, type Match } from './pvp-match';

const harbor = createHeightField(HARBOR_TERRAIN).getGroundHeight;

registerRaidPlugin(xenolithRaidPlugin(() => undefined));

const GENS = ['gen0', 'gen1', 'gen2'] as const;

export type XenolithJob = 'auto' | 'gens' | 'body';

export interface XenolithCoopOptions {
  readonly role: Kaiju2Role;
  readonly players: number;
  readonly seed: number;
  readonly difficulty?: RaidDifficulty;
  readonly maxSeconds?: number;
  readonly onSecond?: (m: Match) => void;
  /** false なら残機を外す（時間・撃墜の比べ） */
  readonly lives?: boolean;
  /** 役の割り当て（人ごと。省略は全員 'auto'）: auto = 熟練は部位を選ぶ・ほかは胴 / gens = 張っている間は発生器 / body = 胴だけ */
  readonly jobs?: readonly XenolithJob[];
}

export interface XenolithCoopResult {
  readonly cleared: boolean;
  readonly outcome: number;
  readonly seconds: number;
  readonly downs: number;
  /** 人ごとの発生器へのダメージの割合（0〜1） */
  readonly genShare: readonly number[];
  readonly gensBroken: number;
  readonly bodyHits: number;
  readonly taken: Readonly<Record<string, number>>;
  readonly match: Match;
}

/** ホストのゼノリス（差し込み口の本体） */
export function xenolithHostOf(m: Match): XenolithCoopHost | null {
  const h = m.host.raidX?.host;
  return h instanceof XenolithCoopHost ? h : null;
}

class CoopPilot {
  private readonly ai: EnemyFighterAI;
  private readonly command = createCommand();
  private readonly self: { -readonly [K in keyof AiSelf]: AiSelf[K] };
  private readonly senses: { -readonly [K in keyof AiSenses]: AiSenses[K] };
  private dodge = 0;
  private avoid = 0;
  private readonly avoidPoint = { position: vec3(), velocity: vec3() };
  private beamKey = -1;
  private beamDodge = false;
  private beamAge = 0;
  private orbKey = -1;
  private orbDodge = false;
  private orbAge = 0;
  private readonly dodgePoint = { position: vec3(), velocity: vec3() };
  private readonly fwd = vec3();
  private readonly pullPoint = { position: vec3(), velocity: vec3() };

  constructor(
    private readonly m: Match,
    readonly id: number,
    private readonly role: RoleSpec,
    private readonly rng: () => number,
    private readonly job: XenolithJob = 'auto',
    private readonly lookahead = 1.2,
  ) {
    this.ai = new EnemyFighterAI(STARTER_AIRCRAFT, role.skill, [], rng, undefined, GUN_CONFIG);
    const a = this.aircraft.state;
    this.self = {
      position: a.position,
      orientation: a.orientation,
      angularRate: a.angularRate,
      speed: 0,
      afterburnerGauge: 1,
      hpRatio: 1,
      agl: 0,
      verticalSpeed: 0,
    };
    this.senses = {
      self: this.self,
      target: null,
      threat: null,
      damageTaken: 0,
      locked: false,
      missileReady: true,
      flareReady: true,
    };
  }

  private get aircraft() {
    const a = this.m.owns[this.id];
    if (!a) throw new Error('aircraft');
    return a;
  }

  step(dt: number): void {
    const m = this.m;
    const h = xenolithHostOf(m);
    const game = m.game(this.id);
    const ctl = m.controls[this.id];
    const cmb = m.combat[this.id];
    if (!h || !game || !ctl || !cmb) return;
    const k = h.raid.kaiju;
    const a = this.aircraft;
    const s = a.state;
    const fwd = rotateVec3(this.fwd, s.orientation, LOCAL_FORWARD);
    const v = { x: fwd.x * s.speed, y: fwd.y * s.speed, z: fwd.z * s.speed };
    const avoidAt = this.avoidPoint.position;
    if (this.avoid <= 0 && xenolithHullAvoid(k, s.position, v, this.lookahead, avoidAt))
      this.avoid = 1;
    const mine = h.focusId === this.id;
    // 光線（狙われているとき。1 回の光線に 1 度だけ決める）
    const beam = k.beam;
    const beamNo = k.attacksUsed.sweep + k.attacksUsed.charged;
    if (mine && beam.busy && beam.phase !== 'recover') {
      if (this.beamKey !== beamNo) {
        this.beamKey = beamNo;
        this.beamAge = 0;
        this.beamDodge = this.rng() < this.role.dodgeChance;
      }
      this.beamAge += dt;
    }
    const react = this.role.react;
    if (this.beamDodge && this.beamKey === beamNo && this.beamAge >= react && this.dodge <= 0) {
      if (sweepThreat(k, s.position)) {
        sweepDodgePoint(k, s.position, v, this.dodgePoint.position);
        this.dodge = 1.6;
      } else if (beam.kind === 'charged' && beam.phase === 'charge' && beam.targetId === this.id) {
        pullPoint(k, s.position, v, this.dodgePoint.position);
        this.dodge = 2;
      }
    }
    // 光の弾（狙われているとき。予兆ごとに 1 度決め、遅れて横へ）
    if (mine && k.orbPhase === 'warn') {
      if (this.orbKey !== k.orbVolleys) {
        this.orbKey = k.orbVolleys;
        this.orbAge = 0;
        this.orbDodge = this.rng() < this.role.dodgeChance;
      }
      this.orbAge += dt;
    } else if (this.orbKey === k.orbVolleys - 1) this.orbAge += dt;
    const orbNow = this.orbAge >= react && this.orbAge < react + 0.3;
    if (this.orbDodge && orbNow && this.dodge <= 0) {
      breakPoint(k, s.position, v, this.dodgePoint.position);
      this.dodge = 1.2;
    }
    if (this.avoid > 0 || this.dodge > 0) {
      const p = this.avoid > 0 ? this.avoidPoint : this.dodgePoint;
      if (this.avoid > 0) this.avoid -= dt;
      if (this.dodge > 0) this.dodge -= dt;
      pursue(ctl, a, p);
      ctl.throttleTarget = 1;
      cmb.fire = false;
      this.pullUp(s, fwd);
      return;
    }
    const target = this.pick(h);
    const self = this.self;
    self.speed = s.speed;
    self.afterburnerGauge = s.afterburnerGauge;
    self.hpRatio = game.ownHp / 200;
    // 地面の回避を少し下げる（ソロのボットと同じ）
    self.agl = s.position.y - Math.max(0, harbor(s.position.x, s.position.z)) + 60;
    self.verticalSpeed = 0;
    this.senses.target = target;
    // 弾幕の小さな当たりで逃げに入らない（ソロのボットと同じ）
    this.senses.damageTaken = 0;
    const tp = target.position;
    const d = Math.hypot(tp.x - s.position.x, tp.y - s.position.y, tp.z - s.position.z);
    const cos =
      d > 0
        ? ((tp.x - s.position.x) * fwd.x +
            (tp.y - s.position.y) * fwd.y +
            (tp.z - s.position.z) * fwd.z) /
          d
        : 1;
    const locked = d < 2400 && cos > Math.cos((10 * Math.PI) / 180);
    this.senses.locked = locked;
    const c = this.command;
    this.ai.step(this.senses, dt, c);
    ctl.pitch = c.pitch;
    ctl.roll = c.roll;
    ctl.yaw = c.yaw;
    ctl.afterburner = c.afterburner;
    ctl.throttleTarget = c.throttle;
    this.pullUp(s, fwd);
    const onBody = gunOnBody(s, h.parts);
    cmb.fire = (c.trigger || onBody) && game.briefingRemaining <= 0;
    cmb.locked = locked;
    cmb.targetId = KAIJU_ID_BASE + target.kaijuIndex;
    cmb.missile = c.missile && locked;
  }

  /** 床から 70m 未満か、2.5 秒で床から 60m を切るなら、前の上（床から 400m）の点へ向かって引き起こす */
  private pullUp(
    s: Readonly<{ position: Readonly<{ x: number; y: number; z: number }>; speed: number }>,
    fwd: Readonly<{ x: number; y: number; z: number }>,
  ): void {
    const ctl = this.m.controls[this.id];
    if (!ctl) return;
    const floor = Math.max(0, harbor(s.position.x, s.position.z));
    const agl = s.position.y - floor;
    const ahead = agl + Math.min(0, fwd.y * s.speed) * 2.5;
    if (agl >= 70 && ahead >= 60) return;
    const h = Math.hypot(fwd.x, fwd.z) || 1;
    const up = this.pullPoint.position;
    up.x = s.position.x + (fwd.x / h) * 1500;
    up.z = s.position.z + (fwd.z / h) * 1500;
    up.y = floor + 400;
    pursue(ctl, this.aircraft, this.pullPoint);
    ctl.throttleTarget = 1;
  }

  private pick(h: XenolithCoopHost): XenolithPartTarget {
    const parts = h.parts;
    const hull = parts[0];
    if (!hull) throw new Error('parts');
    const k = h.raid.kaiju;
    const open = !k.barrier.absorbs;
    const find = (id: string): XenolithPartTarget | undefined =>
      parts.find((x) => x.id === id && x.active && !(id === 'dome' && x.broken));
    const gen = (): XenolithPartTarget | undefined => GENS.map(find).find((x) => x !== undefined);
    if (this.job === 'body') return hull;
    if (this.role.focus && this.job === 'auto') return (open ? find('dome') : gen()) ?? hull;
    if (this.job === 'gens' && !open) return gen() ?? hull;
    return hull;
  }
}

/** n 人の協力を 1 回（ボットで）。終わるか打ち切りまで */
export async function runXenolithCoop(o: XenolithCoopOptions): Promise<XenolithCoopResult> {
  const difficulty = o.difficulty ?? 'normal';
  const m = await startMatch(
    o.players - 1,
    { latencyMs: 30, jitterMs: 5 },
    {
      mode: 'raid',
      mapId: RAID_CONFIG.mapId,
      raidKaiju: raidKaijuIndex('xenolith'),
      hard: difficulty === 'hard',
    },
    0,
    harbor,
    10500 + o.seed,
  );
  if (o.lives === false) m.host.arena.lives = null;
  const role = KAIJU2_ROLES[o.role];
  const pilots = Array.from(
    { length: o.players },
    (_, id) =>
      new CoopPilot(
        m,
        id,
        role,
        createRandom(4500 + o.seed * 7 + id),
        o.jobs?.[id] ?? 'auto',
        XENOLITH_HULL_LOOKAHEAD[o.role] ?? 1.2,
      ),
  );
  const max = o.maxSeconds ?? XENOLITH_RAID_CONFIG.totalSeconds[difficulty] + 10;
  let t = 0;
  while (t < max && !m.host.finished) {
    await m.run(1, () => {
      for (const p of pilots) p.step(1 / 60);
    });
    t += 1;
    o.onSecond?.(m);
  }
  await m.run(0.5);
  const over = m.events[0]?.find((e) => e.kind === 'over');
  const downs = [...m.host.arena.fighters.values()].reduce((s, f) => s + f.deaths, 0);
  const h = xenolithHostOf(m);
  const genShare = Array.from({ length: o.players }, (_, id) => {
    const f = h?.fields(id).partDamage ?? [];
    const total = f.reduce((s, v) => s + v, 0);
    return total > 0 ? (f[4] ?? 0) / total : 0;
  });
  return {
    cleared: over?.b === RAID_OUTCOME.clear,
    outcome: over?.b ?? 0,
    seconds: (over?.n ?? t * 60) / 60,
    downs,
    genShare,
    gensBroken: h?.raid.kaiju.brokenGens ?? 0,
    bodyHits: h?.bodyHits ?? 0,
    taken: { ...(h?.taken ?? {}) },
    match: m,
  };
}
