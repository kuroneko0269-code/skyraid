// 建物が崩れる演出（6-4）: 粉塵（灰色の煙の玉が広がる。SmokeTrail を流用）と破片（箱が飛び散って落ちる。ParticleSystem）。
// draw call は合わせて 2。BuildingField の崩れの知らせで出す
import { MeshStandardMaterial, type InstancedMesh } from 'three';
import type { BuildingField, CollapseEvent } from '../../combat/buildings';
import { CITY_CONFIG } from '../../data/city';
import type { Vec3 } from '../../flight/math';
import { ParticleSystem } from '../particles';
import { SmokeTrail } from '../smoke';

export class CityFx {
  private readonly dust: SmokeTrail;
  private readonly debris: ParticleSystem;
  private readonly debrisMaterial: MeshStandardMaterial;

  constructor(private readonly field: BuildingField) {
    const d = CITY_CONFIG.dust;
    this.dust = new SmokeTrail({
      max: d.max,
      life: d.life,
      startSize: d.startSize,
      endSize: d.endSize,
      fadeFraction: 0.5,
      color: d.color,
      opacity: 0.55,
      emissive: 0.15,
    });
    this.debrisMaterial = new MeshStandardMaterial({
      color: CITY_CONFIG.rubbleColor,
      roughness: 1,
    });
    this.debris = new ParticleSystem(CITY_CONFIG.debris.max, this.debrisMaterial, {
      gravity: 9.8,
      shrinkFraction: 0.3,
      sizePerMeter: 0,
    });
    field.onCollapse((e) => {
      this.burst(e);
    });
  }

  get objects(): readonly InstancedMesh[] {
    return [this.dust.mesh, this.debris.mesh];
  }

  private burst(e: CollapseEvent): void {
    const b = this.field.layout.buildings[e.index];
    if (!b) return;
    const d = CITY_CONFIG.dust;
    const db = CITY_CONFIG.debris;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const w = b.maxX - b.minX;
    const dd = b.maxZ - b.minZ;
    const puffs = d.puffs + Math.floor(b.height / d.perHeight);
    for (let k = 0; k < puffs; k++) {
      this.dust.emit(
        cx + (Math.random() - 0.5) * w,
        b.base + Math.random() * Math.min(b.height, 40),
        cz + (Math.random() - 0.5) * dd,
      );
    }
    for (let k = 0; k < db.perBuilding; k++) {
      const p = this.debris.spawn(db.life * (0.6 + 0.4 * Math.random()));
      if (!p) break;
      p.x = cx + (Math.random() - 0.5) * w;
      p.y = b.base + b.height * (0.3 + 0.6 * Math.random());
      p.z = cz + (Math.random() - 0.5) * dd;
      const a = Math.random() * Math.PI * 2;
      const s = db.speed * (0.4 + 0.6 * Math.random());
      p.vx = Math.cos(a) * s;
      p.vz = Math.sin(a) * s;
      p.vy = s * 0.6;
      p.wx = (Math.random() - 0.5) * 6;
      p.wz = (Math.random() - 0.5) * 6;
      p.sx = db.size * (0.5 + Math.random());
      p.sy = db.size * (0.4 + 0.6 * Math.random());
      p.sz = db.size * (0.5 + Math.random());
    }
  }

  update(dt: number, camera: Readonly<Vec3>): void {
    this.dust.update(dt);
    this.debris.update(dt, camera);
  }

  dispose(): void {
    this.dust.mesh.geometry.dispose();
    (this.dust.mesh.material as MeshStandardMaterial).dispose();
    this.dust.mesh.dispose();
    this.debris.mesh.geometry.dispose();
    this.debrisMaterial.dispose();
    this.debris.mesh.dispose();
  }
}
