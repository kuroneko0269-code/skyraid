// 9-6c: ネフィルガの協力レイドの調整のボット。インメモリの通信（pvp-match.ts）で本物のホスト（HostGame + Kaiju2Host）と
// クライアント（ClientGame）を動かし、各プレイヤーを敵機と同じ AI（EnemyFighterAI）に役の腕前を渡して操縦させる
// （ソロのボット tests/kaiju2-raid-bots.ts と同じ腕前の数値）。狙う部位の位置はホストのネフィルガ（正）を使う。
// 役: skilled（熟練・Lv3・翼 → 頭 → 尾 → 胴）/ average（平均的・Lv0・胴）/ beginner（初心者役）/ human（模擬の人。
// 協力ではタッチの手・狙いの補助を入れない: 1 人と 2〜4 人の比べは同じボットで行う）。
// 予兆への反応: 狙われているとき（ホストの kaijuTarget）だけ、反応の遅れの後に確率で横へ逃げる
import { EnemyFighterAI, createCommand, type AiSelf, type AiSenses } from '../src/ai/enemy-fighter';
import { KAIJU_ID_BASE } from '../src/combat/pvp-arena';
import type { CombatTarget } from '../src/combat/target';
import { createRandom } from '../src/core/random';
import { STARTER_AIRCRAFT } from '../src/data/aircraft';
import { RAID_CONFIG } from '../src/data/kaiju';
import { KAIJU2_RAID_CONFIG } from '../src/data/kaiju2-raid';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import type { RaidDifficulty } from '../src/data/raid';
import { GUN_CONFIG } from '../src/data/weapons';
import type { Kaiju2PartTarget } from '../src/entities/kaiju2/kaiju2-target';
import { LOCAL_FORWARD } from '../src/flight/flight-model';
import { rotateVec3, vec3 } from '../src/flight/math';
import { isPerching } from '../src/missions/kaiju2-raid';
import { RAID_OUTCOME } from '../src/net/raid-host';
import { createHeightField } from '../src/render/terrain-height';
import { pursue } from './pvp-bots';
import { startMatch, type Match } from './pvp-match';
import { FOCUS, KAIJU2_ROLES, type Kaiju2Role, type RoleSpec } from './kaiju2-bot-roles';
import { Kaiju2Hull } from '../src/ai/kaiju-hull/kaiju2-hull';
import { kaiju2HullAvoid } from './kaiju-hull-avoid';

const harbor = createHeightField(HARBOR_TERRAIN).getGroundHeight;
/** 10-6: 近づきすぎない避け方（ソロのボット tests/kaiju2-raid-bots.ts の AVOID と同じ） */
const KAIJU2_AVOID = { ahead: 1.0, pad: 30, seconds: 0.8 };

export interface Kaiju2CoopOptions {
  readonly role: Kaiju2Role;
  readonly players: number;
  readonly seed: number;
  readonly difficulty?: RaidDifficulty;
  readonly maxSeconds?: number;
  /** 毎秒呼ぶ（テストの確かめ） */
  readonly onSecond?: (m: Match) => void;
  /** 9-6d: false なら残機を外す（9-6c と同じ時間・撃墜の比べ） */
  readonly lives?: boolean;
  /** 10-6: 体への衝突を入れる前の判定（ホストは当てず、通り抜けた回数だけ数える）。ボットの近づきすぎない避け方も使わない */
  readonly noRam?: boolean;
}

export interface Kaiju2CoopResult {
  readonly cleared: boolean;
  readonly outcome: number;
  readonly seconds: number;
  readonly downs: number;
  /** 10-6: 体への衝突（全員。noRam なら通り抜けた回数） */
  readonly ramHits: number;
  readonly match: Match;
}

/** 1 人分の操縦（AI の判断 → 機体の操作と戦闘の操作） */
class CoopPilot {
  private readonly ai: EnemyFighterAI;
  private readonly command = createCommand();
  private readonly self: { -readonly [K in keyof AiSelf]: AiSelf[K] };
  private readonly senses: { -readonly [K in keyof AiSenses]: AiSenses[K] };
  private lastHp = 0;
  private dodge = 0;
  private decided = '';
  private readonly dodgePoint = { position: vec3(), velocity: vec3() };
  private readonly fwd = vec3();
  /** 10-6: 近づきすぎない（ソロのボットと同じ。noRam では使わない） */
  avoidOn = true;
  private avoid = 0;
  private readonly avoidPoint = { position: vec3(), velocity: vec3() };
  private readonly avoidHull = new Kaiju2Hull();

  constructor(
    private readonly m: Match,
    readonly id: number,
    private readonly role: RoleSpec,
    private readonly rng: () => number,
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
    const raid = m.host.raid2;
    const game = m.game(this.id);
    const ctl = m.controls[this.id];
    const cmb = m.combat[this.id];
    if (!raid || !game || !ctl || !cmb) return;
    const k = raid.raid.body;
    const a = this.aircraft;
    const s = a.state;
    const target = this.pick(raid.raid.targets);
    // 予兆への反応（狙われているときだけ。1 回の攻撃に 1 度だけ決める）
    const key = `${k.attack ?? ''}:${String(k.history.length)}:${String(Math.floor(k.time / 30))}`;
    const threatened =
      m.host.kaijuTarget === this.id &&
      !isPerching(k) &&
      k.attack !== null &&
      k.stateTime >= this.role.react;
    if (threatened && key !== this.decided) {
      this.decided = key;
      if (this.rng() < this.role.dodgeChance) {
        this.dodge = 1.6;
        const p = s.position;
        const dx = p.x - k.position.x;
        const dz = p.z - k.position.z;
        const l = Math.hypot(dx, dz) || 1;
        const side = this.rng() < 0.5 ? -1 : 1;
        const d = this.dodgePoint.position;
        d.x = p.x + (-dz / l) * side * 1500 + (dx / l) * 500;
        d.z = p.z + (dx / l) * side * 1500 + (dz / l) * 500;
        d.y = Math.max(p.y, 500);
        if (this.role.focus && k.attack === 'orbs') cmb.flare = true;
      }
    }
    if (this.avoidOn && this.avoid <= 0 && game.ownHp > 0 && k.visible && !raid.raid.dead) {
      const p = s.position;
      const v = {
        x: (p.x - a.prevPosition.x) / dt,
        y: (p.y - a.prevPosition.y) / dt,
        z: (p.z - a.prevPosition.z) / dt,
      };
      const kv = {
        x: (k.position.x - k.prevPosition.x) / dt,
        y: (k.position.y - k.prevPosition.y) / dt,
        z: (k.position.z - k.prevPosition.z) / dt,
      };
      this.avoidHull.pose(k.pose, k.broken);
      const floor = Math.max(0, harbor(p.x, p.z)) + 250;
      const A = KAIJU2_AVOID;
      if (
        kaiju2HullAvoid(
          this.avoidHull,
          k,
          kv,
          p,
          v,
          A.ahead,
          A.pad,
          floor,
          this.avoidPoint.position,
        )
      )
        this.avoid = A.seconds;
    }
    if (this.avoid > 0) {
      this.avoid -= dt;
      pursue(ctl, a, this.avoidPoint);
      ctl.throttleTarget = 1;
      return;
    }
    if (this.dodge > 0) {
      this.dodge -= dt;
      pursue(ctl, a, this.dodgePoint);
      ctl.throttleTarget = 1;
      return;
    }
    const self = this.self;
    self.speed = s.speed;
    self.afterburnerGauge = s.afterburnerGauge;
    const hp = game.ownHp;
    self.hpRatio = hp / 200;
    self.agl = s.position.y - Math.max(0, harbor(s.position.x, s.position.z));
    self.verticalSpeed = 0;
    this.senses.target = target;
    this.senses.damageTaken = Math.max(0, this.lastHp - hp);
    this.lastHp = hp;
    const fwd = rotateVec3(this.fwd, s.orientation, LOCAL_FORWARD);
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
    // 低空の引き起こし（地形・海面）
    const floor = Math.max(0, harbor(s.position.x, s.position.z));
    if (s.position.y - floor < 180 && fwd.y < 0.2) {
      ctl.pitch = 1;
      ctl.roll = 0;
    }
    cmb.fire = c.trigger && game.briefingRemaining <= 0;
    cmb.locked = locked;
    cmb.targetId = KAIJU_ID_BASE + target.kaijuIndex;
    cmb.missile = c.missile && locked;
  }

  private pick(targets: readonly Kaiju2PartTarget[]): CombatTarget & { kaijuIndex: number } {
    const first = targets[0];
    if (!first) throw new Error('targets');
    if (!this.role.focus) return first;
    for (const id of FOCUS) {
      const t = targets.find((x) => x.id === id);
      if (t && !t.broken) return t;
    }
    return first;
  }
}

/** n 人の協力を 1 回（ボットで）。終わるか打ち切りまで */
export async function runKaiju2Coop(o: Kaiju2CoopOptions): Promise<Kaiju2CoopResult> {
  const difficulty = o.difficulty ?? 'normal';
  const m = await startMatch(
    o.players - 1,
    { latencyMs: 30, jitterMs: 5 },
    { mode: 'raid', mapId: RAID_CONFIG.mapId, raidKaiju: 1, hard: difficulty === 'hard' },
    0,
    harbor,
    9600 + o.seed,
  );
  if (o.lives === false) m.host.arena.lives = null;
  // 10-6: 衝突を入れる前の判定（当てずに数える）
  let passes = 0;
  if (o.noRam) {
    const h = m.host.raid2;
    const hull = h ? (Reflect.get(h, 'hull') as Kaiju2Hull) : null;
    if (hull) {
      const contact = hull.contact.bind(hull);
      const grace = new Map<object, number>();
      hull.contact = (body, p0, p1, margin, step) => {
        if (contact(body, p0, p1, margin, step)) {
          // 同じ機体（自機の位置の入れ物）を 1.5 秒は続けて数えない
          const now = m.host.tick / 60;
          if (now - (grace.get(p1) ?? -Infinity) >= 1.5) passes++;
          grace.set(p1, now);
        }
        return false;
      };
    }
  }
  const role = KAIJU2_ROLES[o.role];
  const pilots = Array.from(
    { length: o.players },
    (_, id) => new CoopPilot(m, id, role, createRandom(4100 + o.seed * 7 + id)),
  );
  if (o.noRam) for (const p of pilots) p.avoidOn = false;
  const max = o.maxSeconds ?? KAIJU2_RAID_CONFIG.totalSeconds[difficulty] + 10;
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
  return {
    cleared: over?.b === RAID_OUTCOME.clear,
    outcome: over?.b ?? 0,
    seconds: (over?.n ?? t * 60) / 60,
    downs,
    ramHits: o.noRam ? passes : (m.host.raid2?.bodyHits ?? 0),
    match: m,
  };
}
