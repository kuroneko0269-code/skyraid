// 10-3b: 白鯨アルビオンの協力レイドの調整のボット（ネフィルガの kaiju2-coop-bots.ts と同じ形）。インメモリの通信（pvp-match.ts）で
// 本物のホスト（HostGame + 差し込み口の AlbionCoopHost）とクライアント（ClientGame + 写し）を動かし、各プレイヤーを敵機と同じ AI に
// 役の腕前を渡して操縦させる。狙うもの: 機首の前 20°・700m 以内に子分がいれば子分（DEFENSE_ID_BASE + 番号）、いなければ部位
// （熟練は巣 → 尾 → 頭 → 背びれ → 胴、ほかは胴）。予兆への反応は狙われているとき（kaijuTarget）だけ。
// 役割が生まれるか: 人ごとの「子分へのダメージ ÷ 与えたダメージ」の差（成績の partDamage の最後の列が子分）
import { EnemyFighterAI, createCommand, type AiSelf, type AiSenses } from '../src/ai/enemy-fighter';
import { DEFENSE_ID_BASE, KAIJU_ID_BASE } from '../src/combat/pvp-arena';
import type { CombatTarget } from '../src/combat/target';
import { createRandom } from '../src/core/random';
import { STARTER_AIRCRAFT } from '../src/data/aircraft';
import { ALBION_RAID_CONFIG } from '../src/data/albion-raid';
import { RAID_CONFIG } from '../src/data/kaiju';
import type { RaidDifficulty } from '../src/data/raid';
import { raidKaijuIndex } from '../src/data/raid-kaiju';
import { HARBOR_TERRAIN } from '../src/data/terrain-harbor';
import { GUN_CONFIG } from '../src/data/weapons';
import { LOCAL_FORWARD } from '../src/flight/flight-model';
import { rotateVec3, vec3 } from '../src/flight/math';
import { AlbionCoopHost, albionRaidPlugin } from '../src/net/albion-coop';
import { registerRaidPlugin } from '../src/net/raid-plugin';
import { RAID_OUTCOME } from '../src/net/raid-host';
import { createHeightField } from '../src/render/terrain-height';
import { ALBION_FOCUS, albionThreat } from './albion-raid-bots';
import { KAIJU2_ROLES, type Kaiju2Role, type RoleSpec } from './kaiju2-bot-roles';
import { pursue } from './pvp-bots';
import { startMatch, type Match } from './pvp-match';

const harbor = createHeightField(HARBOR_TERRAIN).getGroundHeight;

registerRaidPlugin(albionRaidPlugin(() => undefined));

export interface AlbionCoopOptions {
  readonly role: Kaiju2Role;
  readonly players: number;
  readonly seed: number;
  readonly difficulty?: RaidDifficulty;
  readonly maxSeconds?: number;
  readonly onSecond?: (m: Match) => void;
  /** false なら残機を外す（時間・撃墜の比べ） */
  readonly lives?: boolean;
  /**
   * 役の割り当て（人ごと。省略は全員 'auto'）: auto = 正面に来た子分だけ撃ち、ほかは部位 / minion = 2.5km 以内の子分を追って落とす
   * （いなければ部位）/ body = 子分を撃たず部位だけ
   */
  readonly jobs?: readonly ('auto' | 'minion' | 'body')[];
}

export interface AlbionCoopResult {
  readonly cleared: boolean;
  readonly outcome: number;
  readonly seconds: number;
  readonly downs: number;
  /** 人ごとの子分へのダメージの割合（0〜1） */
  readonly minionShare: readonly number[];
  readonly rams: number;
  readonly match: Match;
}

/** ホストのアルビオン（差し込み口の本体） */
export function albionHostOf(m: Match): AlbionCoopHost | null {
  const h = m.host.raidX?.host;
  return h instanceof AlbionCoopHost ? h : null;
}

class CoopPilot {
  private readonly ai: EnemyFighterAI;
  private readonly command = createCommand();
  private readonly self: { -readonly [K in keyof AiSelf]: AiSelf[K] };
  private readonly senses: { -readonly [K in keyof AiSenses]: AiSenses[K] };
  private lastHp = 0;
  private dodge = 0;
  private decided = -1;
  private attacks = 0;
  private lastAction = '';
  private readonly dodgePoint = { position: vec3(), velocity: vec3() };
  private readonly fwd = vec3();

  constructor(
    private readonly m: Match,
    readonly id: number,
    private readonly role: RoleSpec,
    private readonly rng: () => number,
    private readonly job: 'auto' | 'minion' | 'body' = 'auto',
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
    const h = albionHostOf(m);
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
    // 予兆への反応（狙われているときだけ。1 回の攻撃に 1 度だけ決める）
    if (
      m.host.kaijuTarget === this.id &&
      k.action === 'windup' &&
      this.decided !== this.attacks &&
      k.actionTime >= this.role.react
    ) {
      this.decided = this.attacks;
      if (this.rng() < this.role.dodgeChance) {
        const v = { x: fwd.x * s.speed, y: fwd.y * s.speed, z: fwd.z * s.speed };
        if (albionThreat(k, s.position, v)) {
          this.dodge = 3;
          const p = s.position;
          const fx = -Math.sin(k.body.heading);
          const fz = -Math.cos(k.body.heading);
          const side =
            (p.x - k.body.position.x) * -fz + (p.z - k.body.position.z) * fx >= 0 ? 1 : -1;
          const d = this.dodgePoint.position;
          d.x = p.x + -fz * side * 1400;
          d.z = p.z + fx * side * 1400;
          d.y = Math.max(250, k.body.position.y - 300);
        }
      }
    }
    if (this.dodge > 0) {
      this.dodge -= dt;
      pursue(ctl, a, this.dodgePoint);
      ctl.throttleTarget = 1;
      return;
    }
    const pick = this.pick(h, s.position, fwd);
    const target = pick.target;
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
    const floor = Math.max(0, harbor(s.position.x, s.position.z));
    if (s.position.y - floor < 180 && fwd.y < 0.2) {
      ctl.pitch = 1;
      ctl.roll = 0;
    }
    cmb.fire = c.trigger && game.briefingRemaining <= 0;
    cmb.locked = locked;
    cmb.targetId = pick.id;
    cmb.missile = c.missile && locked;
  }

  private pick(
    h: AlbionCoopHost,
    me: Readonly<{ x: number; y: number; z: number }>,
    fwd: Readonly<{ x: number; y: number; z: number }>,
  ): { target: CombatTarget; id: number } {
    let near = -1;
    let nearD = Infinity;
    for (let i = 0; i < h.minions.length && this.job !== 'body'; i++) {
      const t = h.minions[i];
      if (!t?.active) continue;
      const p = t.position;
      const d = Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z);
      const cos = ((p.x - me.x) * fwd.x + (p.y - me.y) * fwd.y + (p.z - me.z) * fwd.z) / (d || 1);
      if (this.job === 'auto' && d < 700 && cos > Math.cos((20 * Math.PI) / 180))
        return { target: t, id: DEFENSE_ID_BASE + i };
      if (d < nearD) {
        nearD = d;
        near = i;
      }
    }
    const hunted = h.minions[near];
    if (this.job === 'minion' && hunted && nearD < 2500)
      return { target: hunted, id: DEFENSE_ID_BASE + near };
    const parts = h.parts;
    const first = parts[1] ?? parts[0];
    if (!first) throw new Error('parts');
    if (this.role.focus)
      for (const id of ALBION_FOCUS) {
        const t = parts.find((x) => x.id === id && !x.broken);
        if (t) return { target: t, id: KAIJU_ID_BASE + t.kaijuIndex };
      }
    return { target: first, id: KAIJU_ID_BASE + first.kaijuIndex };
  }
}

/** n 人の協力を 1 回（ボットで）。終わるか打ち切りまで */
export async function runAlbionCoop(o: AlbionCoopOptions): Promise<AlbionCoopResult> {
  const difficulty = o.difficulty ?? 'normal';
  const m = await startMatch(
    o.players - 1,
    { latencyMs: 30, jitterMs: 5 },
    {
      mode: 'raid',
      mapId: RAID_CONFIG.mapId,
      raidKaiju: raidKaijuIndex('albion'),
      hard: difficulty === 'hard',
    },
    0,
    harbor,
    10300 + o.seed,
  );
  if (o.lives === false) m.host.arena.lives = null;
  const role = KAIJU2_ROLES[o.role];
  const pilots = Array.from(
    { length: o.players },
    (_, id) =>
      new CoopPilot(m, id, role, createRandom(4300 + o.seed * 7 + id), o.jobs?.[id] ?? 'auto'),
  );
  const max = o.maxSeconds ?? ALBION_RAID_CONFIG.totalSeconds[difficulty] + 10;
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
  const h = albionHostOf(m);
  const minionShare = Array.from({ length: o.players }, (_, id) => {
    const f = h?.fields(id).partDamage ?? [];
    const total = f.reduce((s, v) => s + v, 0);
    return total > 0 ? (f[f.length - 1] ?? 0) / total : 0;
  });
  return {
    cleared: over?.b === RAID_OUTCOME.clear,
    outcome: over?.b ?? 0,
    seconds: (over?.n ?? t * 60) / 60,
    downs,
    minionShare,
    rams: h?.raid.kaiju.rams ?? 0,
    match: m,
  };
}
