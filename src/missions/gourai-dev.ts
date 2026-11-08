// 10-4a: 確かめる場（?dev=gourai）の判定の側（Three.js・DOM 非依存）: フリーフライトにメカ怪獣ゴウライだけを出す。
// GamePlay の差し込み口（free-extra.ts）に付け、飛行の始めのシードから怪獣の種を作るので、リプレイでも同じに動く。
// 部位は CombatSystem の撃てる対象の末尾に足す（機銃・ミサイルで減らせる。フリーフライトでは倒れない: 体力は 1% で止める）。
// 弾は自機に当たる。ミサイルは自機のフレアに乗り換える。
// 10-4b: ソロのレイド（ミッション raidGourai）も引き受ける（体力・制限時間・撃破は gourai-raid.ts）。体は通り抜けられない
// （弾く・ダメージ・短い操作不能）。追ってくるミサイルは HUD の MISSILE の警告に数える
import { RamGrace, ramDamage } from '../combat/kaiju-ram';
import { TEAM_ENEMY } from '../combat/target';
import { GOURAI_CONFIG as C, GOURAI_PARTS } from '../data/gourai';
import type { MapDef } from '../data/maps';
import type { GouraiKaiju } from '../ai/gourai-ai';
import { createHullContact } from '../ai/albion-hull';
import { gouraiContact } from '../ai/gourai-hull';
import type { Vec3 } from '../flight/math';
import { fitPatrol, type GouraiGround, type GouraiPatrol } from '../entities/gourai/gourai-body';
import { createGouraiTargets, type GouraiPartTarget } from '../entities/gourai/gourai-target';
import { raidWorld } from './albion-world';
import { attachFreeExtra, type FreeExtra } from './free-extra';
import type { GamePlay } from './game-play';
import { GOURAI_ID } from './gourai-mission';
import { GouraiRaid } from './gourai-raid';
import type { MissionDef } from './types';
import type { MissionWorld } from './world';

/** URL で決める始めの状態（?grhp=<1〜100>・?grbreak=gunL,podR・?grroute=bay）。再生でも同じ URL なら同じになる */
export interface GouraiDevOptions {
  readonly hpPercent: number;
  readonly broken: readonly string[];
  readonly bay: boolean;
}

export function parseGouraiOptions(search: string): GouraiDevOptions {
  const params = new URLSearchParams(search);
  const hp = Number(params.get('grhp') ?? '100');
  const broken = (params.get('grbreak') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(
      (s) => s !== 'hull' && s !== 'armor' && (GOURAI_PARTS as readonly string[]).includes(s),
    );
  return {
    hpPercent: Number.isFinite(hp) ? Math.max(1, Math.min(100, hp)) : 100,
    broken: [...new Set(broken)],
    bay: params.get('grroute') === 'bay',
  };
}

export interface GouraiDevEnv {
  readonly ground: GouraiGround;
  readonly map: () => Pick<MapDef, 'center' | 'id'>;
  /** 10-4b: フリーフライトにも出す（?dev=gourai の確かめる場だけ。省略は true） */
  readonly freeFlight?: boolean;
}

/** 動かしている場面: 止めている / フリーフライト（確かめる場）/ ソロのレイド */
export type GouraiMode = 'off' | 'free' | 'raid';

/** 港湾都市の湾の巡回（10-4b のレイド・?grroute=bay） */
export function bayPatrol(center: { readonly x: number; readonly z: number }): GouraiPatrol {
  const b = C.bayPatrol;
  return fitPatrol(
    { x: b.x, z: b.z, radius: b.radius },
    center.x,
    center.z,
    C.arena.soft,
    C.size.length / 2,
  );
}

/** 巡回の中心から from の側の円の上の点と、from の方を向く向き */
export function spawnOnPatrol(
  patrol: GouraiPatrol,
  from: Readonly<Vec3>,
): { x: number; z: number; heading: number } {
  const dx = from.x - patrol.x;
  const dz = from.z - patrol.z;
  const d = Math.hypot(dx, dz) || 1;
  const x = patrol.x + (dx / d) * patrol.radius;
  const z = patrol.z + (dz / d) * patrol.radius;
  return { x, z, heading: Math.atan2(-(from.x - x), -(from.z - z)) };
}

/** 自機を追っているミサイル（フレアに乗り換えていない・近い）の数（HUD の MISSILE 警告） */
export function missilesOn(k: GouraiKaiju, id: number, p: Readonly<Vec3>, range = 3000): number {
  let n = 0;
  for (const s of k.shots.shots) {
    if (!s.active || s.kind !== 'missile' || s.decoyed || s.targetId !== id) continue;
    const q = s.position;
    if (Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) <= range) n++;
  }
  return n;
}

export class GouraiDev implements FreeExtra {
  readonly raid: GouraiRaid;
  readonly partTargets: readonly GouraiPartTarget[];
  private seed = 1;
  mode: GouraiMode = 'off';
  /** 飛行の途中から出した（読み込みが遅れた。リプレイの記録と合わない） */
  lateStart = false;
  /** 自機が受けた当たりの数え（値の表示・ボット）: 機銃の弾幕・回転掃射・ミサイル・体への衝突 */
  readonly taken = { gun: 0, sweep: 0, missile: 0, body: 0 };
  /** 体への衝突の後、続けて当たらない残り秒 */
  /** 10-4c: 体への衝突の「続けて当たらない」間（共通の部品） */
  readonly ram = new RamGrace();
  private readonly contact = createHullContact();
  private readonly velocity = { x: 0, y: 0, z: 0 };
  /** 追ってくるミサイルの数（HUD の MISSILE の警告に足す口） */
  private readonly incoming = (): number =>
    this.active ? missilesOn(this.kaiju, 0, this.play.session.aircraft.state.position) : 0;

  constructor(
    private readonly play: GamePlay,
    private readonly options: GouraiDevOptions,
    private readonly env: GouraiDevEnv,
  ) {
    this.raid = new GouraiRaid(env.ground);
    this.partTargets = createGouraiTargets(this.raid);
  }

  get kaiju(): GouraiKaiju {
    return this.raid.kaiju;
  }

  get stateRoot(): object {
    return this.raid;
  }

  get active(): boolean {
    return this.mode !== 'off';
  }

  /** フリーフライトで出ている */
  get flying(): boolean {
    return this.mode === 'free' && this.play.runner === null;
  }

  /** レイドで出ている（終わった後の結果の画面まで） */
  get raiding(): boolean {
    return this.mode === 'raid';
  }

  get playerPosition(): Readonly<Vec3> {
    return this.play.session.aircraft.state.position;
  }

  reseed(seed: number): void {
    this.seed = (seed ^ C.dev.seedSalt) >>> 0;
  }

  stop(): void {
    this.mode = 'off';
    this.kaiju.body.visible = false;
    this.kaiju.shots.clear();
    // 自分が付けた口だけ外す（協力の表示が付けた口は残す）
    const s = this.play.session;
    if (s.player.extraIncoming === this.incoming) s.player.extraIncoming = null;
  }

  start(): void {
    if (this.env.freeFlight === false) {
      this.stop();
      return;
    }
    this.mode = 'free';
    this.lateStart = false;
    this.raid.reset(false, 'normal');
    this.spawn(this.patrolFor(), this.options.hpPercent / 100, this.options.broken);
  }

  /** 10-4b: ゴウライのレイドなら引き受ける（体力・難易度・出す位置）。ランナーが読む世界を返す */
  startMission(def: MissionDef): MissionWorld | null {
    const r = def.reward.raid;
    if (r?.kaiju !== GOURAI_ID) return null;
    this.mode = 'raid';
    this.lateStart = false;
    this.raid.reset(true, r.difficulty);
    this.spawn(bayPatrol(this.env.map().center), 1, []);
    return raidWorld(this.play, this.raid);
  }

  private spawn(patrol: GouraiPatrol, hpRatio: number, broken: readonly string[]): void {
    const s = this.play.session;
    // 飛行ごとに撃てる対象へ足す（同じ物は 1 回だけ。飛行を始め直すと対象の一覧が作り直される）
    s.combat.addTargets(this.partTargets);
    for (const t of this.partTargets) t.hits = 0;
    // 巡回の中心から自機の側の円の上に出し、自機の方を向く
    const at = spawnOnPatrol(patrol, s.aircraft.state.position);
    this.raid.spawn(
      patrol,
      at.x,
      at.z,
      at.heading,
      this.seed,
      this.env.map().center,
      hpRatio,
      broken,
    );
    for (const t of this.partTargets) t.place(true);
    for (const key of Object.keys(this.taken) as (keyof typeof this.taken)[]) this.taken[key] = 0;
    this.ram.clear();
    // 追ってくるミサイルを HUD の MISSILE の警告・警告音に数える
    s.player.extraIncoming = this.incoming;
  }

  /** 巡回: 自機の前方 ahead m を中心に（?grroute=bay なら港湾都市の湾）。戦域の内側に寄せる */
  patrolFor(): GouraiPatrol {
    const map = this.env.map();
    if (this.options.bay && map.id === 'harbor') return bayPatrol(map.center);
    const s = this.play.session.aircraft.state;
    const q = s.orientation;
    const fx = -2 * (q.x * q.z + q.w * q.y);
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const h = Math.hypot(fx, fz) || 1;
    const p: GouraiPatrol = {
      x: s.position.x + (fx / h) * C.dev.ahead,
      z: s.position.z + (fz / h) * C.dev.ahead,
      radius: C.patrol.radius,
    };
    return fitPatrol(p, map.center.x, map.center.z, C.arena.soft, C.size.length / 2);
  }

  /** 飛行の途中から出す（遅延チャンクの読み込みが飛行の始めに間に合わなかったとき） */
  startLate(): void {
    this.start();
    this.lateStart = true;
  }

  step(dt: number): void {
    if (this.mode === 'off') return;
    const s = this.play.session;
    const a = s.aircraft;
    // 自機の速度（前のステップの位置との差から。機銃の見越し）
    if (dt > 0) {
      this.velocity.x = (a.state.position.x - a.prevPosition.x) / dt;
      this.velocity.y = (a.state.position.y - a.prevPosition.y) / dt;
      this.velocity.z = (a.state.position.z - a.prevPosition.z) / dt;
    }
    const me = {
      position: a.state.position,
      active: s.player.active,
      id: 0,
      radius: s.player.hitRadius,
      velocity: this.velocity,
    };
    this.raid.step(dt, me, s.combat.flares.flares, (kind, damage, _who, sweep) => {
      if (!s.player.active) return;
      const key = kind === 'missile' ? 'missile' : sweep ? 'sweep' : 'gun';
      this.taken[key]++;
      if (key === 'missile') this.raid.missileTaken++;
      else if (key === 'sweep') this.raid.sweepTaken++;
      else this.raid.gunTaken++;
      s.combat.dealDamage(s.player, damage, TEAM_ENEMY);
    });
    this.collide(dt);
    for (const t of this.partTargets) t.place();
  }

  /**
   * 10-4c: 体への衝突: 最大 HP の約 8 割のダメージ（足りなければ撃墜）。跳ねない（10-4b は弾いて 30 と操作不能）。続けて当たらない間がある。
   * 倒した後と撃墜されている間は無し
   */
  private collide(dt: number): void {
    this.ram.tick(dt);
    const s = this.play.session;
    const k = this.kaiju;
    if (!s.player.active || this.raid.dead || !k.body.visible) return;
    const a = s.aircraft;
    const B = C.collision;
    if (
      !gouraiContact(
        k.body,
        k.phase === 1,
        a.prevPosition,
        a.state.position,
        B.margin,
        B.sampleStep,
        this.contact,
      )
    )
      return;
    if (!this.ram.hit(0)) return;
    this.taken.body++;
    this.raid.bodyTaken++;
    const p = a.state.position;
    s.combat.ramListeners.report(p.x, p.y, p.z);
    s.combat.dealDamage(s.player, ramDamage(s.player.maxHp), TEAM_ENEMY);
  }
}

/** GamePlay に付ける（ゴウライの遅延チャンクから） */
export function attachGouraiDev(
  play: GamePlay,
  options: GouraiDevOptions,
  env: GouraiDevEnv,
): GouraiDev {
  const dev = new GouraiDev(play, options, env);
  attachFreeExtra(play, dev);
  return dev;
}
