// 10-4b: メカ怪獣ゴウライの協力レイドの調整のボット（アルビオンの albion-coop-bots.ts と同じ形）。インメモリの通信（pvp-match.ts）で
// 本物のホスト（HostGame + 差し込み口の GouraiCoopHost）とクライアント（ClientGame + 写し）を動かし、各プレイヤーを敵機と同じ AI に
// 役の腕前を渡して操縦させる。狙うもの: 放熱で開いた核（熟練）・役（turret = 砲台を順に / body = 胴だけ / auto = 胴、熟練は核）。
// 予兆への反応: 回転掃射は狙われているとき（kaijuTarget）、ミサイルは自分を追ってくるとき（フレアと直角の急旋回）。体へ入りそうなら外へ
// 役割が生まれるか: 人ごとの「砲台へのダメージ ÷ 与えたダメージ」の差（成績の partDamage の 3 列目が砲台）
import { EnemyFighterAI, createCommand, type AiSelf, type AiSenses } from '../src/ai/enemy-fighter';
import { KAIJU_ID_BASE } from '../src/combat/pvp-arena';
import { createRandom } from '../src/core/random';
import { STARTER_AIRCRAFT } from '../src/data/aircraft';
import { GOURAI_RAID_CONFIG } from '../src/data/gourai-raid';
import { RAID_CONFIG } from '../src/data/kaiju';
import type { RaidDifficulty } from '../src/data/raid';
import { raidKaijuIndex } from '../src/data/raid-kaiju';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import { GUN_CONFIG } from '../src/data/weapons';
import type { GouraiPartTarget } from '../src/entities/gourai/gourai-target';
import { LOCAL_FORWARD } from '../src/flight/flight-model';
import { rotateVec3, vec3 } from '../src/flight/math';
import { GouraiCoopHost, gouraiRaidPlugin } from '../src/net/gourai-coop';
import { registerRaidPlugin } from '../src/net/raid-plugin';
import { RAID_OUTCOME } from '../src/net/raid-host';
import { createHeightField } from '../src/render/terrain-height';
import { gunOnBody } from './albion-bot-types';
import {
  GOURAI_HULL_LOOKAHEAD,
  gouraiHullAvoid,
  missileBreakPoint,
  missileNear,
  sweepDodgePoint,
  sweepThreat,
} from './gourai-bot-parts';
import { KAIJU2_ROLES, type Kaiju2Role, type RoleSpec } from './kaiju2-bot-roles';
import { pursue } from './pvp-bots';
import { startMatch, type Match } from './pvp-match';

const harbor = createHeightField(HARBOR_TERRAIN).getGroundHeight;

registerRaidPlugin(gouraiRaidPlugin(() => undefined));

const TURRETS = ['hipL', 'hipR', 'gunL', 'gunR', 'podL', 'podR'] as const;

export type GouraiJob = 'auto' | 'turret' | 'body';

export interface GouraiCoopOptions {
  readonly role: Kaiju2Role;
  readonly players: number;
  readonly seed: number;
  readonly difficulty?: RaidDifficulty;
  readonly maxSeconds?: number;
  readonly onSecond?: (m: Match) => void;
  /** false なら残機を外す（時間・撃墜の比べ） */
  readonly lives?: boolean;
  /** 役の割り当て（人ごと。省略は全員 'auto'）: auto = 胴（熟練は放熱の核も）/ turret = 砲台を順に / body = 胴と放熱の核 */
  readonly jobs?: readonly GouraiJob[];
}

export interface GouraiCoopResult {
  readonly cleared: boolean;
  readonly outcome: number;
  readonly seconds: number;
  readonly downs: number;
  /** 人ごとの砲台へのダメージの割合（0〜1） */
  readonly turretShare: readonly number[];
  readonly turretsAlive: number;
  readonly bodyHits: number;
  readonly taken: Readonly<Record<string, number>>;
  readonly match: Match;
}

/** ホストのゴウライ（差し込み口の本体） */
export function gouraiHostOf(m: Match): GouraiCoopHost | null {
  const h = m.host.raidX?.host;
  return h instanceof GouraiCoopHost ? h : null;
}

class CoopPilot {
  private readonly ai: EnemyFighterAI;
  private readonly command = createCommand();
  private readonly self: { -readonly [K in keyof AiSelf]: AiSelf[K] };
  private readonly senses: { -readonly [K in keyof AiSenses]: AiSenses[K] };
  private dodge = 0;
  private avoid = 0;
  private readonly avoidPoint = { position: vec3(), velocity: vec3() };
  private decided = -1;
  private willDodge = false;
  private attacks = 0;
  private lastAction = '';
  private warned = false;
  private flareWill = false;
  private warnAge = 0;
  private readonly dodgePoint = { position: vec3(), velocity: vec3() };
  private readonly fwd = vec3();
  private readonly pullPoint = { position: vec3(), velocity: vec3() };

  constructor(
    private readonly m: Match,
    readonly id: number,
    private readonly role: RoleSpec,
    private readonly rng: () => number,
    private readonly job: GouraiJob = 'auto',
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
    const h = gouraiHostOf(m);
    const game = m.game(this.id);
    const ctl = m.controls[this.id];
    const cmb = m.combat[this.id];
    if (!h || !game || !ctl || !cmb) return;
    const k = h.raid.kaiju;
    const a = this.aircraft;
    const s = a.state;
    const fwd = rotateVec3(this.fwd, s.orientation, LOCAL_FORWARD);
    if (k.action === 'windup' && this.lastAction !== 'windup') this.attacks++;
    this.lastAction = k.action;
    const v = { x: fwd.x * s.speed, y: fwd.y * s.speed, z: fwd.z * s.speed };
    if (
      this.avoid <= 0 &&
      gouraiHullAvoid(k, s.position, v, this.lookahead, this.avoidPoint.position)
    )
      this.avoid = 1.2;
    // 回転掃射（狙われているとき。1 回の攻撃に 1 度だけ決める）
    if (
      m.host.kaijuTarget === this.id &&
      k.action === 'windup' &&
      this.decided !== this.attacks &&
      k.actionTime >= this.role.react
    ) {
      this.decided = this.attacks;
      this.willDodge = this.rng() < this.role.dodgeChance;
    }
    if (
      this.willDodge &&
      this.decided === this.attacks &&
      this.dodge <= 0 &&
      sweepThreat(k, s.position, v)
    ) {
      sweepDodgePoint(k, s.position, v, this.dodgePoint.position);
      this.dodge = 1.5;
    }
    // 自分を追ってくるミサイル: 警告ごとに 1 度決め、フレアと直角の急旋回
    const near = missileNear(k, this.id, s.position);
    if (near && !this.warned) {
      this.warned = true;
      this.flareWill = this.rng() < this.role.dodgeChance;
      this.warnAge = 0;
    }
    if (!near) this.warned = false;
    this.warnAge += dt;
    cmb.flare = near && this.flareWill && this.warnAge >= this.role.react;
    if (
      this.flareWill &&
      this.warnAge >= this.role.react &&
      this.dodge <= 0 &&
      missileBreakPoint(k, this.id, s.position, v, this.dodgePoint.position, 600)
    )
      this.dodge = 1.2;
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
    // ゴウライは海面から 80m に浮くので、地面の回避を 100m 下げる（ソロのボットと同じ）
    self.agl = s.position.y - Math.max(0, harbor(s.position.x, s.position.z)) + 100;
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

  /**
   * 床から 70m 未満か、今の降り方のまま 2.5 秒で床から 60m を切るなら、前の上（床から 400m）の点へ向かって引き起こす
   * （傾いたまま機首を上げると横・下へ曲がって海へ落ちるので、向かう点で起こす）
   */
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

  private pick(h: GouraiCoopHost): GouraiPartTarget {
    const parts = h.parts;
    const hull = parts[0];
    if (!hull) throw new Error('parts');
    const core = parts.find((x) => x.id === 'core' && x.active);
    if (core && (this.role.focus || this.job === 'body')) return core;
    if (this.job === 'turret')
      for (const id of TURRETS) {
        const t = parts.find((x) => x.id === id && x.active);
        if (t) return t;
      }
    return hull;
  }
}

/** n 人の協力を 1 回（ボットで）。終わるか打ち切りまで */
export async function runGouraiCoop(o: GouraiCoopOptions): Promise<GouraiCoopResult> {
  const difficulty = o.difficulty ?? 'normal';
  const m = await startMatch(
    o.players - 1,
    { latencyMs: 30, jitterMs: 5 },
    {
      mode: 'raid',
      mapId: RAID_CONFIG.mapId,
      raidKaiju: raidKaijuIndex('gourai'),
      hard: difficulty === 'hard',
    },
    0,
    harbor,
    10400 + o.seed,
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
        createRandom(4400 + o.seed * 7 + id),
        o.jobs?.[id] ?? 'auto',
        GOURAI_HULL_LOOKAHEAD[o.role] ?? 1.2,
      ),
  );
  const max = o.maxSeconds ?? GOURAI_RAID_CONFIG.totalSeconds[difficulty] + 10;
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
  const h = gouraiHostOf(m);
  const turretShare = Array.from({ length: o.players }, (_, id) => {
    const f = h?.fields(id).partDamage ?? [];
    const total = f.reduce((s, v) => s + v, 0);
    return total > 0 ? (f[2] ?? 0) / total : 0;
  });
  return {
    cleared: over?.b === RAID_OUTCOME.clear,
    outcome: over?.b ?? 0,
    seconds: (over?.n ?? t * 60) / 60,
    downs,
    turretShare,
    turretsAlive: h?.raid.kaiju.turretsAlive ?? 6,
    bodyHits: h?.bodyHits ?? 0,
    taken: { ...(h?.taken ?? {}) },
    match: m,
  };
}
