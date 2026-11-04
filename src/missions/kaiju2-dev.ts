// 9-6a: 確かめる場（?dev=kaiju2）の判定の側（Three.js・DOM 非依存）: フリーフライトに空の怪獣ネフィルガだけを出す。
// GamePlay の差し込み口（free-extra.ts）に付け、飛行の始めのシードから怪獣の種を作るので、リプレイでも同じに動く。
// 当たり（数値は仮）は自機に入れる（ダメージ・突風の操作不能は咆哮のスタンの仕組み）
import { TEAM_ENEMY } from '../combat/target';
import { KAIJU2_CONFIG, KAIJU2_DEV_CONFIG, KAIJU2_PARTS, type Kaiju2Part } from '../data/kaiju2';
import type { MapDef } from '../data/maps';
import { Kaiju2Ai, type Kaiju2Target } from '../ai/kaiju2-ai';
import { SkyKaiju } from '../entities/kaiju2/sky-kaiju';
import { vec3, type Vec3 } from '../flight/math';
import { attachFreeExtra, type FreeExtra } from './free-extra';
import type { GamePlay } from './game-play';

/** URL で決める始めの状態（?k2hp=<0〜100>・?k2break=wingL,tail）。再生でも同じ URL なら同じになる */
export interface Kaiju2DevOptions {
  readonly hpPercent: number;
  readonly broken: readonly Kaiju2Part[];
}

export function parseKaiju2Options(search: string): Kaiju2DevOptions {
  const params = new URLSearchParams(search);
  const hp = Number(params.get('k2hp') ?? '100');
  const broken = (params.get('k2break') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Kaiju2Part => (KAIJU2_PARTS as readonly string[]).includes(s));
  return {
    hpPercent: Number.isFinite(hp) ? Math.max(1, Math.min(100, hp)) : 100,
    broken: [...new Set(broken)],
  };
}

/** 今のマップ（戦域の中心）と、怪獣が避ける高さ（地表と建物の屋根） */
export interface Kaiju2DevEnv {
  readonly ground: (x: number, z: number) => number;
  readonly map: () => Pick<MapDef, 'center'>;
}

export class Kaiju2Dev implements FreeExtra {
  readonly body: SkyKaiju;
  readonly ai: Kaiju2Ai;
  private readonly target: Kaiju2Target & { position: { x: number; y: number; z: number } };
  private seed = 1;
  /** フリーフライトで動かしている（ほかのモードを始めたら止める） */
  private running = false;
  /** 飛行の途中から出した（読み込みが遅れた。リプレイの記録と合わない） */
  lateStart = false;
  /** 自機の速度（前のステップの位置との差から） */
  private readonly velocity = vec3();
  /** 走査の根（本体だけ。AI の hooks は関数なので入れない） */
  get stateRoot(): object {
    return this.body;
  }

  constructor(
    private readonly play: GamePlay,
    private readonly options: Kaiju2DevOptions,
    private readonly env: Kaiju2DevEnv,
  ) {
    const session = play.session;
    this.body = new SkyKaiju(env.ground);
    this.ai = new Kaiju2Ai(this.body, {
      hit: (_a, damage, stun) => {
        if (!session.player.active) return;
        session.combat.dealDamage(session.player, damage, TEAM_ENEMY);
        if (stun > 0) session.kaijuExposure.applyStun(stun);
      },
    });
    const a = session.aircraft;
    const velocity = this.velocity;
    this.target = {
      position: a.state.position,
      velocity,
      get active() {
        return session.player.active;
      },
    };
  }

  /** フリーフライトで出ている */
  get freeFlying(): boolean {
    const play = this.play;
    return (
      this.running &&
      play.runner === null &&
      play.race === null &&
      play.defense === null &&
      play.practice === null
    );
  }

  /** 自機の位置（値の表示） */
  get playerPosition(): Readonly<Vec3> {
    return this.target.position;
  }

  stop(): void {
    this.running = false;
  }

  reseed(seed: number): void {
    this.seed = (seed ^ KAIJU2_DEV_CONFIG.seedSalt) >>> 0;
  }

  /** フリーフライトの始め: 開始位置の前方に出す（戦域はそのマップ） */
  start(): void {
    this.running = true;
    this.lateStart = false;
    const s = this.play.session;
    const k = this.body;
    const map = this.env.map();
    k.center.x = map.center.x;
    k.center.z = map.center.z;
    for (const p of KAIJU2_PARTS) k.broken[p] = this.options.broken.includes(p);
    k.setHpRatio(this.options.hpPercent / 100);
    const p = s.aircraft.state.position;
    // 自機の水平の向き（前方 −Z を回した向き）の先に、自機の方を向けて出す
    const q = s.aircraft.state.orientation;
    const fx = -2 * (q.x * q.z + q.w * q.y);
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const h = Math.hypot(fx, fz) || 1;
    const d = KAIJU2_DEV_CONFIG.spawnAhead;
    let x = p.x + (fx / h) * d;
    let z = p.z + (fz / h) * d;
    const r = Math.hypot(x - map.center.x, z - map.center.z);
    const lim = KAIJU2_CONFIG.arena.soft;
    if (r > lim) {
      x = map.center.x + ((x - map.center.x) / r) * lim;
      z = map.center.z + ((z - map.center.z) / r) * lim;
    }
    const heading = Math.atan2(p.x - x, -(p.z - z));
    this.ai.spawn(x, KAIJU2_DEV_CONFIG.spawnAltitude, z, heading, this.seed);
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;
  }

  /** 飛行の途中から出す（遅延チャンクの読み込みが飛行の始めに間に合わなかったとき） */
  startLate(): void {
    this.start();
    this.lateStart = true;
  }

  step(dt: number): void {
    if (!this.running) return;
    const a = this.play.session.aircraft;
    if (dt > 0) {
      this.velocity.x = (a.state.position.x - a.prevPosition.x) / dt;
      this.velocity.y = (a.state.position.y - a.prevPosition.y) / dt;
      this.velocity.z = (a.state.position.z - a.prevPosition.z) / dt;
    }
    this.ai.step(dt, this.target, this.play.session.combat.flares.flares);
  }
}

/** GamePlay に付ける（?dev=kaiju2 の遅延チャンクから） */
export function attachKaiju2Dev(
  play: GamePlay,
  options: Kaiju2DevOptions,
  env: Kaiju2DevEnv,
): Kaiju2Dev {
  const dev = new Kaiju2Dev(play, options, env);
  attachFreeExtra(play, dev);
  return dev;
}
