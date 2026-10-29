// 射撃（2-1）の描画: 的・曳光弾・マズルフラッシュ・火花・撃墜の破片。
// 追加の draw call は 的 1 + 弾 1 + 火花 1 + 破片 1 + マズルフラッシュ 1 の最大 5（数によらない）
import {
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Object3D,
  type Scene,
} from 'three';
import type { CombatSystem } from '../combat/combat-system';
import { DEBRIS_CONFIG, MUZZLE_FLASH_CONFIG, SPARK_CONFIG } from '../data/effects';
import { TARGET_CONFIG } from '../data/targets';
import { GUN_CONFIG } from '../data/weapons';
import { vec3, type Vec3 } from '../flight/math';
import type { TargetBalloon } from '../entities/target-balloon';
import { ParticleSystem, randomDirection } from './particles';
import { TracerRenderer } from './tracers';

const WHITE = new Color(0xffffff);
const pos = new Vector3();
const scale = new Vector3();
const quat = new Quaternion();
const matrix = new Matrix4();
const color = new Color();
const dir = vec3();

export class CombatView {
  private readonly tracers: TracerRenderer;
  private readonly sparks: ParticleSystem;
  private readonly debris: ParticleSystem;
  private readonly balloons: InstancedMesh;
  private readonly flash: Mesh;
  private readonly baseColor = new Color(TARGET_CONFIG.color);
  private flashFrames = 0;
  private lastShotCount = 0;

  constructor(
    scene: Scene,
    aircraft: Object3D,
    private readonly combat: CombatSystem,
  ) {
    this.tracers = new TracerRenderer(combat.gun.bullets.capacity);
    const sparkMaterial = new MeshBasicMaterial({
      color: SPARK_CONFIG.color,
      fog: false,
      toneMapped: false,
    });
    this.sparks = new ParticleSystem(SPARK_CONFIG.max, sparkMaterial, {
      gravity: SPARK_CONFIG.gravity,
      shrinkFraction: 1,
      sizePerMeter: SPARK_CONFIG.sizePerMeter,
    });
    const debrisMaterial = new MeshStandardMaterial({ color: TARGET_CONFIG.color, roughness: 0.7 });
    this.debris = new ParticleSystem(DEBRIS_CONFIG.max, debrisMaterial, {
      gravity: DEBRIS_CONFIG.gravity,
      shrinkFraction: DEBRIS_CONFIG.shrinkFraction,
      sizePerMeter: 0,
    });

    const count = combat.targets.balloons.length;
    const balloonMaterial = new MeshStandardMaterial({ roughness: 0.45, metalness: 0.05 });
    this.balloons = new InstancedMesh(new SphereGeometry(1, 20, 14), balloonMaterial, count);
    this.balloons.instanceMatrix.setUsage(DynamicDrawUsage);
    this.balloons.frustumCulled = false;
    for (let i = 0; i < count; i++) this.balloons.setColorAt(i, this.baseColor);

    const f = MUZZLE_FLASH_CONFIG;
    this.flash = new Mesh(
      new SphereGeometry(1, 8, 6),
      new MeshBasicMaterial({
        color: f.color,
        toneMapped: false,
      }),
    );
    const m = GUN_CONFIG.muzzleOffset;
    // 楕円体の後ろ端が銃口に来るよう前へずらす
    this.flash.position.set(m.x, m.y, m.z - f.radius.z);
    this.flash.visible = false;
    aircraft.add(this.flash);

    scene.add(this.balloons, this.tracers.mesh, this.sparks.mesh, this.debris.mesh);
    combat.onImpact(this.spawnSparks);
    combat.onDestroyed(this.spawnDebris);
  }

  /** 描画フレームごとに呼ぶ。alpha は固定ステップの補間係数、frameSeconds はポーズ中 0 */
  update(alpha: number, frameSeconds: number, camera: Readonly<Vec3>): void {
    this.updateBalloons(alpha);
    this.tracers.update(this.combat.gun.bullets, alpha, camera);
    this.sparks.update(frameSeconds, camera);
    this.debris.update(frameSeconds, camera);
    this.updateFlash();
  }

  /** 演出を全部消す（フリーフライトのやり直し） */
  reset(): void {
    this.sparks.clear();
    this.debris.clear();
    this.flashFrames = 0;
    this.flash.visible = false;
    this.lastShotCount = this.combat.gun.shotCount;
  }

  private updateBalloons(alpha: number): void {
    const r = TARGET_CONFIG.visualRadius;
    let n = 0;
    for (const b of this.combat.targets.balloons) {
      if (b.isDestroyed) continue;
      const p = b.position;
      const q = b.prevPosition;
      pos.set(q.x + (p.x - q.x) * alpha, q.y + (p.y - q.y) * alpha, q.z + (p.z - q.z) * alpha);
      // 縦に少し長い風船形
      scale.set(r, r * 1.15, r);
      this.balloons.setMatrixAt(n, matrix.compose(pos, quat.identity(), scale));
      const flash = b.flashTimer > 0 ? 0.75 : 0;
      this.balloons.setColorAt(n, color.copy(this.baseColor).lerp(WHITE, flash));
      n++;
    }
    this.balloons.count = n;
    this.balloons.visible = n > 0;
    this.balloons.instanceMatrix.needsUpdate = true;
    if (this.balloons.instanceColor) this.balloons.instanceColor.needsUpdate = true;
  }

  private updateFlash(): void {
    const shots = this.combat.gun.shotCount;
    if (shots !== this.lastShotCount) {
      this.lastShotCount = shots;
      this.flashFrames = MUZZLE_FLASH_CONFIG.frames;
      const f = MUZZLE_FLASH_CONFIG;
      const k = 1 + (Math.random() * 2 - 1) * f.jitter;
      this.flash.scale.set(f.radius.x * k, f.radius.y * k, f.radius.z * k);
      this.flash.rotation.z = Math.random() * Math.PI;
    }
    this.flash.visible = this.flashFrames > 0;
    if (this.flashFrames > 0) this.flashFrames--;
  }

  private readonly spawnSparks = (x: number, y: number, z: number, onTarget: boolean): void => {
    const c = SPARK_CONFIG;
    const n = onTarget ? c.perTargetHit : c.perGroundHit;
    for (let i = 0; i < n; i++) {
      const p = this.sparks.spawn(c.lifeMin + Math.random() * (c.lifeMax - c.lifeMin));
      if (!p) return;
      randomDirection(dir);
      const speed = c.speedMin + Math.random() * (c.speedMax - c.speedMin);
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = dir.x * speed;
      // 地面では上向きに跳ねる
      p.vy = (onTarget ? dir.y : Math.abs(dir.y)) * speed;
      p.vz = dir.z * speed;
      p.sx = p.sy = p.sz = c.size;
    }
  };

  private readonly spawnDebris = (target: TargetBalloon): void => {
    const c = DEBRIS_CONFIG;
    const n = c.countMin + Math.floor(Math.random() * (c.countMax - c.countMin + 1));
    const t = target.position;
    const r = TARGET_CONFIG.visualRadius;
    for (let i = 0; i < n; i++) {
      const p = this.debris.spawn(c.life);
      if (!p) return;
      randomDirection(dir);
      const speed = c.speedMin + Math.random() * (c.speedMax - c.speedMin);
      // 的の表面あたりから外へ飛ばす
      p.x = t.x + dir.x * r * 0.6;
      p.y = t.y + dir.y * r * 0.6;
      p.z = t.z + dir.z * r * 0.6;
      p.vx = dir.x * speed;
      p.vy = dir.y * speed + c.upBoost;
      p.vz = dir.z * speed;
      p.sx = rand(c.sizeMin, c.sizeMax);
      p.sy = rand(c.sizeMin, c.sizeMax) * 0.4;
      p.sz = rand(c.sizeMin, c.sizeMax);
      p.wx = rand(-c.spinMax, c.spinMax);
      p.wy = rand(-c.spinMax, c.spinMax);
      p.wz = rand(-c.spinMax, c.spinMax);
    }
  };
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
