// 怪獣の 3D オブジェクト（6-1）: 骨格 1 つに部位ごとの SkinnedMesh（胴・頭・腕・脚・尾・結晶の棘）を貼り、
// 熱線（加算の円柱）と岩（InstancedMesh）を足す。draw call は部位 6 + 熱線 1 + 岩 1 = 8（シャドウの分は別）。
// 「低」（LOD）はジオメトリを作り直す（三角形 12,000 以下）
import {
  AdditiveBlending,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SkinnedMesh,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { AircraftDetail } from '../../data/aircraft-model';
import { KAIJU_ATTACK_CONFIG } from '../../data/kaiju';
import { KAIJU_MODEL_CONFIG } from '../../data/kaiju-model';
import type { KaijuBodyView, KaijuEffectsView } from '../../entities/kaiju-display';
import { wrapAngle } from '../../entities/kaiju-pose';
import type { KaijuMeshBuilder } from './builder';
import {
  createCrystalMaterial,
  createSkinMaterial,
  createSkinUniforms,
  setCrystalGlow,
  type SkinUniforms,
} from './material';
import { buildArms, buildCrystals, buildHead, buildLegs, buildTail, buildTorso } from './parts';
import { animate, createKaijuSkeleton, type KaijuSkeleton } from './skeleton';

/** 部位のメッシュ（並びは固定。部位 HP の部位との対応は partIndex） */
const MESH_PARTS = [
  { build: buildTorso, part: 1 },
  { build: buildHead, part: 0 },
  { build: buildArms, part: -1 },
  { build: buildLegs, part: 2 },
  { build: buildTail, part: 4 },
] as const;

/** 全部位のジオメトリ（テストで三角形を数える） */
export function buildKaijuGeometries(detail: AircraftDetail): {
  skin: BufferGeometry[];
  crystals: BufferGeometry;
  triangles: number;
} {
  const d = KAIJU_MODEL_CONFIG.detail[detail];
  let triangles = 0;
  const done = (b: KaijuMeshBuilder): BufferGeometry => {
    triangles += b.triangleCount;
    return b.build();
  };
  const skin = MESH_PARTS.map((p) => done(p.build(d)));
  const crystals = done(buildCrystals(d));
  return { skin, crystals, triangles };
}

const M = KAIJU_MODEL_CONFIG;
const ROCK_MAX = 3;
const matrix = new Matrix4();
const quat = new Quaternion();
const scale = new Vector3();
const pos = new Vector3();
const yAxis = new Vector3(0, 1, 0);
const dirV = new Vector3();

export class KaijuObject {
  readonly group = new Group();
  private readonly rig: KaijuSkeleton;
  private readonly skins: SkinnedMesh[] = [];
  private readonly uniforms: SkinUniforms[] = [];
  private readonly crystals: SkinnedMesh;
  private readonly crystalMaterial: MeshStandardMaterial;
  private readonly beam: Mesh;
  private readonly beamMaterial: MeshBasicMaterial;
  private readonly rocks: InstancedMesh;
  private time = 0;
  private walking = 0;

  constructor(detail: AircraftDetail = 'high') {
    this.rig = createKaijuSkeleton();
    this.group.add(this.rig.root);
    const g = buildKaijuGeometries(detail);
    g.skin.forEach((geometry) => {
      const u = createSkinUniforms();
      const mesh = new SkinnedMesh(geometry, createSkinMaterial(u));
      this.prepare(mesh);
      this.skins.push(mesh);
      this.uniforms.push(u);
    });
    this.crystalMaterial = createCrystalMaterial();
    this.crystals = new SkinnedMesh(g.crystals, this.crystalMaterial);
    this.prepare(this.crystals);
    this.crystals.castShadow = false;
    // 熱線: 高さ 1 の円柱（+Y 向き、底が原点）を伸ばして向ける
    this.beamMaterial = new MeshBasicMaterial({
      color: M.colors.beamOuter,
      transparent: true,
      opacity: 0.85,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.beamMaterial.color.multiplyScalar(4);
    this.beam = new Mesh(
      new CylinderGeometry(1, 1, 1, 12, 1, true).translate(0, 0.5, 0),
      this.beamMaterial,
    );
    this.beam.frustumCulled = false;
    this.beam.visible = false;
    this.rocks = new InstancedMesh(
      new IcosahedronGeometry(1, 1),
      new MeshStandardMaterial({ color: M.colors.rock, roughness: 0.95, flatShading: true }),
      ROCK_MAX,
    );
    this.rocks.instanceMatrix.setUsage(DynamicDrawUsage);
    this.rocks.frustumCulled = false;
    this.rocks.castShadow = true;
    this.rocks.count = 0;
    this.group.visible = false;
  }

  /** シーンに足すもの（怪獣の体・熱線・岩。熱線と岩はワールド座標で置く） */
  get objects(): readonly (Group | Mesh | InstancedMesh)[] {
    return [this.group, this.beam, this.rocks];
  }

  private prepare(mesh: SkinnedMesh): void {
    mesh.bind(this.rig.skeleton, new Matrix4());
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** 画質（LOD）を変える: 部位のジオメトリを作り直す */
  setDetail(detail: AircraftDetail): void {
    const g = buildKaijuGeometries(detail);
    this.skins.forEach((m, i) => {
      const next = g.skin[i];
      if (!next) return;
      m.geometry.dispose();
      m.geometry = next;
    });
    this.crystals.geometry.dispose();
    this.crystals.geometry = g.crystals;
  }

  /** 描画フレームごと。body の前ステップとの間を alpha で補間し、骨を動かす */
  update(body: KaijuBodyView, fx: KaijuEffectsView | null, alpha: number, dt: number): void {
    this.group.visible = body.visible;
    this.time += dt;
    this.updateEffects(fx, body.visible);
    if (!body.visible) return;
    const p = body.feet;
    const q = body.prevFeet;
    this.group.position.set(
      q.x + (p.x - q.x) * alpha,
      q.y + (p.y - q.y) * alpha,
      q.z + (p.z - q.z) * alpha,
    );
    this.group.rotation.set(
      0,
      body.prevHeading + wrapAngle(body.heading - body.prevHeading) * alpha,
      0,
    );
    const moving = Math.hypot(body.velocity.x, body.velocity.z) > 0.5 ? 1 : 0;
    this.walking += (moving - this.walking) * Math.min(1, dt * 3);
    animate(this.rig, {
      pose: body.pose,
      walkPhase: body.walkPhase,
      walking: this.walking,
      time: this.time,
      roaring: body.attack === 'roar' && body.attackStep === 'active',
    });
    const flash = body.flashTimer > 0 ? M.flash : 0;
    MESH_PARTS.forEach((mp, i) => {
      const u = this.uniforms[i];
      if (!u) return;
      u.uTime.value = this.time;
      u.uFlash.value = flash;
      const broken =
        mp.part === 2
          ? (body.parts[2]?.broken ? 0.5 : 0) + (body.parts[3]?.broken ? 0.5 : 0)
          : mp.part >= 0 && body.parts[mp.part]?.broken
            ? 1
            : 0;
      u.uCrack.value = 1 - 0.8 * broken;
    });
    setCrystalGlow(this.crystalMaterial, body.pose.crystalGlow, body.parts[1]?.broken ?? false);
  }

  private updateEffects(fx: KaijuEffectsView | null, visible: boolean): void {
    const b = fx?.beam;
    this.beam.visible = visible && (b?.on ?? false);
    if (b && this.beam.visible) {
      const r =
        KAIJU_ATTACK_CONFIG.beam.width *
        M.beam.radiusScale *
        (1 + M.beam.flicker * Math.sin(this.time * 60));
      dirV.set(b.direction.x, b.direction.y, b.direction.z);
      quat.setFromUnitVectors(yAxis, dirV);
      this.beam.position.set(b.origin.x, b.origin.y, b.origin.z);
      this.beam.quaternion.copy(quat);
      this.beam.scale.set(r, b.length, r);
    }
    let n = 0;
    if (fx && visible) {
      const rr = KAIJU_ATTACK_CONFIG.throw.rockRadius;
      for (const rock of fx.rocks) {
        if (!rock.active || n >= ROCK_MAX) continue;
        pos.set(rock.position.x, rock.position.y, rock.position.z);
        quat.setFromAxisAngle(yAxis, this.time * 2 + n);
        scale.setScalar(rr);
        matrix.compose(pos, quat, scale);
        this.rocks.setMatrixAt(n++, matrix);
      }
    }
    this.rocks.count = n;
    this.rocks.visible = n > 0;
    this.rocks.instanceMatrix.needsUpdate = true;
  }
}
