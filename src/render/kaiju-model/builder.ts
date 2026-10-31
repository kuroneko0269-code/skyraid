// 怪獣の頂点を積む入れ物（6-1）。属性は位置・法線・色（リニア）・発光（aGlow: 0 皮膚 / 1 目）・
// 骨（skinIndex / skinWeight。2 本までの混ぜ合わせ）・静止姿勢の位置（aRest。亀裂の模様をシェーダーで描く）。
// 形の部品: 曲線に沿った管（胴・尾・脚・腕・首）、楕円体（頭・関節）、角錐（棘・爪・牙）
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Uint16BufferAttribute,
  Vector3,
} from 'three';

export type Rgb = readonly [number, number, number];

export function rgb(hex: number, shade = 1): Rgb {
  const c = new Color(hex);
  return [c.r * shade, c.g * shade, c.b * shade];
}

/** 骨の割り当て: 1 本（a）か、2 本の混ぜ（a を 1 − w、b を w） */
export interface BoneBind {
  readonly a: number;
  readonly b?: number;
  readonly w?: number;
}

/** 管の断面 1 つ: 中心・横（x）と縦（y）の半径・色・骨 */
export interface TubeRing {
  readonly center: Readonly<Vector3>;
  readonly rx: number;
  readonly ry: number;
  readonly color: Rgb;
  readonly bone: BoneBind;
  /** 断面の下側の色（腹） */
  readonly under?: Rgb;
}

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();
const side = new Vector3();
const upv = new Vector3();
const dir = new Vector3();

export class KaijuMeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly glows: number[] = [];
  private readonly skinIndex: number[] = [];
  private readonly skinWeight: number[] = [];
  private readonly indices: number[] = [];

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  vertex(p: Readonly<Vector3>, n: Readonly<Vector3>, color: Rgb, bone: BoneBind, glow = 0): number {
    this.positions.push(p.x, p.y, p.z);
    this.normals.push(n.x, n.y, n.z);
    this.colors.push(color[0], color[1], color[2]);
    this.glows.push(glow);
    const w = bone.b === undefined ? 0 : (bone.w ?? 0);
    this.skinIndex.push(bone.a, bone.b ?? 0, 0, 0);
    this.skinWeight.push(1 - w, w, 0, 0);
    return this.glows.length - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  /**
   * 断面をつないだ管。断面の向きは前後の断面の中心の差（接線）と、ワールドの上（接線が上下を向くときは前）から決める。
   * capStart / capEnd で端をふさぐ（一点に絞る）
   */
  tube(rings: readonly TubeRing[], radial: number, capStart = true, capEnd = true): void {
    const n = rings.length;
    const first = this.glows.length;
    for (let i = 0; i < n; i++) {
      const r = rings[i];
      if (!r) continue;
      const prev = rings[Math.max(0, i - 1)]?.center ?? r.center;
      const next = rings[Math.min(n - 1, i + 1)]?.center ?? r.center;
      dir.subVectors(next, prev).normalize();
      upv.set(0, 1, 0);
      if (Math.abs(dir.dot(upv)) > 0.92) upv.set(0, 0, -1);
      side.crossVectors(upv, dir).normalize();
      upv.crossVectors(dir, side).normalize();
      for (let j = 0; j <= radial; j++) {
        const t = (j / radial) * Math.PI * 2;
        const c = Math.cos(t);
        const s = Math.sin(t);
        // 法線は楕円の法線（半径の逆比）
        tmpA
          .copy(r.center)
          .addScaledVector(side, s * r.rx)
          .addScaledVector(upv, c * r.ry);
        tmpB
          .set(0, 0, 0)
          .addScaledVector(side, s / r.rx)
          .addScaledVector(upv, c / r.ry)
          .normalize();
        const color = r.under && c < -0.2 ? r.under : r.color;
        this.vertex(tmpA, tmpB, color, r.bone);
      }
    }
    const stride = radial + 1;
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < radial; j++) {
        const a = first + i * stride + j;
        const b = a + stride;
        this.triangle(a, a + 1, b);
        this.triangle(a + 1, b + 1, b);
      }
    }
    const r0 = rings[0];
    const r1 = rings[n - 1];
    if (capStart && r0) this.cap(first, radial, r0, rings[1]?.center ?? r0.center, true);
    if (capEnd && r1)
      this.cap(first + (n - 1) * stride, radial, r1, rings[n - 2]?.center ?? r1.center, false);
  }

  /** 端のふた（中心の 1 点に向けて絞る。少し外へ出してとがらせない） */
  private cap(
    start: number,
    radial: number,
    r: TubeRing,
    inner: Readonly<Vector3>,
    flip: boolean,
  ): void {
    tmpC.subVectors(r.center, inner).normalize();
    tmpA.copy(r.center).addScaledVector(tmpC, Math.min(r.rx, r.ry) * 0.35);
    const center = this.vertex(tmpA, tmpC, r.color, r.bone);
    for (let j = 0; j < radial; j++) {
      const a = start + j;
      if (flip) this.triangle(center, a + 1, a);
      else this.triangle(center, a, a + 1);
    }
  }

  /** 楕円体（中心・3 軸の半径）。緯度 rows・経度 cols */
  ellipsoid(
    center: Readonly<Vector3>,
    rx: number,
    ry: number,
    rz: number,
    rows: number,
    cols: number,
    color: Rgb,
    bone: BoneBind,
    glow = 0,
    under?: Rgb,
  ): void {
    const first = this.glows.length;
    for (let i = 0; i <= rows; i++) {
      const phi = (i / rows) * Math.PI;
      const y = Math.cos(phi);
      const r = Math.sin(phi);
      for (let j = 0; j <= cols; j++) {
        const th = (j / cols) * Math.PI * 2;
        const x = Math.sin(th) * r;
        const z = Math.cos(th) * r;
        tmpA.set(center.x + x * rx, center.y + y * ry, center.z + z * rz);
        tmpB.set(x / rx, y / ry, z / rz).normalize();
        this.vertex(tmpA, tmpB, under && y < -0.3 ? under : color, bone, glow);
      }
    }
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const a = first + i * (cols + 1) + j;
        const b = a + cols + 1;
        this.triangle(a, b, a + 1);
        this.triangle(a + 1, b, b + 1);
      }
    }
  }

  /** 角錐（底面の中心 base・先端 tip・底面の半径・側面の数）。棘・爪・牙・角 */
  spike(
    base: Readonly<Vector3>,
    tip: Readonly<Vector3>,
    radius: number,
    sides: number,
    color: Rgb,
    bone: BoneBind,
    glow = 0,
  ): void {
    dir.subVectors(tip, base).normalize();
    upv.set(0, 1, 0);
    if (Math.abs(dir.dot(upv)) > 0.92) upv.set(1, 0, 0);
    side.crossVectors(upv, dir).normalize();
    upv.crossVectors(dir, side).normalize();
    for (let j = 0; j < sides; j++) {
      const t0 = (j / sides) * Math.PI * 2;
      const t1 = ((j + 1) / sides) * Math.PI * 2;
      const p0 = tmpA
        .copy(base)
        .addScaledVector(side, Math.sin(t0) * radius)
        .addScaledVector(upv, Math.cos(t0) * radius);
      const p0c = p0.clone();
      const p1 = tmpB
        .copy(base)
        .addScaledVector(side, Math.sin(t1) * radius)
        .addScaledVector(upv, Math.cos(t1) * radius);
      const p1c = p1.clone();
      // 面ごとの法線（角をはっきりさせる。結晶らしく）
      const e1 = new Vector3().subVectors(p1c, p0c);
      const e2 = new Vector3().subVectors(tip, p0c);
      const nrm = new Vector3().crossVectors(e1, e2).normalize();
      const a = this.vertex(p0c, nrm, color, bone, glow);
      const b = this.vertex(p1c, nrm, color, bone, glow);
      const c = this.vertex(tip, nrm, color, bone, glow);
      this.triangle(a, b, c);
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.normals, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    g.setAttribute('aGlow', new Float32BufferAttribute(this.glows, 1));
    // 亀裂の模様は静止姿勢の位置で決める（骨で動いても皮膚に貼り付く）
    g.setAttribute('aRest', new Float32BufferAttribute(this.positions, 3));
    g.setAttribute('skinIndex', new Uint16BufferAttribute(this.skinIndex, 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(this.skinWeight, 4));
    const count = this.glows.length;
    const index = count > 65535 ? new Uint32Array(this.indices) : new Uint16Array(this.indices);
    g.setIndex(new BufferAttribute(index, 1));
    return g;
  }
}
