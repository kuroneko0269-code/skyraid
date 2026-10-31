// PvP の戦闘のホストの判定（5-3）。命中・ダメージ・撃墜・復帰はすべてここ（ホストだけ）で決める。
// 機銃・ミサイル・フレア・円錐の判定はシングルプレイと同じ部品（Gun / MissileSystem / FlareField / inCone）を使う。
// 遅延補償: 機銃の弾は、撃った人が見ていた tick の位置へ巻き戻した対象と判定する（履歴は各機 0.5 秒）。
// ミサイルの発射ではロックを信頼せず、巻き戻した対象の位置で円錐の条件を見直す（外れていれば無誘導）。
// 撃墜（墜落も）されると 3 秒後、出現位置のうち他機から最も遠い所へ戻し、3 秒無敵にする。
// 5-4: チーム戦（味方の機銃・ミサイル・爆風は当たらない）、初心者保護（復帰時）、連続撃墜、再接続待ち（away）と
// 再接続した人の位置合わせ（resync: 撃墜に数えずに出現位置へ戻す）。
// 6-2: レイドの怪獣の部位を機銃・ミサイルの対象に入れ（攻撃した人の ID 付きでダメージ）、怪獣の攻撃の当たり・スタンを受ける。Three.js 非依存
import { PVP_CONFIG, PVP_SPAWN_POINTS } from '../data/pvp';
import { FLARE_CONFIG, MISSILE_CONFIG } from '../data/weapons';
import type { Aircraft, AircraftControls } from '../entities/aircraft';
import { headingQuat } from '../entities/enemy-aircraft';
import { LOCAL_FORWARD } from '../flight/flight-model';
import { copyQuat, copyVec3, quatIdentity, rotateVec3, vec3, type Vec3 } from '../flight/math';
import { FlareField } from './flare';
import type { GroundHeightFn, GunHit, Rng } from './gun';
import { MissileSystem, splashDamage, type Detonation } from './missile';
import { KaijuPart } from '../entities/kaiju-part';
import { PvpFighter, RewoundTarget, type ArenaGunTarget, type FighterSpec } from './pvp-fighter';
import { NEUTRAL, lockablePart, splashKaijuParts, type ArenaFuseTarget } from './arena-raid';
import { isRookie } from './pvp-rules';
import { farthestSpawn } from './pvp-spawn';
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
  kind: 'fire' | 'hit' | 'explode' | 'kill' | 'flare' | 'respawn' | 'stun';
  a: number;
  b: number;
  n: number;
  x: number;
  y: number;
  z: number;
}

/** 撃墜した人・当たった人が「いない」（墜落・地面での起爆） */
export const NOBODY = 255;
/** 怪獣の部位を表す ID（hit の b・入力の targetId。6-2）: KAIJU_ID_BASE + 部位の番号 */
export const KAIJU_ID_BASE = 16;

/** respawn の b（出現位置の番号）に足す印: 初心者保護つき（protocol.ts の RESPAWN_ROOKIE と同じ） */
export const RESPAWN_BOOST = 0x80;

export class PvpArena {
  /** 今の tick（ホストが step の初めに進める） */
  tick = 0;
  /** 遅延補償（テストで切って比べる） */
  lagCompensation = true;
  /** 初心者保護（5-4。ホスト設定）: 撃墜数が最下位の人を HP +50%・ミサイル +2 で復帰させる */
  rookieGuard = false;
  /** チーム戦のチーム（プレイヤー ID → チーム。null は個人戦） */
  private teams: ReadonlyMap<number, number> | null = null;
  readonly fighters = new Map<number, PvpFighter>();
  readonly missiles: MissileSystem<ArenaFuseTarget>;
  private kaijuParts: readonly KaijuPart[] = [];
  private readonly fuseList: ArenaFuseTarget[] = [];
  readonly flares: FlareField;
  private readonly list: PvpFighter[] = [];
  private readonly forward = vec3();
  private readonly aim = vec3();
  private readonly wreck = vec3();
  private readonly wreckOrientation = quatIdentity();
  private readonly spawnOrientation = quatIdentity();
  private readonly event: ArenaEvent = { kind: 'fire', a: 0, b: 0, n: 0, x: 0, y: 0, z: 0 };

  /** 高層の建物（6-4。移動の線分が当たれば墜落）。null は建物なし */
  obstacles: ((a: Readonly<Vec3>, b: Readonly<Vec3>) => boolean) | null = null;

  constructor(
    private readonly emit: (e: Readonly<ArenaEvent>) => void,
    private readonly groundHeight: GroundHeightFn | null = null,
    private readonly rng: Rng = Math.random,
  ) {
    this.missiles = new MissileSystem<ArenaFuseTarget>(
      MISSILE_CONFIG,
      this.handleDetonation,
      groundHeight,
      rng,
      undefined,
      PVP_CONFIG.maxMissiles,
    );
    this.flares = new FlareField(FLARE_CONFIG, 4);
    this.missiles.isFriendly = (target, owner) =>
      target instanceof PvpFighter && this.sameSide(target.id, owner);
  }

  /** レイドの怪獣の部位を対象に入れる（6-2） */
  setKaijuParts(parts: readonly KaijuPart[]): void {
    this.kaijuParts = parts;
    this.rebuild();
  }

  /** 怪獣の攻撃が当たった（6-2。撃墜は「墜落」と同じく撃墜した人なし） */
  kaijuDamage(id: number, amount: number): void {
    const f = this.fighters.get(id);
    if (f?.active) this.damage(f, amount, null);
  }

  /** 怪獣の咆哮のスタン（6-2）。全員に stun の event（n = 秒 × 100） */
  stun(id: number, seconds: number): void {
    const f = this.fighters.get(id);
    if (!f?.active) return;
    f.stunTimer = Math.max(f.stunTimer, seconds);
    this.send('stun', id, 0, Math.round(seconds * 100), f.position);
  }

  /** チーム戦にする（null は個人戦）。味方は機銃の判定（others）から外す */
  setTeams(teams: ReadonlyMap<number, number> | null): void {
    this.teams = teams;
    this.rebuild();
  }

  /** 同じ側か（個人戦は本人だけ、チーム戦は同じチーム） */
  sameSide(a: number, b: number): boolean {
    if (a === b) return true;
    const t = this.teams;
    if (!t) return false;
    const ta = t.get(a);
    return ta !== undefined && ta === t.get(b);
  }

  /** 再接続待ちにする / 戻す（5-4）。戻すときは次の tick の終わりに出現位置へ（撃墜には数えない） */
  setAway(id: number, away: boolean): void {
    const f = this.fighters.get(id);
    if (!f) return;
    if (away) {
      f.away = true;
      this.setFiring(f, false);
    } else if (f.away) {
      f.away = false;
      f.resync = true;
    }
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
    if (!f.alive || f.away || f.resync) {
      // 撃墜されている間・再接続待ちの間は動かない（残骸の位置）。飛んでいる弾だけ進める
      copyVec3(a.prevPosition, a.state.position);
      copyQuat(a.prevOrientation, a.state.orientation);
      f.gun.step(false, a.state, f.gunTargets, dt);
      this.setFiring(f, false);
      return;
    }
    const opts = a.flight.options;
    opts.autoLevel = c.autoLevel;
    opts.invertPitch = c.invertPitch;
    const stunned = f.stunTimer > 0;
    copyVec3(this.wreck, a.state.position);
    copyQuat(this.wreckOrientation, a.state.orientation);
    const crashes = a.crashCount;
    a.step(stunned ? NEUTRAL : c, dt);
    if (a.crashCount !== crashes || (this.obstacles?.(this.wreck, a.state.position) ?? false)) {
      // Aircraft は墜落すると上空へ戻すので、残骸の位置に置き直す
      a.respawn(this.wreck, this.wreckOrientation);
      f.crash();
      this.down(f, null);
      return;
    }
    a.velocity(f.velocity);
    this.rewind(f, viewTick);
    const fire = c.fire && !stunned;
    this.setFiring(f, fire);
    f.gun.step(fire, a.state, f.gunTargets, dt);
    f.missileAmmo.step(dt);
    f.flareAmmo.step(dt);
    if (stunned) return;
    if (c.missile && f.missileAmmo.tryUse()) {
      const target = this.lockTarget(f, c);
      this.missiles.launch(a.state, target, f.team);
    }
    if (c.flare && f.flareAmmo.tryUse()) {
      this.flares.release(a.state, f.team);
      f.flareAge = 0;
      this.send('flare', f.id, 0, 0, a.state.position);
    }
  }

  /** tick の終わり（全機を動かした後）: 位置の履歴・ミサイル・フレア・無敵と復帰のタイマー */
  endTick(dt: number): void {
    for (const f of this.list) f.history.record(this.tick, f.position);
    this.flares.step(dt);
    this.missiles.step(this.fuseList, this.flares.flares, dt);
    for (const f of this.list) {
      f.flareAge += dt;
      if (f.stunTimer > 0) f.stunTimer = Math.max(0, f.stunTimer - dt);
      if (f.invulnerableTimer > 0) f.invulnerableTimer = Math.max(0, f.invulnerableTimer - dt);
      if (f.resync) {
        f.resync = false;
        this.respawn(f);
        continue;
      }
      if (f.alive || f.away) continue;
      f.respawnTimer -= dt;
      if (f.respawnTimer <= 1e-9) this.respawn(f);
    }
  }

  /** 出現位置のうち、生きている他機までの最短距離が最も大きい所の番号 */
  farthestSpawn(excludeId: number): number {
    return farthestSpawn(this.list, excludeId);
  }

  private respawn(f: PvpFighter): void {
    const i = this.farthestSpawn(f.id);
    const s = PVP_SPAWN_POINTS[i] ?? PVP_SPAWN_POINTS[0];
    if (!s) return;
    f.aircraft.respawn(s, headingQuat(this.spawnOrientation, s.headingDeg));
    const boost = this.rookieGuard && isRookie(f.id, this.list);
    f.revive(PVP_CONFIG.invulnerableSeconds, boost);
    this.send('respawn', f.id, i | (boost ? RESPAWN_BOOST : 0), 0, s);
  }

  /** 撃墜: 撃墜した人の撃墜数・された人の被撃墜数を数え、復帰のタイマーを始める */
  private down(victim: PvpFighter, killer: PvpFighter | null): void {
    victim.deaths++;
    victim.respawnTimer = PVP_CONFIG.respawnSeconds;
    victim.velocity.x = victim.velocity.y = victim.velocity.z = 0;
    victim.streak = 0;
    if (killer && killer !== victim) {
      killer.kills++;
      killer.streak++;
      killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
    }
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
  private lockTarget(f: PvpFighter, c: Readonly<PvpControls>): ArenaFuseTarget | null {
    if (!c.locked) return null;
    const s = f.spec.targeting;
    const fwd = rotateVec3(this.forward, f.aircraft.state.orientation, LOCAL_FORWARD);
    const cone = s.lockConeDeg + PVP_CONFIG.lockConeToleranceDeg;
    // 怪獣の部位（6-2）は巻き戻さない
    const part = this.kaijuParts[c.targetId - KAIJU_ID_BASE];
    if (part) return lockablePart(part, f.position, fwd, s.lockRange, cone);
    const o = f.others.find((r) => r.fighter.id === c.targetId);
    if (!o?.fighter.alive) return null;
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
      for (const o of this.list)
        if (!this.sameSide(f.id, o.id)) f.others.push(new RewoundTarget(o));
      f.gunTargets.splice(0, f.gunTargets.length, ...f.others, ...this.kaijuParts);
    }
    this.fuseList.splice(0, this.fuseList.length, ...this.list, ...this.kaijuParts);
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
    hit: Readonly<GunHit<ArenaGunTarget>>,
  ): void => {
    const t = hit.target;
    if (!t) return;
    if (t instanceof KaijuPart) {
      shooter.hits++;
      this.send('hit', shooter.id, KAIJU_ID_BASE + t.index, 0, hit);
      t.damageBy(shooter.spec.gunDamage, shooter.id);
      return;
    }
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
  private readonly handleDetonation = (d: Readonly<Detonation<ArenaFuseTarget>>): void => {
    const owner = this.fighters.get(d.owner) ?? null;
    const t = d.target;
    const hitId = t instanceof PvpFighter ? t.id : t ? KAIJU_ID_BASE + t.index : NOBODY;
    this.send('explode', d.owner, hitId, d.serial & 0xff, d);
    splashKaijuParts(this.kaijuParts, d, this.missiles.spec);
    for (const f of this.list) {
      if (!f.active || this.sameSide(f.id, d.owner)) continue;
      const p = f.position;
      const dist = Math.hypot(p.x - d.x, p.y - d.y, p.z - d.z) - f.hitRadius;
      const amount = splashDamage(this.missiles.spec, dist);
      if (amount > 0) this.damage(f, amount, owner);
    }
  };
}
