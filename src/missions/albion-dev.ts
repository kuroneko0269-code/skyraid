// 10-3a: 確かめる場（?dev=albion）の判定の側（Three.js・DOM 非依存）: フリーフライトに白鯨アルビオンだけを出す。
// GamePlay の差し込み口（free-extra.ts）に付け、飛行の始めのシードから怪獣の種を作るので、リプレイでも同じに動く。
// 部位と子分は CombatSystem の撃てる対象の末尾に足す（機銃・ミサイルで減らせる。フリーフライトでは倒れない: 体力は 1% で止める）
import { TEAM_ENEMY } from '../combat/target';
import { ALBION_CONFIG as C, ALBION_PARTS } from '../data/albion';
import type { MapDef } from '../data/maps';
import { AlbionKaiju } from '../ai/albion-ai';
import { inCloud } from '../ai/albion-attacks';
import type { Vec3 } from '../flight/math';
import type { AlbionGround } from '../entities/albion/albion-body';
import { fitRoute, nearestOnRoute, type AlbionRoute } from '../entities/albion/albion-route';
import {
  createAlbionTargets,
  type AlbionMinionTarget,
  type AlbionPartTarget,
} from '../entities/albion/albion-target';
import { attachFreeExtra, type FreeExtra } from './free-extra';
import type { GamePlay } from './game-play';

/** URL で決める始めの状態（?abhp=<1〜100>・?abbreak=nestFront,tail・?abroute=bay）。再生でも同じ URL なら同じになる */
export interface AlbionDevOptions {
  readonly hpPercent: number;
  readonly broken: readonly string[];
  readonly bay: boolean;
}

export function parseAlbionOptions(search: string): AlbionDevOptions {
  const params = new URLSearchParams(search);
  const hp = Number(params.get('abhp') ?? '100');
  const broken = (params.get('abbreak') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== 'body' && (ALBION_PARTS as readonly string[]).includes(s));
  return {
    hpPercent: Number.isFinite(hp) ? Math.max(1, Math.min(100, hp)) : 100,
    broken: [...new Set(broken)],
    bay: params.get('abroute') === 'bay',
  };
}

export interface AlbionDevEnv {
  readonly ground: AlbionGround;
  readonly map: () => Pick<MapDef, 'center' | 'id'>;
}

export class AlbionDev implements FreeExtra {
  readonly kaiju: AlbionKaiju;
  readonly partTargets: readonly AlbionPartTarget[];
  readonly minionTargets: readonly AlbionMinionTarget[];
  private seed = 1;
  private running = false;
  private added = false;
  /** 飛行の途中から出した（読み込みが遅れた。リプレイの記録と合わない） */
  lateStart = false;
  /** 自機が受けた当たりの数え（値の表示） */
  readonly taken = { spout: 0, slam: 0, cloud: 0, ram: 0 };

  constructor(
    private readonly play: GamePlay,
    private readonly options: AlbionDevOptions,
    private readonly env: AlbionDevEnv,
  ) {
    this.kaiju = new AlbionKaiju(env.ground);
    // フリーフライトでは倒れない（体力は 1% で止まる）
    this.kaiju.immortal = true;
    const t = createAlbionTargets(this.kaiju);
    this.partTargets = t.parts;
    this.minionTargets = t.minions;
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

  /** 自機の位置（値の表示） */
  get playerPosition(): Readonly<Vec3> {
    return this.play.session.aircraft.state.position;
  }

  /** 自機が雲の中か（値の表示。10-3b でロックの距離・視界に効かせる） */
  get inCloud(): boolean {
    return this.kaiju.cloudLeft > 0 && inCloud(this.kaiju.body, this.playerPosition);
  }

  reseed(seed: number): void {
    this.seed = (seed ^ C.dev.seedSalt) >>> 0;
  }

  stop(): void {
    this.running = false;
    this.kaiju.body.visible = false;
    this.kaiju.swarm.clear();
  }

  start(): void {
    this.running = true;
    this.lateStart = false;
    const s = this.play.session;
    if (!this.added) {
      s.combat.addTargets([...this.partTargets, ...this.minionTargets]);
      this.added = true;
    }
    const route = this.routeFor();
    const a = s.aircraft.state.position;
    // 周回路の上の、自機に一番近い所から少し進んだ所（横切る姿が正面に見える）
    const start = nearestOnRoute(route, a.x, a.z);
    this.kaiju.spawn(route, start, this.seed, this.options.hpPercent / 100, this.options.broken);
    const map = this.env.map();
    this.kaiju.body.arenaX = map.center.x;
    this.kaiju.body.arenaZ = map.center.z;
    for (const t of this.partTargets) t.place(true);
    for (const t of this.minionTargets) t.beginStep();
    this.taken.spout = 0;
    this.taken.slam = 0;
    this.taken.ram = 0;
  }

  /** 周回路: 自機の前方 ahead m を中心に、自機の向きに直角（?abroute=bay なら湾の周回路）。戦域の内側に寄せる */
  routeFor(): AlbionRoute {
    const map = this.env.map();
    const base = { halfLength: C.route.halfLength, turnRadius: C.route.turnRadius };
    let r: AlbionRoute;
    if (this.options.bay && map.id === 'harbor') {
      const b = C.bayRoute;
      r = { ...base, x: b.x, z: b.z, axis: (b.axisDeg * Math.PI) / 180 };
    } else {
      const s = this.play.session.aircraft.state;
      const q = s.orientation;
      const fx = -2 * (q.x * q.z + q.w * q.y);
      const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
      const h = Math.hypot(fx, fz) || 1;
      const heading = Math.atan2(-fx / h, -fz / h);
      r = {
        ...base,
        x: s.position.x + (fx / h) * C.dev.ahead,
        z: s.position.z + (fz / h) * C.dev.ahead,
        axis: heading + Math.PI / 2,
      };
    }
    return fitRoute(r, map.center.x, map.center.z, C.arena.soft, C.size.length / 2);
  }

  /** 飛行の途中から出す（遅延チャンクの読み込みが飛行の始めに間に合わなかったとき） */
  startLate(): void {
    this.start();
    this.lateStart = true;
  }

  step(dt: number): void {
    if (!this.running) return;
    const s = this.play.session;
    for (const t of this.minionTargets) t.beginStep();
    const k = this.kaiju;
    k.step(dt, { position: s.aircraft.state.position, active: s.player.active }, (kind, damage) => {
      if (!s.player.active) return;
      this.taken[kind]++;
      s.combat.dealDamage(s.player, damage, TEAM_ENEMY);
    });
    for (const t of this.partTargets) t.place();
  }
}

/** GamePlay に付ける（アルビオンの遅延チャンクから） */
export function attachAlbionDev(
  play: GamePlay,
  options: AlbionDevOptions,
  env: AlbionDevEnv,
): AlbionDev {
  const dev = new AlbionDev(play, options, env);
  attachFreeExtra(play, dev);
  return dev;
}
