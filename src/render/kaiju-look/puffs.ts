// 10-7b: 怪獣の柔らかい粒（描画だけ）: 霧・雲のちぎれ・潮吹きのしぶき・水柱・裂けた巣の赤い霧を、カメラへ向けた丸くぼやけた板
// （InstancedMesh 1 つ = 1 draw call。出ているときだけ描く）で。粒ごとに位置・速さ・大きさの伸び・寿命・色・濃さ・重さ。
// 乱数は Math.random（見た目だけ。判定・リプレイに入らない）
import {
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  AdditiveBlending,
  NormalBlending,
  PlaneGeometry,
  Vector3,
  type InstancedBufferAttribute,
} from 'three';
import { addAlphaAttribute } from '../fx/instance-alpha';

export interface PuffInit {
  /** 大きさ（m。直径）と寿命の間に何倍まで広がるか */
  readonly size: number;
  readonly grow?: number;
  /** 寿命（秒） */
  readonly life: number;
  /** 一番濃いときの濃さ（0〜1） */
  readonly alpha: number;
  /** 色（0xRRGGBB か Color） */
  readonly color: number | Readonly<Color>;
  /** 重さ（m/秒²。下へ）・空気の抵抗（1/秒） */
  readonly gravity?: number;
  readonly drag?: number;
  /** 出てから濃くなるまでの割合（0〜1。雲のちぎれはゆっくり現れる） */
  readonly fadeIn?: number;
  /** 始めの年（秒。前から出ていたことにする） */
  readonly age?: number;
}

interface Puff {
  readonly p: Vector3;
  readonly v: Vector3;
  readonly color: Color;
  age: number;
  life: number;
  size: number;
  grow: number;
  alpha: number;
  gravity: number;
  drag: number;
  fadeIn: number;
  spin: number;
}

const m4 = new Matrix4();
const toCam = new Vector3();
const side = new Vector3();
const up = new Vector3();
const nrm = new Vector3();
const worldUp = new Vector3(0, 1, 0);

/** 丸くぼやけた板のマテリアル（uv の中心からの距離で薄く。インスタンスごとの濃さ aAlpha を掛ける）。additive は光る粒（10-7c の炎） */
function softMaterial(additive: boolean): MeshBasicMaterial {
  const m = new MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: additive ? AdditiveBlending : NormalBlending,
    toneMapped: !additive,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aAlpha;\nvarying float vInstanceAlpha;\nvarying vec2 vSoftUv;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvInstanceAlpha = aAlpha;\nvSoftUv = uv - 0.5;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vInstanceAlpha;\nvarying vec2 vSoftUv;',
      )
      .replace(
        '#include <alphamap_fragment>',
        /* glsl */ `#include <alphamap_fragment>
        // 中心が濃く縁で消える（少しむらを付けて丸すぎないように）
        float kr = length(vSoftUv) * 2.0;
        float kn = 0.85 + 0.15 * sin(atan(vSoftUv.y, vSoftUv.x) * 5.0 + vInstanceAlpha * 40.0);
        diffuseColor.a *= vInstanceAlpha * pow(saturate(1.0 - kr / kn), 1.6);`,
      );
  };
  m.customProgramCacheKey = () => (additive ? 'kaiju-soft-puff-add' : 'kaiju-soft-puff');
  return m;
}

export class KaijuPuffs {
  readonly mesh: InstancedMesh;
  private readonly alphaAttr: InstancedBufferAttribute;
  private readonly puffs: Puff[];
  private next = 0;
  private readonly material: MeshBasicMaterial;

  /** additive: 足し合わせて光る粒（10-7c のゴウライの炎・熱。ほかの怪獣は今までどおり false） */
  constructor(
    readonly capacity: number,
    additive = false,
  ) {
    this.material = softMaterial(additive);
    const n = Math.max(1, capacity);
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), this.material, n);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.alphaAttr = addAlphaAttribute(this.mesh, n);
    this.puffs = Array.from({ length: capacity }, () => ({
      p: new Vector3(),
      v: new Vector3(),
      color: new Color(),
      age: 1,
      life: 0,
      size: 1,
      grow: 1,
      alpha: 0,
      gravity: 0,
      drag: 0,
      fadeIn: 0.15,
      spin: 0,
    }));
  }

  /** 粒を 1 つ（at から vel の速さで）。いっぱいなら一番古いものを使い回す */
  emit(at: Readonly<Vector3>, vel: Readonly<Vector3>, o: PuffInit): void {
    if (this.puffs.length === 0) return;
    const b = this.puffs[this.next];
    this.next = (this.next + 1) % this.puffs.length;
    if (!b) return;
    b.p.copy(at);
    b.v.copy(vel);
    if (typeof o.color === 'number') b.color.set(o.color);
    else b.color.copy(o.color);
    b.age = o.age ?? 0;
    b.life = o.life;
    b.size = o.size;
    b.grow = o.grow ?? 1.8;
    b.alpha = o.alpha;
    b.gravity = o.gravity ?? 0;
    b.drag = o.drag ?? 0.3;
    b.fadeIn = o.fadeIn ?? 0.15;
    b.spin = Math.random() * Math.PI * 2;
  }

  /** 出ている粒の数 */
  get active(): number {
    let n = 0;
    for (const b of this.puffs) if (b.age < b.life) n++;
    return n;
  }

  update(camera: Readonly<Vector3>, dt: number): void {
    let n = 0;
    for (const b of this.puffs) {
      if (b.age >= b.life) continue;
      b.age += dt;
      b.v.y -= b.gravity * dt;
      b.v.multiplyScalar(1 - Math.min(1, dt * b.drag));
      b.p.addScaledVector(b.v, dt);
      const t = Math.min(1, b.age / b.life);
      const k = b.size * (1 + (b.grow - 1) * Math.sqrt(t));
      // カメラへ向ける（くるりと回して同じ形に見せない）
      toCam.subVectors(camera, b.p).normalize();
      side.crossVectors(worldUp, toCam);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      up.crossVectors(toCam, side);
      const c = Math.cos(b.spin);
      const s = Math.sin(b.spin);
      nrm.copy(side).multiplyScalar(c).addScaledVector(up, s);
      up.multiplyScalar(c).addScaledVector(side, -s);
      m4.makeBasis(nrm.multiplyScalar(k), up.multiplyScalar(k), toCam);
      m4.setPosition(b.p);
      this.mesh.setMatrixAt(n, m4);
      this.mesh.setColorAt(n, b.color);
      const fin = b.fadeIn > 0 ? Math.min(1, t / b.fadeIn) : 1;
      this.alphaAttr.setX(n, b.alpha * fin * (1 - t) * (1 - t * 0.3));
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    for (const b of this.puffs) b.age = b.life;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
