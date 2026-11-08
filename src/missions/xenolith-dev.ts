// 10-5a: 確かめる場（?dev=xenolith）の判定の側（Three.js・DOM 非依存）: フリーフライトに UFO ゼノリスだけを出す。
// GamePlay の差し込み口（free-extra.ts）に付け、飛行の始めのシードから怪獣の種を作るので、リプレイでも同じに動く。
// 部位は CombatSystem の撃てる対象の末尾に足す（機銃・ミサイルで減らせる。バリアの間は殻の中に効かない。フリーフライトでは倒れない:
// 体力は 1% で止める）。光線は自機に当たる。体は通り抜けられない（10-5b から 10-4c の扱い: 最大 HP の約 8 割・弾かない）。
// 10-5b: ソロのレイド（ミッション raidXenolith）も引き受ける（体力・制限時間・撃破は xenolith-raid.ts）
import { RamGrace, ramDamage } from '../combat/kaiju-ram';
import { TEAM_ENEMY } from '../combat/target';
import { XENOLITH_CONFIG as C, XENOLITH_PARTS } from '../data/xenolith';
import type { MapDef } from '../data/maps';
import type { XenolithKaiju } from '../ai/xenolith-ai';
import { createHullContact } from '../ai/albion-hull';
import { xenolithContact } from '../ai/xenolith-hull';
import type { Vec3 } from '../flight/math';
import type { XenolithGround } from '../entities/xenolith/xenolith-body';
import {
  createXenolithTargets,
  type XenolithPartTarget,
} from '../entities/xenolith/xenolith-target';
import { XENOLITH_RAID_CONFIG } from '../data/xenolith-raid';
import { raidWorld } from './albion-world';
import { attachFreeExtra, type FreeExtra } from './free-extra';
import type { GamePlay } from './game-play';
import type { MissionDef } from './types';
import type { MissionWorld } from './world';
import { XENOLITH_ID } from './xenolith-mission';
import { XenolithRaid } from './xenolith-raid';

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
  /** 10-5b: フリーフライトにも出す（?dev=xenolith の確かめる場だけ。省略は true） */
  readonly freeFlight?: boolean;
}

/** 動かしている場面: 止めている / フリーフライト（確かめる場）/ ソロのレイド */
export type XenolithMode = 'off' | 'free' | 'raid';

/** 10-5b: レイドで出す位置（開始位置の前方・少し上。自機の方を向く。戦域の内側） */
export function raidSpawnPoint(
  start: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly headingDeg: number;
  },
  center: { readonly x: number; readonly z: number },
): { x: number; y: number; z: number; heading: number } {
  const h = (start.headingDeg * Math.PI) / 180;
  const S = XENOLITH_RAID_CONFIG.spawn;
  let x = start.x - Math.sin(h) * S.ahead;
  let z = start.z - Math.cos(h) * S.ahead;
  const dx = x - center.x;
  const dz = z - center.z;
  const r = Math.hypot(dx, dz);
  if (r > C.arena.soft) {
    x = center.x + (dx * C.arena.soft) / r;
    z = center.z + (dz * C.arena.soft) / r;
  }
  return {
    x,
    y: start.y + S.up,
    z,
    heading: Math.atan2(-(start.x - x), -(start.z - z)),
  };
}

export class XenolithDev implements FreeExtra {
  readonly raid: XenolithRaid;
  readonly partTargets: readonly XenolithPartTarget[];
  private seed = 1;
  mode: XenolithMode = 'off';
  /** 飛行の途中から出した（読み込みが遅れた。リプレイの記録と合わない） */
  lateStart = false;
  /** 自機が受けた当たりの数え（値の表示・ボット）: なぎ払い・溜め撃ち・光の弾・体への衝突 */
  readonly taken = { sweep: 0, charged: 0, orbs: 0, body: 0 };
  /** 体への衝突の後、続けて当たらない残り秒 */
  /** 10-4c: 体への衝突の「続けて当たらない」間（共通の部品） */
  readonly ram = new RamGrace();
  private readonly contact = createHullContact();
  private readonly velocity = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly play: GamePlay,
    private readonly options: XenolithDevOptions,
    private readonly env: XenolithDevEnv,
  ) {
    this.raid = new XenolithRaid(env.ground);
    this.partTargets = createXenolithTargets(this.raid);
  }

  get kaiju(): XenolithKaiju {
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
    this.kaiju.clearOrbs();
  }

  start(): void {
    if (this.env.freeFlight === false) {
      this.stop();
      return;
    }
    this.mode = 'free';
    this.lateStart = false;
    this.raid.reset(false, 'normal');
    const st = this.play.session.aircraft.state;
    // 自機の前方 ahead m・少し上に出し、自機の方を向く
    const q = st.orientation;
    const fx = -2 * (q.x * q.z + q.w * q.y);
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const h = Math.hypot(fx, fz) || 1;
    const x = st.position.x + (fx / h) * C.dev.ahead;
    const z = st.position.z + (fz / h) * C.dev.ahead;
    const heading = Math.atan2(-(st.position.x - x), -(st.position.z - z));
    this.spawn(
      x,
      st.position.y + 100,
      z,
      heading,
      this.options.hpPercent / 100,
      this.options.broken,
    );
  }

  /** 10-5b: ゼノリスのレイドなら引き受ける（体力・難易度・出す位置）。ランナーが読む世界を返す */
  startMission(def: MissionDef): MissionWorld | null {
    const r = def.reward.raid;
    if (r?.kaiju !== XENOLITH_ID) return null;
    this.mode = 'raid';
    this.lateStart = false;
    this.raid.reset(true, r.difficulty);
    const at = raidSpawnPoint(def.start, this.env.map().center);
    this.spawn(at.x, at.y, at.z, at.heading, 1, []);
    return raidWorld(this.play, this.raid);
  }

  private spawn(
    x: number,
    y: number,
    z: number,
    heading: number,
    hpRatio: number,
    broken: readonly string[],
  ): void {
    const s = this.play.session;
    // 飛行ごとに撃てる対象へ足す（同じ物は 1 回だけ。飛行を始め直すと対象の一覧が作り直される）
    s.combat.addTargets(this.partTargets);
    for (const t of this.partTargets) t.hits = 0;
    this.raid.spawn(x, y, z, heading, this.seed, this.env.map().center, hpRatio, broken);
    for (const t of this.partTargets) t.place(true);
    for (const key of Object.keys(this.taken) as (keyof typeof this.taken)[]) this.taken[key] = 0;
    this.ram.clear();
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
    // 自機の速度（前のステップの位置との差から。光の弾の見越し）
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
    this.raid.step(dt, me, (attack, damage) => {
      if (!s.player.active) return;
      this.taken[attack]++;
      this.raid.count(attack);
      s.combat.dealDamage(s.player, damage, TEAM_ENEMY);
    });
    for (const t of this.partTargets) t.place(false, dt);
    this.collide(dt);
  }

  /**
   * 体への衝突（10-4c の共通の扱い。10-5b で先に入れた）: 最大 HP の約 8 割のダメージ（足りなければ撃墜）。跳ねない。続けて当たらない間がある。
   * 倒した後と撃墜されている間は無し
   */
  private collide(dt: number): void {
    this.ram.tick(dt);
    const s = this.play.session;
    const k = this.kaiju;
    if (!s.player.active || this.raid.dead || k.parts.dead || !k.body.visible) return;
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
    if (!this.ram.hit(0)) return;
    this.taken.body++;
    this.raid.bodyTaken++;
    const p = a.state.position;
    s.combat.ramListeners.report(p.x, p.y, p.z);
    s.combat.dealDamage(s.player, ramDamage(s.player.maxHp), TEAM_ENEMY);
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
