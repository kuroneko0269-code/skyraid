// 街の描画（6-4）: 建物は種類によらず InstancedMesh 1 つ（単位の箱 + 手続きの窓。city-material.ts）。
// 近く（lodDistance 以内）は部品の箱（タワーは基壇・塔・頂部）、遠くは建物ごとに箱 1 つ。崩れている建物は高さを縮め、
// 瓦礫は低い箱。地面と道路（city-ground.ts）・港の設備（city-port.ts）・粉塵と破片（city-fx.ts）で draw call は合わせて 5。
// 描く建物の数は画質（QualityPreset.cityBuildings: 低 800 / 中 2000 / 高 4000。viewOrder の先頭から）
import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { CITY_CONFIG } from '../../data/city';
import type { Vec3 } from '../../flight/math';
import type { BuildingField } from '../../combat/buildings';
import { createBuildingMaterial, KIND_CODE } from './city-material';
import { CityFx } from './city-fx';
import { createCityGround } from './city-ground';
import { createPortMesh } from './city-port';

const matrix = new Matrix4();
const pos = new Vector3();
const scale = new Vector3();
const IDENT = new Quaternion();
const color = new Color();

/** 建物の種類ごとの色（リニア） */
const KIND_COLORS = {
  low: new Color(CITY_CONFIG.kinds.low.color),
  mid: new Color(CITY_CONFIG.kinds.mid.color),
  tower: new Color(CITY_CONFIG.kinds.tower.color),
  warehouse: new Color(CITY_CONFIG.kinds.warehouse.color),
};
const RUBBLE = new Color(CITY_CONFIG.rubbleColor);

function setBuild(a: Float32Array, k: number, x: number, y: number, z: number, w: number): void {
  a[k * 4] = x;
  a[k * 4 + 1] = y;
  a[k * 4 + 2] = z;
  a[k * 4 + 3] = w;
}

export class CityView {
  readonly object = new Group();
  readonly fx: CityFx;
  private readonly mesh: InstancedMesh;
  private readonly build: InstancedBufferAttribute;
  private readonly disposers: (() => void)[] = [];
  private shown: number;
  private readonly lastCamera: Vec3 = { x: Infinity, y: 0, z: Infinity };
  private builtVersion = -1;
  /** 近景（部品）で描いている建物（LOD の見直しで変わったら作り直す） */
  private near: Uint8Array;
  private triangles = 0;

  constructor(
    private readonly field: BuildingField,
    shown: number,
  ) {
    this.object.name = 'city';
    const layout = field.layout;
    const capacity = Math.max(
      1,
      layout.buildings.reduce((a, b) => a + b.parts.length, 0),
    );
    // 底の面は見えないので、天井（+Y）と側面だけの単位の箱（y は 0〜1）
    const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const index = box.getIndex();
    if (index) box.setIndex(Array.from(index.array).filter((_, i) => Math.floor(i / 6) !== 3));
    box.clearGroups();
    this.build = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.build.setUsage(DynamicDrawUsage);
    box.setAttribute('aBuild', this.build);
    const material = createBuildingMaterial();
    this.mesh = new InstancedMesh(box, material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.mesh.instanceColor.setUsage(DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // 街全体を 1 つの球でカリングする（インスタンスごとにはしない）
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.near = new Uint8Array(layout.buildings.length);
    this.shown = shown;
    const ground = createCityGround(layout);
    const port = createPortMesh(layout);
    this.fx = new CityFx(field);
    this.object.add(ground, port, this.mesh, ...this.fx.objects);
    this.disposers.push(
      () => {
        box.dispose();
        material.dispose();
        this.mesh.dispose();
      },
      () => {
        ground.geometry.dispose();
        (Array.isArray(ground.material) ? ground.material : [ground.material]).forEach((m) => {
          m.dispose();
        });
        port.geometry.dispose();
        (Array.isArray(port.material) ? port.material : [port.material]).forEach((m) => {
          m.dispose();
        });
      },
      () => {
        this.fx.dispose();
      },
    );
  }

  /** 画質（描く建物の数） */
  setCount(n: number): void {
    if (n === this.shown) return;
    this.shown = n;
    this.builtVersion = -1;
  }

  /** 描いている建物の三角形の数（デバッグ・性能の確認用） */
  get triangleCount(): number {
    return this.triangles;
  }

  get instanceCount(): number {
    return this.mesh.count;
  }

  /** 描画フレームごと。dt は秒（演出） */
  update(camera: Readonly<Vec3>, dt: number): void {
    this.fx.update(dt, camera);
    const c = CITY_CONFIG;
    const moved =
      Math.hypot(camera.x - this.lastCamera.x, camera.z - this.lastCamera.z) > c.lodRefresh;
    if (moved) {
      this.lastCamera.x = camera.x;
      this.lastCamera.z = camera.z;
      if (this.refreshLod(camera)) this.builtVersion = -1;
    }
    if (this.builtVersion !== this.field.version || this.field.animating) this.rebuild();
  }

  /** 近景で描く建物を選び直す。変わったら true */
  private refreshLod(camera: Readonly<Vec3>): boolean {
    const bs = this.field.layout.buildings;
    const d2 = CITY_CONFIG.lodDistance ** 2;
    let changed = false;
    bs.forEach((b, i) => {
      const dx = (b.minX + b.maxX) / 2 - camera.x;
      const dz = (b.minZ + b.maxZ) / 2 - camera.z;
      const near = dx * dx + dz * dz < d2 ? 1 : 0;
      if (near !== this.near[i]) {
        this.near[i] = near;
        if (b.parts.length > 1) changed = true;
      }
    });
    return changed;
  }

  /** インスタンスを詰め直す */
  private rebuild(): void {
    this.builtVersion = this.field.version;
    const layout = this.field.layout;
    const order = layout.viewOrder;
    const n = Math.min(this.shown, order.length);
    const build = this.build.array as Float32Array;
    const colors = this.mesh.instanceColor;
    let k = 0;
    for (let o = 0; o < n; o++) {
      const i = order[o] ?? 0;
      const b = layout.buildings[i];
      if (!b) continue;
      const state = this.field.states[i];
      const spec = CITY_CONFIG.kinds[b.kind];
      const tint = 1 + (b.seed * 2 - 1) * spec.tint;
      if (state === 'rubble') {
        const rh = CITY_CONFIG.rubbleHeight;
        const h = rh[0] + (rh[1] - rh[0]) * b.seed;
        pos.set((b.minX + b.maxX) / 2, b.base, (b.minZ + b.maxZ) / 2);
        scale.set(b.maxX - b.minX, h, b.maxZ - b.minZ);
        this.mesh.setMatrixAt(k, matrix.compose(pos, IDENT, scale));
        colors?.setXYZ(k, RUBBLE.r * tint, RUBBLE.g * tint, RUBBLE.b * tint);
        setBuild(build, k, 1, 1, KIND_CODE.rubble, 0);
        k++;
        continue;
      }
      const shrink = 1 - this.field.collapseProgress(i);
      color.copy(KIND_COLORS[b.kind]).multiplyScalar(tint);
      const code = KIND_CODE[b.kind];
      if (this.near[i] || b.parts.length === 1) {
        for (const p of b.parts) {
          pos.set(p.cx, b.base + p.y0 * shrink, p.cz);
          scale.set(p.w, Math.max(0.01, p.h * shrink), p.d);
          this.mesh.setMatrixAt(k, matrix.compose(pos, IDENT, scale));
          colors?.setXYZ(k, color.r, color.g, color.b);
          setBuild(build, k, spec.floorHeight, spec.windowSpacing, code, p.y0);
          k++;
        }
      } else {
        // 遠景: 一番大きい部品の足元の箱で全体の高さ（タワーは基壇ではなく塔の太さ）
        const main = b.kind === 'tower' ? (b.parts[1] ?? b.parts[0]) : b.parts[0];
        if (!main) continue;
        pos.set(main.cx, b.base, main.cz);
        scale.set(main.w, Math.max(0.01, b.height * shrink), main.d);
        this.mesh.setMatrixAt(k, matrix.compose(pos, IDENT, scale));
        colors?.setXYZ(k, color.r, color.g, color.b);
        setBuild(build, k, spec.floorHeight, spec.windowSpacing, code, 0);
        k++;
      }
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (colors) colors.needsUpdate = true;
    this.build.needsUpdate = true;
    this.triangles = k * 10;
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }
}
