// 演出（エフェクト・音。4-4）のきっかけを飛行の状態から拾う（Three.js 非依存）。ゲームの判定・数値には触れず、
// 戦闘のイベント（起爆・撃墜・命中）と、描画フレームごとの差分（発射の通し番号・弾数・対空砲の砲弾と自機の距離）を読む
import type { Bullet } from '../../combat/gun';
import { TEAM_PLAYER, type CombatTarget } from '../../combat/target';
import {
  FLAK_CONFIG,
  HIT_FX_CONFIG,
  WATER_COLUMN_CONFIG,
  type ExplosionScale,
} from '../../data/fx';
import type { FlightSession } from '../../missions/flight-session';
import { scaleForBlastRadius, scaleForTarget } from './explosion-scale';

/** 演出のきっかけ。位置はワールド（m） */
export interface FxListener {
  explosion?(x: number, y: number, z: number, scale: ExplosionScale): void;
  /** 海面への墜落 */
  splash?(x: number, y: number, z: number): void;
  playerHit?(x: number, y: number, z: number): void;
  enemyHit?(x: number, y: number, z: number): void;
  /** (dx, dy, dz) は発射の向き（単位ベクトル） */
  missileLaunch?(
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
    byPlayer: boolean,
  ): void;
  flak?(x: number, y: number, z: number): void;
  /** 自機の機銃がこのフレームに撃った弾の数 */
  playerGun?(shots: number): void;
  /** 自機の機銃の弾がこのフレームに対象に当たった数（4-12） */
  playerGunHit?(hits: number): void;
  /** 自機がこのフレームに敵側を撃墜した数（4-12。撃墜数 KILL が増えた分） */
  playerKill?(kills: number): void;
  enemyGun?(x: number, y: number, z: number): void;
  aaaFire?(x: number, y: number, z: number): void;
}

interface ShellState {
  traveled: number;
  dist: number;
  burst: boolean;
}

export class FxEvents {
  private readonly listeners: FxListener[] = [];
  private lastMissileSerial = -1;
  private lastGunShots = 0;
  private lastGunHits = 0;
  private lastKills = 0;
  private lastAaaShots = 0;
  private readonly enemyShots: number[];
  private readonly shells = new WeakMap<Bullet, ShellState>();

  constructor(
    private readonly session: FlightSession,
    private readonly groundHeight: (x: number, z: number) => number,
  ) {
    const combat = session.combat;
    this.enemyShots = session.enemies.map(() => 0);
    combat.onExplosion((x, y, z, _onTarget, radius) => {
      this.emit((l) => l.explosion?.(x, y, z, scaleForBlastRadius(radius)));
    });
    combat.onDestroyed(this.handleDestroyed);
    combat.onImpact(this.handleImpact);
    this.sync();
  }

  add(listener: FxListener): void {
    this.listeners.push(listener);
  }

  /** 今の弾数・通し番号を覚え直す（飛行のやり直し。前の飛行の差分を演出しない） */
  sync(): void {
    const s = this.session;
    this.lastGunShots = s.combat.gun.shotCount;
    this.lastGunHits = s.combat.gun.hitCount;
    this.lastKills = s.combat.kills;
    this.lastAaaShots = s.props.aaa.shotCount;
    const pool = s.combat.missiles.missiles;
    for (let i = 0; i < pool.count; i++)
      this.lastMissileSerial = Math.max(this.lastMissileSerial, pool.get(i).serial);
    for (let i = 0; i < this.enemyShots.length; i++)
      this.enemyShots[i] = s.squadron.gunShotCount(i);
  }

  /** 描画フレームごとに呼ぶ（飛行中だけ） */
  frame(): void {
    this.scanMissiles();
    this.scanGuns();
    this.scanAaa();
  }

  private emit(fn: (l: FxListener) => void): void {
    for (const l of this.listeners) fn(l);
  }

  private scanMissiles(): void {
    const pool = this.session.combat.missiles.missiles;
    let max = this.lastMissileSerial;
    for (let i = 0; i < pool.count; i++) {
      const m = pool.get(i);
      if (m.serial <= this.lastMissileSerial) continue;
      max = Math.max(max, m.serial);
      const v = m.velocity;
      const len = Math.hypot(v.x, v.y, v.z) || 1;
      const p = m.prevPosition;
      const byPlayer = m.owner === TEAM_PLAYER;
      this.emit((l) => l.missileLaunch?.(p.x, p.y, p.z, v.x / len, v.y / len, v.z / len, byPlayer));
    }
    this.lastMissileSerial = max;
  }

  private scanGuns(): void {
    const s = this.session;
    const shots = s.combat.gun.shotCount;
    if (shots > this.lastGunShots) {
      const n = shots - this.lastGunShots;
      this.emit((l) => l.playerGun?.(n));
    }
    this.lastGunShots = shots;
    const hits = s.combat.gun.hitCount;
    if (hits > this.lastGunHits) {
      const n = hits - this.lastGunHits;
      this.emit((l) => l.playerGunHit?.(n));
    }
    this.lastGunHits = hits;
    // 撃墜数は飛行のやり直しで 0 に戻る（減ったら数え直すだけ）
    const kills = s.combat.kills;
    if (kills > this.lastKills) {
      const n = kills - this.lastKills;
      this.emit((l) => l.playerKill?.(n));
    }
    this.lastKills = kills;
    for (let i = 0; i < this.enemyShots.length; i++) {
      const count = s.squadron.gunShotCount(i);
      const e = s.enemies[i];
      if (count > (this.enemyShots[i] ?? 0) && e?.active) {
        const p = e.position;
        this.emit((l) => l.enemyGun?.(p.x, p.y, p.z));
      }
      this.enemyShots[i] = count;
    }
  }

  /** 対空砲: 撃った音（最後に撃った砲弾の位置）と、自機のそばを通り過ぎる砲弾のフラック */
  private scanAaa(): void {
    const aaa = this.session.props.aaa;
    const pool = aaa.shells;
    if (aaa.shotCount > this.lastAaaShots && pool.count > 0) {
      const b = pool.get(pool.count - 1);
      this.emit((l) => l.aaaFire?.(b.x, b.y, b.z));
    }
    this.lastAaaShots = aaa.shotCount;
    const player = this.session.player;
    if (!player.active) return;
    const pp = player.position;
    const range = FLAK_CONFIG.burstRange;
    for (let i = 0; i < pool.count; i++) {
      const b = pool.get(i);
      let st = this.shells.get(b);
      // プールの弾は使い回すので、飛んだ距離が戻ったら別の砲弾
      if (!st || b.traveled < st.traveled) {
        st = { traveled: 0, dist: Infinity, burst: false };
        this.shells.set(b, st);
      }
      const d = Math.hypot(b.x - pp.x, b.y - pp.y, b.z - pp.z);
      if (!st.burst && st.dist < range && d > st.dist) {
        st.burst = true;
        this.emit((l) => l.flak?.(b.x, b.y, b.z));
      }
      st.dist = d;
      st.traveled = b.traveled;
    }
  }

  private readonly handleDestroyed = (t: CombatTarget): void => {
    const p = t.position;
    const scale = scaleForTarget(t);
    if (scale === 'aircraft') {
      const ground = this.groundHeight(p.x, p.z);
      if (p.y - ground <= WATER_COLUMN_CONFIG.crashAgl) {
        // 墜落: 海面（地表の高さ 0 以下）なら水柱、地面なら地面の高さで爆発
        if (ground <= 0.01) this.emit((l) => l.splash?.(p.x, 0, p.z));
        else this.emit((l) => l.explosion?.(p.x, ground, p.z, 'aircraft'));
        return;
      }
    }
    this.emit((l) => l.explosion?.(p.x, p.y, p.z, scale));
  };

  private readonly handleImpact = (x: number, y: number, z: number, onTarget: boolean): void => {
    if (!onTarget) return;
    const s = this.session;
    const margin = HIT_FX_CONFIG.playerHitMargin;
    const pl = s.player;
    if (near(pl, x, y, z, margin)) {
      this.emit((l) => l.playerHit?.(x, y, z));
      return;
    }
    for (const e of s.enemies) {
      if (near(e, x, y, z, margin)) {
        this.emit((l) => l.enemyHit?.(x, y, z));
        return;
      }
    }
    // PvP の他プレイヤー（5-3）
    for (const e of s.rivals) {
      if (near(e, x, y, z, margin)) {
        this.emit((l) => l.enemyHit?.(x, y, z));
        return;
      }
    }
  };

  /** 他プレイヤーの機銃の発射（PvP。5-3）: 敵機の発射と同じ位置付きの音 */
  otherGun(x: number, y: number, z: number): void {
    this.emit((l) => l.enemyGun?.(x, y, z));
  }
}

function near(t: CombatTarget, x: number, y: number, z: number, margin: number): boolean {
  const p = t.position;
  const r = t.hitRadius + margin;
  return (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2 <= r * r;
}
