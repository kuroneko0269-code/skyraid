// 10-5a: 確かめる場（?dev=xenolith）の判定の側（Three.js・DOM 非依存）: フリーフライトに UFO ゼノリスだけを出す。
// GamePlay の差し込み口（free-extra.ts）に付け、飛行の始めのシードから怪獣の種を作るので、リプレイでも同じに動く。
// 部位は CombatSystem の撃てる対象の末尾に足す（機銃・ミサイルで減らせる。バリアの間は殻の中に効かない。フリーフライトでは倒れない:
// 体力は 1% で止める）。光線は自機に当たる（数値は仮）。体は通り抜けられない（アルビオン・ゴウライと同じ: 弾く・ダメージ・短い操作不能）
import { TEAM_ENEMY } from '../combat/target';
import { XENOLITH_CONFIG as C, XENOLITH_PARTS } from '../data/xenolith';
import type { MapDef } from '../data/maps';
import { XenolithKaiju } from '../ai/xenolith-ai';
import { createHullContact } from '../ai/albion-hull';
import { xenolithContact } from '../ai/xenolith-hull';
import { bounceAircraft } from '../entities/albion/albion-bounce';
import type { Vec3 } from '../flight/math';
import type { XenolithGround } from '../entities/xenolith/xenolith-body';
import {
  createXenolithTargets,
  type XenolithPartTarget,
} from '../entities/xenolith/xenolith-target';
import { attachFreeExtra, type FreeExtra } from './free-extra';
import type { GamePlay } from './game-play';

/** URL で決める始めの状態（?xnhp=<1〜100>・?xnbreak=gen0,emitter1）。再生でも同じ URL なら同じになる */
export interface XenolithDevOptions {
  readonly hpPercent: number;
  readonly broken: readonly string[];
}

export function parseXenolithOptions(search: string): XenolithDevOptions {
  const params = new URLSearchParams(search);
  const hp = Number(params.get('xnhp') ?? '100');
  const broken = (params.get('xnbreak') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== 'hull' && (XENOLITH_PARTS as readonly string[]).includes(s));
  return {
    hpPercent: Number.isFinite(hp) ? Math.max(1, Math.min(100, hp)) : 100,
    broken: [...new Set(broken)],
  };
}

export interface XenolithDevEnv {
  readonly ground: XenolithGround;
  readonly map: () => Pick<MapDef, 'center' | 'id'>;
}

export class XenolithDev implements FreeExtra {
  readonly kaiju: XenolithKaiju;
  readonly partTargets: readonly XenolithPartTarget[];
  private seed = 1;
  private running = false;
  /** 飛行の途中から出した（読み込みが遅れた。リプレイの記録と合わない） */
  lateStart = false;
  /** 自機が受けた当たりの数え（値の表示）: なぎ払い・溜め撃ち・体への衝突 */
  readonly taken = { sweep: 0, charged: 0, body: 0 };
  /** 体への衝突の後、続けて当たらない残り秒 */
  bodyGrace = 0;
  private readonly contact = createHullContact();

  constructor(
    private readonly play: GamePlay,
    private readonly options: XenolithDevOptions,
    private readonly env: XenolithDevEnv,
  ) {
    this.kaiju = new XenolithKaiju(env.ground);
    // フリーフライトでは倒れない（体力は 1% で止まる）
    this.kaiju.immortal = true;
    this.partTargets = createXenolithTargets(this);
  }

  damageSphere(sphere: number, amount: number, attacker = 0): boolean {
    return this.kaiju.damageSphere(sphere, amount, attacker);
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
  }

  start(): void {
    this.running = true;
    this.lateStart = false;
    const s = this.play.session;
    // 飛行ごとに撃てる対象へ足す（同じ物は 1 回だけ。飛行を始め直すと対象の一覧が作り直される）
    s.combat.addTargets(this.partTargets);
    for (const t of this.partTargets) t.hits = 0;
    const map = this.env.map();
    // 自機の前方 ahead m・少し上に出し、自機の方を向く
    const st = s.aircraft.state;
    const q = st.orientation;
    const fx = -2 * (q.x * q.z + q.w * q.y);
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const h = Math.hypot(fx, fz) || 1;
    const x = st.position.x + (fx / h) * C.dev.ahead;
    const z = st.position.z + (fz / h) * C.dev.ahead;
    const heading = Math.atan2(-(st.position.x - x), -(st.position.z - z));
    this.kaiju.body.arenaX = map.center.x;
    this.kaiju.body.arenaZ = map.center.z;
    this.kaiju.spawn(
      x,
      st.position.y + 100,
      z,
      heading,
      this.seed,
      this.options.hpPercent / 100,
      this.options.broken,
    );
    for (const t of this.partTargets) t.place(true);
    this.taken.sweep = 0;
    this.taken.charged = 0;
    this.taken.body = 0;
    this.bodyGrace = 0;
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
    this.kaiju.step(dt, me, (attack, damage) => {
      if (!s.player.active) return;
      this.taken[attack]++;
      s.combat.dealDamage(s.player, damage, TEAM_ENEMY);
    });
    for (const t of this.partTargets) t.place(false, dt);
    this.collide(dt);
  }

  /** 体への衝突（アルビオン・ゴウライと同じ扱い）: 弾く・ダメージ・短い操作不能。続けて当たらない間がある */
  private collide(dt: number): void {
    this.bodyGrace = Math.max(0, this.bodyGrace - dt);
    const s = this.play.session;
    const k = this.kaiju;
    if (!s.player.active || k.parts.dead || !k.body.visible) return;
    const a = s.aircraft;
    const B = C.collision;
    if (
      !xenolithContact(
        k.body.prevPosition,
        k.body.position,
        a.prevPosition,
        a.state.position,
        B.margin,
        B.sampleStep,
        this.contact,
      )
    )
      return;
    bounceAircraft(a, this.contact, B);
    if (this.bodyGrace > 0) return;
    this.bodyGrace = B.invulnerable;
    this.taken.body++;
    s.kaijuExposure.applyStun(B.stun);
    s.combat.dealDamage(s.player, B.damage * k.damageScale, TEAM_ENEMY);
  }
}

/** GamePlay に付ける（ゼノリスの遅延チャンクから） */
export function attachXenolithDev(
  play: GamePlay,
  options: XenolithDevOptions,
  env: XenolithDevEnv,
): XenolithDev {
  const dev = new XenolithDev(play, options, env);
  attachFreeExtra(play, dev);
  return dev;
}
