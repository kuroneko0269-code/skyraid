// エフェクト（4-4）の窓口: 爆発（閃光・火球・黒煙）・墜落の水柱・被弾の煙と揺れ・敵機の損傷の煙・ミサイル発射の閃光と白煙・
// 対空砲のフラックを FxEvents から出す。追加の draw call は 火球 1・煙 1・水柱 1（陽炎 1 は自機のモデル）。
// 2-2 の起爆の閃光（missile-view.ts）はここの閃光に置き換えた
import type { Scene } from 'three';
import {
  EXPLOSION_SPECS,
  FLAK_CONFIG,
  HIT_FX_CONFIG,
  MISSILE_LAUNCH_FX_CONFIG as L,
} from '../../data/fx';
import type { EnemyAircraft } from '../../entities/enemy-aircraft';
import type { Vec3 } from '../../flight/math';
import { randomDirection } from '../particles';
import { ExplosionField } from './explosion';
import type { FxEvents } from './fx-events';
import { SmokeField } from './smoke-field';
import { WaterColumns } from './water-column';

const dir: Vec3 = { x: 0, y: 0, z: 0 };
/** 揺れを距離で減らす: この距離で半分 */
const SHAKE_HALF_DISTANCE = 250;

export class FxLink {
  readonly smoke = new SmokeField();
  readonly explosions: ExplosionField;
  readonly water: WaterColumns;
  private readonly trailTimers: number[];

  constructor(
    scene: Scene,
    events: FxEvents,
    private readonly enemies: readonly EnemyAircraft[],
    /** カメラの位置（爆発の揺れを距離で減らす） */
    camera: Readonly<Vec3>,
    /** カメラを揺らす（2-1 の地面衝突の揺れ 1.0 に対する強さ） */
    private readonly shake: (strength: number) => void,
  ) {
    this.explosions = new ExplosionField(this.smoke);
    this.water = new WaterColumns(this.smoke);
    this.trailTimers = enemies.map(() => 0);
    scene.add(this.explosions.fireballs, this.smoke.mesh, this.water.mesh);
    events.add({
      explosion: (x, y, z, scale) => {
        this.explosions.explode(x, y, z, scale);
        const d = Math.hypot(x - camera.x, y - camera.y, z - camera.z);
        const k = EXPLOSION_SPECS[scale].shake / (1 + (d / SHAKE_HALF_DISTANCE) ** 2);
        if (k > 0.02) this.shake(k);
      },
      splash: (x, y, z) => {
        this.water.spawn(x, y, z);
      },
      playerHit: () => {
        this.shake(HIT_FX_CONFIG.playerShake);
      },
      enemyHit: (x, y, z) => {
        const s = HIT_FX_CONFIG.hitPuff;
        this.smoke.emit(x, y, z, s, 0, 0, 0, 1.5);
      },
      missileLaunch: (x, y, z, dx, dy, dz) => {
        this.launch(x, y, z, dx, dy, dz);
      },
      flak: (x, y, z) => {
        this.flak(x, y, z);
      },
    });
  }

  /** 描画フレームごとに呼ぶ。dt は演出の時間（ポーズ中 0） */
  update(dt: number): void {
    this.updateTrails(dt);
    this.explosions.update(dt);
    this.water.update(dt);
    this.smoke.update(dt);
  }

  /** 演出を全部消す（飛行のやり直し） */
  reset(): void {
    this.explosions.clear();
    this.water.clear();
    this.smoke.clear();
    this.trailTimers.fill(0);
  }

  /** ミサイル発射: ノズル（尾部）の閃光と短い火球、後ろ向き + 横へ散る強い初速の白煙 */
  private launch(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    const back = 2;
    const nx = x - dx * back;
    const ny = y - dy * back;
    const nz = z - dz * back;
    this.explosions.flash(nx, ny, nz, L.flashSize);
    this.explosions.burst(nx, ny, nz, L.burstStart, L.burstEnd, 0.25);
    for (let i = 0; i < L.smokePuffs; i++) {
      randomDirection(dir);
      const v = L.smokeSpeed * (0.5 + Math.random() * 0.5);
      const s = L.smokeSpread;
      this.smoke.emit(
        nx,
        ny,
        nz,
        L.smoke,
        -dx * v + dir.x * s,
        -dy * v + dir.y * s,
        -dz * v + dir.z * s,
        0.5,
      );
    }
  }

  /** 対空砲のフラック: 小さな閃光と黒い玉 */
  private flak(x: number, y: number, z: number): void {
    const f = FLAK_CONFIG;
    this.explosions.flash(x, y, z, f.flashSize, 4);
    for (let i = 0; i < f.puffs; i++) {
      randomDirection(dir);
      const r = f.puffSpread;
      this.smoke.emit(
        x + dir.x * r,
        y + dir.y * r,
        z + dir.z * r,
        f.puff,
        dir.x * 3,
        dir.y * 3,
        dir.z * 3,
      );
    }
  }

  /** HP が trailBelowHp 以下の敵機は尾部から黒煙を曳く */
  private updateTrails(dt: number): void {
    if (dt <= 0) return;
    const c = HIT_FX_CONFIG;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e?.active || e.hp > e.maxHp * c.trailBelowHp) {
        this.trailTimers[i] = 0;
        continue;
      }
      let t = (this.trailTimers[i] ?? 0) + dt;
      if (t >= c.trailInterval) {
        t %= c.trailInterval;
        const p = e.position;
        const v = e.velocity;
        const len = Math.hypot(v.x, v.y, v.z) || 1;
        const o = c.trailOffset / len;
        this.smoke.emit(p.x - v.x * o, p.y - v.y * o, p.z - v.z * o, c.trail, 0, 0, 0, 1);
      }
      this.trailTimers[i] = t;
    }
  }
}
