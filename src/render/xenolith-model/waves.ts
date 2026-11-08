// 10-7d: UFO ゼノリスの光の波（描画だけ）: 急停止・瞬間移動の前後・部位の破壊・撃破で、縁が明るい殻が広がって消える
// （InstancedMesh 1 つで 4 つまで。描画 1 回。出ていなければ 0）
import { Color, InstancedMesh, Matrix4, Quaternion, SphereGeometry, Vector3 } from 'three';
import { XENOLITH_VISUAL } from '../../data/xenolith-visual';
import { additive } from './holo';

const V = XENOLITH_VISUAL;

interface Wave {
  readonly p: Vector3;
  age: number;
  life: number;
  size: number;
  flat: number;
  alpha: number;
}

const m4 = new Matrix4();
const q = new Quaternion();
const sc = new Vector3();
const col = new Color();

/** 光の波（縁が明るい殻が広がって消える。flat は上下のつぶれ: 1 = 球・0.12 = 円盤の面の輪）。4 つまで・描画 1 回 */
export class WaveFx {
  readonly mesh: InstancedMesh;
  private readonly waves: Wave[] = [];
  private next = 0;

  constructor() {
    const mat = additive(
      {},
      /* glsl */ `
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vC;
        void main() {
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
          vV = -mv.xyz;
          vC = instanceColor;
          gl_Position = projectionMatrix * mv;
        }`,
      /* glsl */ `
        varying vec3 vN;
        varying vec3 vV;
        varying vec3 vC;
        void main() {
          float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
          gl_FragColor = vec4(vC, clamp(fres * 1.4, 0.0, 1.0));
        }`,
    );
    this.mesh = new InstancedMesh(new SphereGeometry(1, 24, 12), mat, 4);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.setColorAt(0, col.set(0));
    for (let i = 0; i < 4; i++)
      this.waves.push({ p: new Vector3(), age: 1, life: 0, size: 1, flat: 1, alpha: 0 });
  }

  /** 波を 1 つ（at から size m まで広がる） */
  emit(at: Readonly<Vector3>, size: number, flat: number, alpha: number = V.wave.alpha): void {
    const w = this.waves[this.next];
    this.next = (this.next + 1) % this.waves.length;
    if (!w) return;
    w.p.copy(at);
    w.age = 0;
    w.life = V.wave.seconds;
    w.size = size;
    w.flat = flat;
    w.alpha = alpha;
  }

  update(dt: number): void {
    let n = 0;
    for (const w of this.waves) {
      if (w.age >= w.life) continue;
      w.age += dt;
      const t = Math.min(1, w.age / w.life);
      const r = w.size * (0.15 + 0.85 * (1 - (1 - t) ** 3));
      sc.set(r, r * w.flat, r);
      m4.compose(w.p, q.identity(), sc);
      this.mesh.setMatrixAt(n, m4);
      this.mesh.setColorAt(n, col.set(V.colors.wave).multiplyScalar(w.alpha * (1 - t) ** 1.5));
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    for (const w of this.waves) w.age = w.life;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }
}
