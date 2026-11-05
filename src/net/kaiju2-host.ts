// 9-6c: 協力レイドのネフィルガのホスト側。ヴォルガスの RaidHost と同じ仕組み: 怪獣（Kaiju2Raid）をホストで動かし、部位を
// PvpArena の機銃・ミサイルの対象に入れる（攻撃した人の ID 付き）。攻撃は「狙う人」1 人に向け、当たりとスタンはその人に
// PvpArena から入れる（ほかの人には当たらない: 人数が増えても 1 人より危なくならない）。狙う人は巡航の間に 2 秒ごと、
// いちばん近い人に選び直す（今の人がいちばん近い人の 1.25 倍の距離までなら変えない）。全体 HP は人数で増やす（coopHpScale）。
// state に入れる状態（位置・向き・段階・攻撃と予兆・部位の体力・止まり木・雷球）を作り、倒した（成功）・嵐 / 全体の時間切れ（失敗）で
// 終わりを知らせる。Three.js 非依存
import type { PvpArena } from '../combat/pvp-arena';
import type { PvpFighter } from '../combat/pvp-fighter';
import { KAIJU2_ATTACKS, KAIJU2_CONFIG, KAIJU2_PARTS, KAIJU2_STATES } from '../data/kaiju2';
import { KAIJU2_RAID_CONFIG as R } from '../data/kaiju2-raid';
import type { RaidDifficulty } from '../data/raid';
import { LOCAL_FORWARD } from '../flight/flight-model';
import { quatIdentity, rotateVec3, vec3, type Vec3 } from '../flight/math';
import { headingQuat } from '../entities/enemy-aircraft';
import { Kaiju2Raid, aimedAt } from '../missions/kaiju2-raid';
import type { Kaiju2OrbMsg, Kaiju2StateMsg } from './codec-kaiju2';
import { NO_TARGET } from './net-controls';
import { NO_ATTACK } from './protocol';
import { RAID_OUTCOME } from './raid-host';

/** 9-6c: ネフィルガの失敗の理由（over の event の b。RAID_OUTCOME.fail と同じく「成功でない」） */
export const KAIJU2_OUTCOME = { stormFail: 3, totalFail: 4 } as const;

export interface Kaiju2HostOptions {
  /** 地表と建物の屋根の高さ（怪獣が避ける。省略は海面 0） */
  readonly ground?: (x: number, z: number) => number;
  readonly difficulty?: RaidDifficulty;
  /** 戦域の中心（港湾都市の中心） */
  readonly center?: { readonly x: number; readonly z: number };
  /** 出す位置の基準（開始位置と向き） */
  readonly start: Readonly<Vec3 & { headingDeg: number }>;
  /** 動きの乱数の種 */
  readonly seed: number;
}

export class Kaiju2Host {
  readonly raid: Kaiju2Raid;
  /** 狙っている人（いなければ -1） */
  focusId = -1;
  private focusTimer = 0;
  private readonly focus = { position: vec3(), velocity: vec3(), active: false };
  private readonly msg: Kaiju2StateMsg;
  private readonly orbPool: Kaiju2OrbMsg[];
  private readonly nose = vec3();

  constructor(
    private readonly arena: PvpArena,
    players: number,
    o: Kaiju2HostOptions,
  ) {
    this.raid = new Kaiju2Raid(o.ground ?? (() => 0), {
      hit: (_a, damage, stun) => {
        const id = this.focusId;
        if (id < 0) return;
        arena.kaijuDamage(id, damage);
        if (stun > 0) arena.stun(id, stun);
      },
    });
    const raid = this.raid;
    raid.reset(true, o.difficulty ?? 'normal', players);
    const k = raid.body;
    k.center.x = o.center?.x ?? 0;
    k.center.z = o.center?.z ?? 0;
    // 開始位置の前方（湾の上）に、開始位置の方を向けて出す（ソロと同じ距離・高さ）
    const fwd = rotateVec3(vec3(), headingQuat(quatIdentity(), o.start.headingDeg), LOCAL_FORWARD);
    const h = Math.hypot(fwd.x, fwd.z) || 1;
    let x = o.start.x + (fwd.x / h) * R.spawnAhead;
    let z = o.start.z + (fwd.z / h) * R.spawnAhead;
    const r = Math.hypot(x - k.center.x, z - k.center.z);
    const lim = KAIJU2_CONFIG.arena.soft;
    if (r > lim) {
      x = k.center.x + ((x - k.center.x) / r) * lim;
      z = k.center.z + ((z - k.center.z) / r) * lim;
    }
    raid.ai.spawn(x, R.spawnAltitude, z, Math.atan2(o.start.x - x, -(o.start.z - z)), o.seed >>> 0);
    k.attackCooldown = R.firstAttackDelay;
    raid.placeTargets();
    arena.setKaijuParts(raid.targets);
    this.orbPool = k.orbs.map((_, index) => ({ index, position: vec3(), velocity: vec3() }));
    this.msg = {
      visible: true,
      dead: false,
      phase: 1,
      timeUp: 0,
      state: 0,
      attack: NO_ATTACK,
      hard: raid.difficulty === 'hard',
      broken: 0,
      targetId: NO_TARGET,
      position: vec3(),
      forward: vec3(0, 0, -1),
      bank: 0,
      speed: 0,
      stateTime: 0,
      hp: 0,
      maxHp: 1,
      parts: KAIJU2_PARTS.map(() => 1),
      elapsed: 0,
      stormAt: null,
      shout: 0,
      flinch: 0,
      orbs: [],
    };
  }

  /** 固定ステップ 1 回分（全機を動かした後） */
  step(dt: number): void {
    this.chooseFocus(dt);
    const f = this.focusId >= 0 ? this.arena.fighters.get(this.focusId) : undefined;
    const t = this.focus;
    t.active = f?.active ?? false;
    if (f) {
      t.position.x = f.position.x;
      t.position.y = f.position.y;
      t.position.z = f.position.z;
      t.velocity.x = f.velocity.x;
      t.velocity.y = f.velocity.y;
      t.velocity.z = f.velocity.z;
    }
    // 9-6d: 狙われているか（いずれかの人の機首。いちばん近い人の射線から避ける）
    const k = this.raid.body;
    k.aimed = false;
    let aimD = Infinity;
    for (const g of this.arena.all) {
      if (!g.active) continue;
      const fwd = rotateVec3(this.nose, g.aircraft.state.orientation, LOCAL_FORWARD);
      const d = distance(g.position, k.position);
      if (d < aimD && aimedAt(k.position, g.position, fwd)) {
        aimD = d;
        k.aimed = true;
        k.aimFrom.x = g.position.x;
        k.aimFrom.y = g.position.y;
        k.aimFrom.z = g.position.z;
      }
    }
    this.raid.step(dt, t, this.arena.flares.flares);
    // 9-6d: 突風の押し流し（当てた人を流す。クライアントは自機の位置合わせでそろう）
    if (k.pushLeft > 0 && f?.active) {
      const g = KAIJU2_CONFIG.attacks.gust;
      const v = g.push * (k.pushLeft / g.pushSeconds) * dt;
      f.aircraft.state.position.x += k.pushX * v;
      f.aircraft.state.position.z += k.pushZ * v;
    }
  }

  /** 狙う人を選び直す（巡航の間だけ。攻撃の途中は変えない。狙っていた人が落ちた・抜けたらすぐ） */
  private chooseFocus(dt: number): void {
    const k = this.raid.body;
    this.focusTimer -= dt;
    const current = this.focusId >= 0 ? this.arena.fighters.get(this.focusId) : undefined;
    const lost = !current?.active;
    if (!lost && (k.state !== 'cruise' || this.focusTimer > 0)) return;
    this.focusTimer = R.coop.focusSeconds;
    let best: PvpFighter | null = null;
    let bestD = Infinity;
    for (const f of this.arena.all) {
      if (!f.active) continue;
      const d = distance(f.position, k.position);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    if (!best) {
      // 全員落ちている: 狙う人はそのまま（戻ってきたら選び直す）
      if (lost) this.focusTimer = 0;
      return;
    }
    if (current?.active && distance(current.position, k.position) <= bestD * R.coop.focusKeep)
      return;
    this.focusId = best.id;
  }

  /** 終わったか（成功 / 失敗の理由。続いていれば none） */
  get outcome(): number {
    const r = this.raid;
    if (r.dead) return RAID_OUTCOME.clear;
    if (r.timeUp === 'storm') return KAIJU2_OUTCOME.stormFail;
    if (r.timeUp === 'total') return KAIJU2_OUTCOME.totalFail;
    return RAID_OUTCOME.none;
  }

  /** 攻撃の対象（予兆・攻撃の間だけ。なしは null） */
  get targetId(): number | null {
    const s = this.raid.body.state;
    return this.focusId >= 0 && (s === 'windup' || s === 'attack') ? this.focusId : null;
  }

  /** 制限時間の残り（秒。成績の remainingSeconds） */
  get timeLeft(): number {
    return this.raid.timeLeft;
  }

  /** 成績のレイドの欄（部位別の与ダメージ。KAIJU2_TARGETS の順）と壊した部位の数 */
  scoreFields(id: number): { partDamage: number[]; breaks: number } {
    const row = this.raid.dealtBy[id & 3] ?? [];
    return {
      partDamage: row.map((v) => Math.round(v)),
      breaks: this.raid.breaksBy[id & 3] ?? 0,
    };
  }

  /** state に入れる状態（入れ物は使い回す） */
  state(): Kaiju2StateMsg {
    const r = this.raid;
    const k = r.body;
    const m = this.msg;
    m.visible = k.visible;
    m.dead = r.dead;
    m.phase = k.phase;
    m.timeUp = r.timeUp === 'storm' ? 1 : r.timeUp === 'total' ? 2 : 0;
    m.state = KAIJU2_STATES.indexOf(k.state);
    m.attack = k.attack ? KAIJU2_ATTACKS.indexOf(k.attack) : NO_ATTACK;
    m.broken = KAIJU2_PARTS.reduce((b, p, i) => (k.broken[p] ? b | (1 << i) : b), 0);
    m.targetId = this.targetId ?? NO_TARGET;
    copy(m.position, k.position);
    copy(m.forward, k.forward);
    m.bank = k.bank;
    m.speed = k.state === 'perched' ? 0 : k.speed;
    m.stateTime = k.stateTime;
    m.hp = r.hp;
    m.maxHp = r.maxHp;
    KAIJU2_PARTS.forEach((p, i) => {
      const t = r.targets.find((x) => x.id === p);
      m.parts[i] = t ? Math.max(0, Math.min(1, t.partHp / t.partMaxHp)) : 0;
    });
    m.elapsed = r.elapsed;
    m.stormAt = r.stormAt >= 0 ? r.stormAt : null;
    m.shout = r.shout;
    m.flinch = k.flinch;
    m.orbs.length = 0;
    k.orbs.forEach((o, i) => {
      const slot = this.orbPool[i];
      if (!o.active || !slot) return;
      copy(slot.position, o.position);
      copy(slot.velocity, o.velocity);
      m.orbs.push(slot);
    });
    return m;
  }
}

function distance(a: Readonly<Vec3>, b: Readonly<Vec3>): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function copy(out: Vec3, v: Readonly<Vec3>): void {
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
}
