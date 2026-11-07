// 10-3a: 確かめる場（?dev=albion）の判定の側（Three.js・DOM 非依存）: フリーフライトに白鯨アルビオンだけを出す。
// GamePlay の差し込み口（free-extra.ts）に付け、飛行の始めのシードから怪獣の種を作るので、リプレイでも同じに動く。
// 部位と子分は CombatSystem の撃てる対象の末尾に足す（機銃・ミサイルで減らせる。フリーフライトでは倒れない: 体力は 1% で止める）。
// 10-3b: ソロのレイド（ミッション raidAlbion）も引き受ける（体力・制限時間・撃破は albion-raid.ts）。雲の中はロックの距離が縮む
import { TEAM_ENEMY } from '../combat/target';
import { ALBION_CONFIG as C, ALBION_PARTS } from '../data/albion';
import type { MapDef } from '../data/maps';
import type { AlbionKaiju } from '../ai/albion-ai';
import { inCloud } from '../ai/albion-attacks';
import { createHullContact, hullContact } from '../ai/albion-hull';
import { bounceAircraft } from '../entities/albion/albion-bounce';
import type { Vec3 } from '../flight/math';
import type { AlbionGround } from '../entities/albion/albion-body';
import { fitRoute, nearestOnRoute, type AlbionRoute } from '../entities/albion/albion-route';
import {
  createAlbionTargets,
  type AlbionMinionTarget,
  type AlbionPartTarget,
} from '../entities/albion/albion-target';
import { ALBION_ID } from './albion-mission';
import { AlbionRaid } from './albion-raid';
import { CloudLock, raidWorld } from './albion-world';
import { attachFreeExtra, type FreeExtra } from './free-extra';

export { CloudLock } from './albion-world';
import type { GamePlay } from './game-play';
import type { MissionDef } from './types';
import type { MissionWorld } from './world';

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
  /** 10-3b: フリーフライトにも出す（?dev=albion の確かめる場だけ。省略は true） */
  readonly freeFlight?: boolean;
}

/** 動かしている場面: 止めている / フリーフライト（確かめる場）/ ソロのレイド */
export type AlbionMode = 'off' | 'free' | 'raid';

/** 港湾都市の湾の周回路（レイド・?abroute=bay） */
export function bayRoute(center: { readonly x: number; readonly z: number }): AlbionRoute {
  const b = C.bayRoute;
  const r: AlbionRoute = {
    halfLength: C.route.halfLength,
    turnRadius: C.route.turnRadius,
    x: b.x,
    z: b.z,
    axis: (b.axisDeg * Math.PI) / 180,
  };
  return fitRoute(r, center.x, center.z, C.arena.soft, C.size.length / 2);
}

export class AlbionDev implements FreeExtra {
  readonly raid: AlbionRaid;
  readonly partTargets: readonly AlbionPartTarget[];
  readonly minionTargets: readonly AlbionMinionTarget[];
  private seed = 1;
  mode: AlbionMode = 'off';
  /** 飛行の途中から出した（読み込みが遅れた。リプレイの記録と合わない） */
  lateStart = false;
  /** 自機が受けた当たりの数え（値の表示・ボット）。10-3c: 人を狙う攻撃と体への衝突 body */
  readonly taken = {
    spout: 0,
    slam: 0,
    cloud: 0,
    ram: 0,
    geyser: 0,
    sonar: 0,
    roll: 0,
    call: 0,
    body: 0,
  };
  /** 10-3c: 体への衝突の後、続けて当たらない残り秒 */
  bodyGrace = 0;
  private readonly contact = createHullContact();
  /** 雲の外のロックの決まり（雲の中は距離を縮める。止めたら戻す） */
  private readonly cloud = new CloudLock();
  private readonly velocity = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly play: GamePlay,
    private readonly options: AlbionDevOptions,
    private readonly env: AlbionDevEnv,
  ) {
    this.raid = new AlbionRaid(env.ground);
    const t = createAlbionTargets(this.raid);
    this.partTargets = t.parts;
    this.minionTargets = t.minions;
  }

  get kaiju(): AlbionKaiju {
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

  /** 自機の位置（値の表示） */
  get playerPosition(): Readonly<Vec3> {
    return this.play.session.aircraft.state.position;
  }

  /** 自機が雲の中か */
  get inCloud(): boolean {
    return (
      this.active &&
      this.kaiju.cloudLeft > 0 &&
      this.kaiju.body.visible &&
      inCloud(this.kaiju.body, this.playerPosition)
    );
  }

  reseed(seed: number): void {
    this.seed = (seed ^ C.dev.seedSalt) >>> 0;
  }

  stop(): void {
    this.cloud.restore(this.play.session.combat.targeting);
    this.mode = 'off';
    this.kaiju.body.visible = false;
    this.kaiju.swarm.clear();
  }

  start(): void {
    if (this.env.freeFlight === false) {
      this.stop();
      return;
    }
    this.mode = 'free';
    this.lateStart = false;
    this.raid.reset(false, 'normal');
    this.spawn(this.routeFor(), this.options.hpPercent / 100, this.options.broken);
  }

  /** 10-3b: アルビオンのレイドなら引き受ける（体力・難易度・出す位置）。ランナーが読む世界を返す */
  startMission(def: MissionDef): MissionWorld | null {
    const r = def.reward.raid;
    if (r?.kaiju !== ALBION_ID) return null;
    this.mode = 'raid';
    this.lateStart = false;
    this.raid.reset(true, r.difficulty);
    this.spawn(bayRoute(this.env.map().center), 1, []);
    return raidWorld(this.play, this.raid);
  }

  private spawn(route: AlbionRoute, hpRatio: number, broken: readonly string[]): void {
    const s = this.play.session;
    // 飛行ごとに撃てる対象へ足す（同じ物は 1 回だけ。飛行を始め直すと対象の一覧が作り直される）
    s.combat.addTargets([...this.partTargets, ...this.minionTargets]);
    for (const t of this.partTargets) t.hits = 0;
    this.cloud.begin(s.combat.targeting);
    const a = s.aircraft.state.position;
    // 周回路の上の、自機に一番近い所から（横切る姿が正面に見える）
    const start = nearestOnRoute(route, a.x, a.z);
    this.raid.spawn(route, start, this.seed, this.env.map().center, hpRatio, broken);
    for (const t of this.partTargets) t.place(true);
    for (const t of this.minionTargets) t.beginStep();
    for (const key of Object.keys(this.taken) as (keyof typeof this.taken)[]) this.taken[key] = 0;
    this.bodyGrace = 0;
  }

  /** 周回路: 自機の前方 ahead m を中心に、自機の向きに直角（?abroute=bay なら湾の周回路）。戦域の内側に寄せる */
  routeFor(): AlbionRoute {
    const map = this.env.map();
    if (this.options.bay && map.id === 'harbor') return bayRoute(map.center);
    const s = this.play.session.aircraft.state;
    const q = s.orientation;
    const fx = -2 * (q.x * q.z + q.w * q.y);
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const h = Math.hypot(fx, fz) || 1;
    const heading = Math.atan2(-fx / h, -fz / h);
    const r: AlbionRoute = {
      halfLength: C.route.halfLength,
      turnRadius: C.route.turnRadius,
      x: s.position.x + (fx / h) * C.dev.ahead,
      z: s.position.z + (fz / h) * C.dev.ahead,
      axis: heading + Math.PI / 2,
    };
    return fitRoute(r, map.center.x, map.center.z, C.arena.soft, C.size.length / 2);
  }

  /** 飛行の途中から出す（遅延チャンクの読み込みが飛行の始めに間に合わなかったとき） */
  startLate(): void {
    this.start();
    this.lateStart = true;
  }

  step(dt: number): void {
    if (this.mode === 'off') return;
    const s = this.play.session;
    for (const t of this.minionTargets) t.beginStep();
    // 自機の速度（前のステップの位置との差から。子分の見越し）
    const a = s.aircraft;
    if (dt > 0) {
      this.velocity.x = (a.state.position.x - a.prevPosition.x) / dt;
      this.velocity.y = (a.state.position.y - a.prevPosition.y) / dt;
      this.velocity.z = (a.state.position.z - a.prevPosition.z) / dt;
    }
    const me = { position: a.state.position, velocity: this.velocity, active: s.player.active };
    this.raid.step(dt, me, (kind, damage) => {
      if (!s.player.active) return;
      this.taken[kind]++;
      if (kind === 'geyser' || kind === 'sonar' || kind === 'roll' || kind === 'call')
        this.raid.aimedTaken++;
      s.combat.dealDamage(s.player, damage, TEAM_ENEMY);
    });
    this.collide(dt);
    for (const t of this.partTargets) t.place();
    this.cloud.apply(s.combat.targeting, this.inCloud);
  }

  /**
   * 10-3c: 体への衝突（このステップの移動の線分が体にめり込んだら）: 弾く・ダメージ・短い操作不能。続けて当たらない間がある。
   * 倒した後（海へ落ちる間）と撃墜されている間は無し
   */
  private collide(dt: number): void {
    this.bodyGrace = Math.max(0, this.bodyGrace - dt);
    const s = this.play.session;
    const k = this.kaiju;
    if (!s.player.active || this.raid.dead || !k.body.visible) return;
    const a = s.aircraft;
    const B = C.collision;
    if (
      !hullContact(k.body, a.prevPosition, a.state.position, B.margin, B.sampleStep, this.contact)
    )
      return;
    bounceAircraft(a, this.contact);
    if (this.bodyGrace > 0) return;
    this.bodyGrace = B.invulnerable;
    this.taken.body++;
    this.raid.bodyTaken++;
    s.kaijuExposure.applyStun(B.stun);
    s.combat.dealDamage(s.player, B.damage * k.damageScale, TEAM_ENEMY);
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
