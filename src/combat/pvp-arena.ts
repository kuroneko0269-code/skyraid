// PvP の戦闘のホストの判定（5-3）。命中・ダメージ・撃墜・復帰はすべてここ（ホストだけ）で決める。
// 機銃・ミサイル・フレア・円錐の判定はシングルプレイと同じ部品（Gun / MissileSystem / FlareField / inCone）を使う。
// 遅延補償: 機銃の弾は、撃った人が見ていた tick の位置へ巻き戻した対象と判定する（履歴は各機 0.5 秒）。
// ミサイルの発射ではロックを信頼せず、巻き戻した対象の位置で円錐の条件を見直す（外れていれば無誘導）。
// 撃墜（墜落も）されると 3 秒後、出現位置のうち他機から最も遠い所へ戻し、3 秒無敵にする。Three.js 非依存
import { PVP_CONFIG, PVP_SPAWN_POINTS } from '../data/pvp';
import { FLARE_CONFIG, MISSILE_CONFIG } from '../data/weapons';
import type { Aircraft, AircraftControls } from '../entities/aircraft';
import { headingQuat } from '../entities/enemy-aircraft';
import { LOCAL_FORWARD } from '../flight/flight-model';
import { copyQuat, copyVec3, quatIdentity, rotateVec3, vec3 } from '../flight/math';
import { FlareField } from './flare';
import type { GroundHeightFn, GunHit, Rng } from './gun';
import { MissileSystem, splashDamage, type Detonation } from './missile';
import { PvpFighter, RewoundTarget, type FighterSpec } from './pvp-fighter';
import { inCone } from './targeting';

/** 1 ステップ分の操作（NetControls と同じ形。飛行 + 戦闘） */
export interface PvpControls extends AircraftControls {
  readonly autoLevel: boolean;
  readonly invertPitch: boolean;
  readonly fire: boolean;
  readonly missile: boolean;
  readonly flare: boolean;
  readonly locked: boolean;
  /** 選んでいる対象の ID（なしは 0〜3 以外） */
  readonly targetId: number;
}

/** 判定の結果（ホストが event で全員に送る）。a・b・n の意味は protocol.ts の EventMsg と同じ */
export interface ArenaEvent {
  kind: 'fire' | 'hit' | 'explode' | 'kill' | 'flare' | 'respawn';
  a: number;
  b: number;
  n: number;
  x: number;
  y: number;
  z: number;
}

/** 撃墜した人・当たった人が「いない」（墜落・地面での起爆） */
export const NOBODY = 255;

export class PvpArena {
  /** 今の tick（ホストが step の初めに進める） */
  tick = 0;
  /** 遅延補償（テストで切って比べる） */
  lagCompensation = true;
  readonly fighters = new Map<number, PvpFighter>();
  readonly missiles: MissileSystem<PvpFighter>;
  readonly flares: FlareField;
  private readonly list: PvpFighter[] = [];
  private readonly forward = vec3();
  private readonly aim = vec3();
  private readonly wreck = vec3();
  private readonly wreckOrientation = quatIdentity();
  private readonly spawnOrientation = quatIdentity();
  private readonly event: ArenaEvent = { kind: 'fire', a: 0, b: 0, n: 0, x: 0, y: 0, z: 0 };

  constructor(
    private readonly emit: (e: Readonly<ArenaEvent>) => void,
    private readonly groundHeight: GroundHeightFn | null = null,
    private readonly rng: Rng = Math.random,
  ) {
    this.missiles = new MissileSystem<PvpFighter>(
      MISSILE_CONFIG,
      this.handleDetonation,
      groundHeight,
      rng,
      undefined,
      PVP_CONFIG.maxMissiles,
    );
    this.flares = new FlareField(FLARE_CONFIG, 4);
  }

  add(id: number, aircraft: Aircraft, spec: FighterSpec): PvpFighter {
    const f = new PvpFighter(id, aircraft, spec, this.handleGunHit, this.groundHeight, this.rng);
    this.fighters.set(id, f);
    this.rebuild();
    return f;
  }

  remove(id: number): void {
    if (!this.fighters.delete(id)) return;
    // 抜けた人を追っているミサイルは直進に
    const pool = this.missiles.missiles;
    for (let i = 0; i < pool.count; i++) {
      const m = pool.get(i);
      if (m.target instanceof PvpFighter && m.target.id === id) m.target = null;
    }
    this.rebuild();
  }

  get all(): readonly PvpFighter[] {
    return this.list;
  }

  /**
   * 1 機の 1 ステップ分の操作（参加者の入力はホストに届いた分だけ、1 tick に 0〜2 回呼ぶ）。
   * viewTick は撃った人が他機を見ていた tick（null は今。ホスト自身）
   */
  stepFighter(id: number, c: Readonly<PvpControls>, dt: number, viewTick: number | null): void {
    const f = this.fighters.get(id);
    if (!f) return;
    const a = f.aircraft;
    if (!f.alive) {
      // 撃墜されている間は動かない（残骸の位置）。飛んでいる弾だけ進める
      copyVec3(a.prevPosition, a.state.position);
      copyQuat(a.prevOrientation, a.state.orientation);
      f.gun.step(false, a.state, f.others, dt);
      this.setFiring(f, false);
      return;
    }
    const opts = a.flight.options;
    opts.autoLevel = c.autoLevel;
    opts.invertPitch = c.invertPitch;
    copyVec3(this.wreck, a.state.position);
    copyQuat(this.wreckOrientation, a.state.orientation);
    const crashes = a.crashCount;
    a.step(c, dt);
    if (a.crashCount !== crashes) {
      // Aircraft は墜落すると上空へ戻すので、残骸の位置に置き直す
      a.respawn(this.wreck, this.wreckOrientation);
      f.crash();
      this.down(f, null);
      return;
    }
    a.velocity(f.velocity);
    this.rewind(f, viewTick);
    this.setFiring(f, c.fire);
    f.gun.step(c.fire, a.state, f.others, dt);
    f.missileAmmo.step(dt);
    f.flareAmmo.step(dt);
    if (c.missile && f.missileAmmo.tryUse()) {
      const target = this.lockTarget(f, c);
      this.missiles.launch(a.state, target, f.team);
    }
    if (c.flare && f.flareAmmo.tryUse()) {
      this.flares.release(a.state, f.team);
      this.send('flare', f.id, 0, 0, a.state.position);
    }
  }

  /** tick の終わり（全機を動かした後）: 位置の履歴・ミサイル・フレア・無敵と復帰のタイマー */
  endTick(dt: number): void {
    for (const f of this.list) f.history.record(this.tick, f.position);
    this.flares.step(dt);
    this.missiles.step(this.list, this.flares.flares, dt);
    for (const f of this.list) {
      if (f.invulnerableTimer > 0) f.invulnerableTimer = Math.max(0, f.invulnerableTimer - dt);
      if (f.alive) continue;
      f.respawnTimer -= dt;
      if (f.respawnTimer <= 1e-9) this.respawn(f);
    }
  }

  /** 出現位置のうち、生きている他機までの最短距離が最も大きい所の番号 */
  farthestSpawn(excludeId: number): number {
    let best = 0;
    let bestDist = -1;
    PVP_SPAWN_POINTS.forEach((s, i) => {
      let d = Infinity;
      for (const f of this.list) {
        if (f.id === excludeId || !f.alive) continue;
        const p = f.position;
        d = Math.min(d, Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z));
      }
      if (d > bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  private respawn(f: PvpFighter): void {
    const i = this.farthestSpawn(f.id);
    const s = PVP_SPAWN_POINTS[i] ?? PVP_SPAWN_POINTS[0];
    if (!s) return;
    f.aircraft.respawn(s, headingQuat(this.spawnOrientation, s.headingDeg));
    f.revive(PVP_CONFIG.invulnerableSeconds);
    this.send('respawn', f.id, i, 0, s);
  }

  /** 撃墜: 撃墜した人の撃墜数・された人の被撃墜数を数え、復帰のタイマーを始める */
  private down(victim: PvpFighter, killer: PvpFighter | null): void {
    victim.deaths++;
    victim.respawnTimer = PVP_CONFIG.respawnSeconds;
    victim.velocity.x = victim.velocity.y = victim.velocity.z = 0;
    if (killer && killer !== victim) killer.kills++;
    this.setFiring(victim, false);
    this.send('kill', killer ? killer.id : NOBODY, victim.id, 0, victim.position);
  }

  private damage(victim: PvpFighter, amount: number, attacker: PvpFighter | null): void {
    if (victim.applyDamage(amount)) this.down(victim, attacker);
  }

  /** 撃った人の others に、見ていた tick の他機の位置を入れる */
  private rewind(f: PvpFighter, viewTick: number | null): void {
    const back = this.lagCompensation && viewTick !== null && viewTick < this.tick;
    for (const o of f.others) {
      if (!back || !o.fighter.history.sample(viewTick, o.position))
        copyVec3(o.position, o.fighter.position);
    }
  }

  /** ミサイルの目標: クライアントのロックを信頼せず、巻き戻した位置で円錐（+ 余裕）の中か見直す。外れなら無誘導 */
  private lockTarget(f: PvpFighter, c: Readonly<PvpControls>): PvpFighter | null {
    if (!c.locked) return null;
    const o = f.others.find((r) => r.fighter.id === c.targetId);
    if (!o?.fighter.alive) return null;
    const s = f.spec.targeting;
    const fwd = rotateVec3(this.forward, f.aircraft.state.orientation, LOCAL_FORWARD);
    const cone = s.lockConeDeg + PVP_CONFIG.lockConeToleranceDeg;
    return inCone(f.position, fwd, o.position, s.lockRange, cone) ? o.fighter : null;
  }

  private setFiring(f: PvpFighter, on: boolean): void {
    if (f.firing === on) return;
    f.firing = on;
    this.send('fire', f.id, on ? 1 : 0, 0, f.position);
  }

  private rebuild(): void {
    this.list.length = 0;
    for (const f of this.fighters.values()) this.list.push(f);
    for (const f of this.list) {
      f.others.length = 0;
      for (const o of this.list) if (o !== f) f.others.push(new RewoundTarget(o));
    }
  }

  private send(
    kind: ArenaEvent['kind'],
    a: number,
    b: number,
    n: number,
    p: { readonly x: number; readonly y: number; readonly z: number },
  ): void {
    const e = this.event;
    e.kind = kind;
    e.a = a;
    e.b = b;
    e.n = n;
    e.x = p.x;
    e.y = p.y;
    e.z = p.z;
    this.emit(e);
  }

  private readonly handleGunHit = (
    shooter: PvpFighter,
    hit: Readonly<GunHit<RewoundTarget>>,
  ): void => {
    const t = hit.target;
    if (!t) return;
    const victim = t.fighter;
    shooter.hits++;
    // 火花は対象の今の位置 + 巻き戻した位置からのずれ（見ていた機体の上に出す）
    this.aim.x = hit.x - t.position.x + victim.position.x;
    this.aim.y = hit.y - t.position.y + victim.position.y;
    this.aim.z = hit.z - t.position.z + victim.position.z;
    this.send('hit', shooter.id, victim.id, 0, this.aim);
    this.damage(victim, shooter.spec.gunDamage, shooter);
  };

  /** 範囲ダメージ（撃った本人には入らない）。シングルと同じ splashDamage */
  private readonly handleDetonation = (d: Readonly<Detonation<PvpFighter>>): void => {
    const owner = this.fighters.get(d.owner) ?? null;
    this.send('explode', d.owner, d.target ? d.target.id : NOBODY, d.serial & 0xff, d);
    for (const f of this.list) {
      if (!f.alive || f.team === d.owner) continue;
      const p = f.position;
      const dist = Math.hypot(p.x - d.x, p.y - d.y, p.z - d.z) - f.hitRadius;
      const amount = splashDamage(this.missiles.spec, dist);
      if (amount > 0) this.damage(f, amount, owner);
    }
  };
}
