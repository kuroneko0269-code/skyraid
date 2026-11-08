// 10-7b: 怪獣の線の粒（描画だけ。10-7a のネフィルガの kaiju2-fx.ts から共通にした）: 体の周りの雨と、翼・ひれの先の風や水の筋
// （線の粒 InstancedMesh 1 つ）。カメラへ向けた細い板。乱数は Math.random（見た目だけ。判定・リプレイに入らない）。数は画質ごと
import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
  type InstancedBufferAttribute,
} from 'three';
import type { KaijuStreakSpec } from '../../data/kaiju-look';
import { addAlphaAttribute, useInstanceAlpha } from '../fx/instance-alpha';

const RAIN_SHARE = 0.7;

const m4 = new Matrix4();
const side = new Vector3();
const nrm = new Vector3();
const toCam = new Vector3();
const tmp = new Vector3();
const scaled = new Vector3();
const rainDir = new Vector3(0.12, -1, 0.05).normalize();

interface Streak {
  readonly p: Vector3;
  readonly v: Vector3;
  readonly dir: Vector3;
  age: number;
  life: number;
  len: number;
}

/** 線の粒: 先頭の 7 割が体の周りの箱の雨（体について動く）、残りが翼の先と突風の風の筋（ワールドに置く） */
export class KaijuStreaks {
  readonly mesh: InstancedMesh;
  private readonly alpha: InstancedBufferAttribute;
  private readonly rain: Vector3[] = [];
  private readonly wind: Streak[] = [];
  private nextWind = 0;
  private spawnAcc = 0;
  /** 雨・風の筋の色（変えてよい） */
  readonly rainColor = new Color(0.55, 0.62, 0.75);
  readonly windColor = new Color(0.9, 0.95, 1);
  /** 風の筋の明るさ（最大） */
  windAlpha = 0.28;

  constructor(
    readonly capacity: number,
    private readonly fx: KaijuStreakSpec,
  ) {
    const mat = useInstanceAlpha(
      new MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), mat, Math.max(1, capacity));
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.alpha = addAlphaAttribute(this.mesh, Math.max(1, capacity));
    const nRain = Math.floor(capacity * RAIN_SHARE);
    const B = this.fx.rainBox;
    for (let i = 0; i < nRain; i++)
      this.rain.push(
        new Vector3(
          (Math.random() * 2 - 1) * B,
          (Math.random() * 2 - 1) * B,
          (Math.random() * 2 - 1) * B,
        ),
      );
    for (let i = nRain; i < capacity; i++)
      this.wind.push({
        p: new Vector3(),
        v: new Vector3(),
        dir: new Vector3(),
        age: 1,
        life: 0,
        len: 0,
      });
  }

  /** 風の筋を 1 本（p から v の速さで、向き dir に長さ len） */
  emit(
    p: Readonly<Vector3>,
    v: Readonly<Vector3>,
    len: number,
    life: number = this.fx.windLife,
  ): void {
    if (this.wind.length === 0) return;
    const s = this.wind[this.nextWind];
    this.nextWind = (this.nextWind + 1) % this.wind.length;
    if (!s) return;
    s.p.copy(p);
    s.v.copy(v);
    s.dir.copy(v).normalize();
    s.age = 0;
    s.life = life;
    s.len = len;
  }

  /** 翼の先から（羽ばたきの打ち下ろしの強さ flap 0〜1）。dt は演出の秒数。back は後ろへ流れる速さ m/秒 */
  wingTrail(
    tip: Readonly<Vector3>,
    forward: Readonly<Vector3>,
    flap: number,
    dt: number,
    back = 25,
  ): void {
    this.spawnAcc += dt * 18 * flap;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      tmp.copy(forward).multiplyScalar(-back);
      tmp.y -= 6 * flap;
      this.emit(tip, tmp, this.fx.windLength * (0.5 + flap * 0.5));
    }
  }

  update(center: Readonly<Vector3>, camera: Readonly<Vector3>, rain: number, dt: number): void {
    let n = 0;
    const B = this.fx.rainBox;
    const fall = this.fx.rainSpeed * dt;
    if (rain > 0.02) {
      const len = 10;
      for (const r of this.rain) {
        r.y -= fall;
        if (r.y < -B) r.y += 2 * B;
        tmp.copy(center).add(r);
        this.place(n, tmp, rainDir, 0.25, len, camera);
        this.alpha.setX(n, rain * 0.13 * (1 - Math.abs(r.y) / B));
        this.mesh.setColorAt(n, this.rainColor);
        n++;
      }
    }
    for (const s of this.wind) {
      if (s.age >= s.life) continue;
      s.age += dt;
      s.p.addScaledVector(s.v, dt);
      const t = s.age / s.life;
      this.place(n, s.p, s.dir, 0.5, s.len * (0.4 + 0.6 * t), camera);
      this.alpha.setX(n, Math.sin(Math.min(1, t) * Math.PI) * this.windAlpha);
      this.mesh.setColorAt(n, this.windColor);
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private place(
    i: number,
    p: Readonly<Vector3>,
    dir: Readonly<Vector3>,
    width: number,
    len: number,
    camera: Readonly<Vector3>,
  ): void {
    toCam.subVectors(camera, p);
    side.crossVectors(dir, toCam);
    if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
    side.normalize();
    nrm.crossVectors(side, dir).normalize();
    // 遠いほど少し太く（遠くからでも筋が見える）
    const w = width * Math.max(1, toCam.length() / 400);
    m4.makeBasis(side.multiplyScalar(w), scaled.copy(dir).multiplyScalar(len), nrm);
    m4.setPosition(p);
    this.mesh.setMatrixAt(i, m4);
  }
}
