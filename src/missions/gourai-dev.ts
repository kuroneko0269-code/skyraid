// 10-4a: 確かめる場（?dev=gourai）の判定の側（Three.js・DOM 非依存）: フリーフライトにメカ怪獣ゴウライだけを出す。
// GamePlay の差し込み口（free-extra.ts）に付け、飛行の始めのシードから怪獣の種を作るので、リプレイでも同じに動く。
// 部位は CombatSystem の撃てる対象の末尾に足す（機銃・ミサイルで減らせる。フリーフライトでは倒れない: 体力は 1% で止める）。
// 弾は自機に当たる（数値は仮）。ミサイルは自機のフレアに乗り換える
import { TEAM_ENEMY } from '../combat/target';
import { GOURAI_CONFIG as C, GOURAI_PARTS } from '../data/gourai';
import type { MapDef } from '../data/maps';
import { GouraiKaiju } from '../ai/gourai-ai';
import type { Vec3 } from '../flight/math';
import { fitPatrol, type GouraiGround, type GouraiPatrol } from '../entities/gourai/gourai-body';
import { createGouraiTargets, type GouraiPartTarget } from '../entities/gourai/gourai-target';
import { attachFreeExtra, type FreeExtra } from './free-extra';
import type { GamePlay } from './game-play';

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
}

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

export class GouraiDev implements FreeExtra {
  readonly kaiju: GouraiKaiju;
  readonly partTargets: readonly GouraiPartTarget[];
  private seed = 1;
  private running = false;
  /** 飛行の途中から出した（読み込みが遅れた。リプレイの記録と合わない） */
  lateStart = false;
  /** 自機が受けた当たりの数え（値の表示） */
  readonly taken = { gun: 0, missile: 0 };

  constructor(
    private readonly play: GamePlay,
    private readonly options: GouraiDevOptions,
    private readonly env: GouraiDevEnv,
  ) {
    this.kaiju = new GouraiKaiju(env.ground);
    // フリーフライトでは倒れない（体力は 1% で止まる）
    this.kaiju.immortal = true;
    this.partTargets = createGouraiTargets(this.kaiju);
  }

  get stateRoot(): object {
    return this.kaiju;
  }

  get active(): boolean {
    return this.running;
  }

  /** フリーフライトで出ている */
  get flying(): boolean {
    return this.running && this.play.runner === null;
  }

  get playerPosition(): Readonly<Vec3> {
    return this.play.session.aircraft.state.position;
  }

  reseed(seed: number): void {
    this.seed = (seed ^ C.dev.seedSalt) >>> 0;
  }

  stop(): void {
    this.running = false;
    this.kaiju.body.visible = false;
    this.kaiju.shots.clear();
  }

  start(): void {
    this.running = true;
    this.lateStart = false;
    const s = this.play.session;
    // 飛行ごとに撃てる対象へ足す（同じ物は 1 回だけ。飛行を始め直すと対象の一覧が作り直される）
    s.combat.addTargets(this.partTargets);
    for (const t of this.partTargets) t.hits = 0;
    const map = this.env.map();
    const patrol = this.patrolFor();
    // 巡回の中心から自機の側の円の上に出し、自機の方を向く
    const a = s.aircraft.state.position;
    const dx = a.x - patrol.x;
    const dz = a.z - patrol.z;
    const d = Math.hypot(dx, dz) || 1;
    const x = patrol.x + (dx / d) * patrol.radius;
    const z = patrol.z + (dz / d) * patrol.radius;
    const heading = Math.atan2(-(a.x - x), -(a.z - z));
    this.kaiju.body.arenaX = map.center.x;
    this.kaiju.body.arenaZ = map.center.z;
    this.kaiju.spawn(
      patrol,
      x,
      z,
      heading,
      this.seed,
      this.options.hpPercent / 100,
      this.options.broken,
    );
    for (const t of this.partTargets) t.place(true);
    this.taken.gun = 0;
    this.taken.missile = 0;
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
    if (!this.running) return;
    const s = this.play.session;
    const me = {
      position: s.aircraft.state.position,
      active: s.player.active,
      id: 0,
      radius: s.player.hitRadius,
    };
    this.kaiju.step(dt, me, s.combat.flares.flares, (kind, damage) => {
      if (!s.player.active) return;
      this.taken[kind]++;
      s.combat.dealDamage(s.player, damage, TEAM_ENEMY);
    });
    for (const t of this.partTargets) t.place();
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
