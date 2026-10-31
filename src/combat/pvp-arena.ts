// PvP の戦闘のホストの判定（5-3）。命中・ダメージ・撃墜・復帰はすべてここ（ホストだけ）で決める。
// 機銃・ミサイル・フレア・円錐の判定はシングルプレイと同じ部品（Gun / MissileSystem / FlareField / inCone）を使う。
// 遅延補償: 機銃の弾は、撃った人が見ていた tick の位置へ巻き戻した対象と判定する（履歴は各機 0.5 秒）。
// ミサイルの発射ではロックを信頼せず、巻き戻した対象の位置で円錐の条件を見直す（外れていれば無誘導）。
// 撃墜（墜落も）されると 3 秒後、出現位置のうち他機から最も遠い所へ戻し、3 秒無敵にする。
// 5-4: チーム戦（味方の機銃・ミサイル・爆風は当たらない）、初心者保護（復帰時）、連続撃墜、再接続待ち（away）と
// 再接続した人の位置合わせ（resync: 撃墜に数えずに出現位置へ戻す）。
// 6-2: レイドの怪獣の部位を機銃・ミサイルの対象に入れ（攻撃した人の ID 付きでダメージ）、怪獣の攻撃の当たり・スタンを受ける。Three.js 非依存
import { PVP_CONFIG } from '../data/pvp';
import { FLARE_CONFIG, MISSILE_CONFIG } from '../data/weapons';
import type { Aircraft } from '../entities/aircraft';
import { LOCAL_FORWARD } from '../flight/flight-model';
import { copyQuat, copyVec3, quatIdentity, rotateVec3, vec3, type Vec3 } from '../flight/math';
import { FlareField } from './flare';
import type { GroundHeightFn, GunHit, Rng } from './gun';
import { MissileSystem, splashDamage, type Detonation } from './missile';
import { KaijuPart } from '../entities/kaiju-part';
import { PvpFighter, RewoundTarget, type ArenaGunTarget, type FighterSpec } from './pvp-fighter';
import * as R from './arena-raid';
import type { ArenaFuseTarget } from './arena-raid';
import * as T from './arena-types';
import { DEFENSE_ID_BASE, KAIJU_ID_BASE, NOBODY } from './arena-types';
import type { CombatTarget } from './target';
import { farthestSpawn } from './pvp-spawn';

export { DEFENSE_ID_BASE, KAIJU_ID_BASE, NOBODY, RESPAWN_BOOST } from './arena-types';
export type { ArenaEvent, PvpControls } from './arena-types';

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
  /** 防衛戦（7-2）の敵（機銃・ミサイルの対象。ダメージは onExtraDamage に渡す） */
  private extras: readonly CombatTarget[] = [];
  private onExtraDamage: (shooter: number, target: CombatTarget, amount: number) => void = () =>
    undefined;
  /** ミサイルの netId に使う通し番号のビット（7-2: 防衛戦は 0x7f。上のビットは敵のミサイル） */
  netIdMask = 0xff;
  private readonly fuseList: ArenaFuseTarget[] = [];
  readonly flares: FlareField;
  private readonly list: PvpFighter[] = [];
  private readonly forward = vec3();
  private readonly aim = vec3();
  private readonly wreck = vec3();
  private readonly wreckOrientation = quatIdentity();
  private readonly spawnOrientation = quatIdentity();
  private readonly event: T.ArenaEvent = { kind: 'fire', a: 0, b: 0, n: 0, x: 0, y: 0, z: 0 };

  /** 撃墜から復帰までの秒数（6-6: レイドは 5 秒） */
  respawnSeconds: number = PVP_CONFIG.respawnSeconds;
  /** 復帰の位置（6-6: レイドは ID ごとの開始位置。null は PvP の輪の中で他機から最も遠い所） */
  respawnPoint: ((id: number) => Readonly<Vec3 & { headingDeg: number }>) | null = null;

  /** 高層の建物（6-4。移動の線分が当たれば墜落）。null は建物なし */
  obstacles: ((a: Readonly<Vec3>, b: Readonly<Vec3>) => boolean) | null = null;

  constructor(
    private readonly emit: (e: Readonly<T.ArenaEvent>) => void,
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

  /**
   * 防衛戦の敵を対象に入れる（7-2）。当たった・爆風が入ったら onDamage（撃った人・相手・量）。
   * 入力の targetId は DEFENSE_ID_BASE + list の添字
   */
  setExtraTargets(
    list: readonly CombatTarget[],
    onDamage: (shooter: number, target: CombatTarget, amount: number) => void,
  ): void {
    this.extras = list;
    this.onExtraDamage = onDamage;
    this.rebuild();
  }

  /** 防衛戦の敵の攻撃が当たった（7-2。怪獣と同じく撃墜した人なし）。撃墜されたら true */
  enemyDamage(id: number, amount: number): boolean {
    const f = this.fighters.get(id);
    if (!f?.active) return false;
    this.damage(f, amount, null);
    return !f.alive;
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
  stepFighter(id: number, c: Readonly<T.PvpControls>, dt: number, viewTick: number | null): void {
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
    f.lockPart = R.lockedPartIndex(this.kaijuParts, c.locked, c.targetId - KAIJU_ID_BASE);
    copyVec3(this.wreck, a.state.position);
    copyQuat(this.wreckOrientation, a.state.orientation);
    const crashes = a.crashCount;
    a.step(stunned ? R.NEUTRAL : c, dt);
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
      // ミサイルの目標: クライアントのロックを信頼せず、巻き戻した位置で円錐（+ 余裕）の中か見直す。外れなら無誘導
      const fwd = rotateVec3(this.forward, a.state.orientation, LOCAL_FORWARD);
      const target = R.lockTargetOf(f, c, fwd, this.kaijuParts, this.extras);
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
    const send = (b: number, p: Readonly<Vec3>): void => {
      this.send('respawn', f.id, b, 0, p);
    };
    R.respawnFighter(f, this, this.spawnOrientation, send);
  }

  /** 撃墜: 撃墜した人の撃墜数・された人の被撃墜数を数え、復帰のタイマーを始める */
  private down(victim: PvpFighter, killer: PvpFighter | null): void {
    victim.deaths++;
    victim.respawnTimer = this.respawnSeconds;
    victim.lockPart = -1;
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

  private setFiring(f: PvpFighter, on: boolean): void {
    if (f.firing === on) return;
    f.firing = on;
    this.send('fire', f.id, on ? 1 : 0, 0, f.position);
  }

  private rebuild(): void {
    R.rebuildTargets(
      this.fighters,
      this.list,
      this.kaijuParts,
      this.extras,
      this.fuseList,
      (a, b) => this.sameSide(a, b),
    );
  }

  private send(
    kind: T.ArenaEvent['kind'],
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
    if (!(t instanceof RewoundTarget)) {
      // 防衛戦の敵（7-2）
      shooter.hits++;
      this.send('hit', shooter.id, DEFENSE_ID_BASE + this.extras.indexOf(t), 0, hit);
      this.onExtraDamage(shooter.id, t, shooter.spec.gunDamage);
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
    const hitId = R.hitIdOf(t, this.extras);
    this.send('explode', d.owner, hitId, d.serial & this.netIdMask, d);
    R.splashKaijuParts(this.kaijuParts, d, this.missiles.spec);
    if (this.extras.length > 0 && this.fighters.has(d.owner))
      R.splashExtras(this.extras, d, this.missiles.spec, this.onExtraDamage);
    for (const f of this.list) {
      if (!f.active || this.sameSide(f.id, d.owner)) continue;
      const p = f.position;
      const dist = Math.hypot(p.x - d.x, p.y - d.y, p.z - d.z) - f.hitRadius;
      const amount = splashDamage(this.missiles.spec, dist);
      if (amount > 0) this.damage(f, amount, owner);
    }
  };
}
