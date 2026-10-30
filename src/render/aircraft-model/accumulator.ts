// 機体モデルの頂点を 1 つのジオメトリに積む入れ物。属性は位置・法線・UV・色（リニア）・部品の番号（aPart）
import { BufferAttribute, BufferGeometry, Color, Vector3 } from 'three';

/** 色（リニアの RGB） */
export type Rgb = readonly [number, number, number];

export function rgb(hex: number, shade = 1): Rgb {
  const c = new Color(hex);
  return [c.r * shade, c.g * shade, c.b * shade];
}

/**
 * 被弾の白い光（InstancedMesh のインスタンスの色に掛ける倍率）。頂点の色が機体の色なので、白を混ぜる代わりに
 * 機体の色の明るさ（リニアの輝度）が amount だけ白へ近づく倍率にする
 */
export function hitFlashScale(bodyHex: number, amount: number): number {
  const [r, g, b] = rgb(bodyHex);
  const lum = Math.max(0.01, 0.2126 * r + 0.7152 * g + 0.0722 * b);
  return 1 + amount * (1 / lum - 1);
}

/** 位置から UV を決める関数（部品ごとにアトラスの場所を変える） */
export type UvFn = (x: number, y: number, z: number) => readonly [number, number];

const p = new Vector3();
const n = new Vector3();

export class MeshAccumulator {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly colors: number[] = [];
  private readonly parts: number[] = [];
  private readonly indices: number[] = [];

  get vertexCount(): number {
    return this.parts.length;
  }

  get triangleCount(): number {
    return this.indices.length / 3;
  }

  vertex(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number,
    color: Rgb,
    part: number,
  ): number {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.uvs.push(u, v);
    this.colors.push(color[0], color[1], color[2]);
    this.parts.push(part);
    return this.parts.length - 1;
  }

  triangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  /**
   * Three.js のジオメトリ（法線あり）を位置・法線を変換して積む。UV は uv で付け直す（null ならジオメトリの UV）。
   * transform は位置を書き換える関数、rotateNormal は法線を回す関数
   */
  addGeometry(
    g: BufferGeometry,
    color: Rgb,
    part: number,
    uv: UvFn | null,
    transform: (v: Vector3) => void = () => undefined,
    rotateNormal: (v: Vector3) => void = () => undefined,
  ): void {
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const tex = g.getAttribute('uv');
    const base = this.vertexCount;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(nor, i);
      transform(p);
      rotateNormal(n);
      n.normalize();
      const [u, v] = uv ? uv(p.x, p.y, p.z) : [tex.getX(i), tex.getY(i)];
      this.vertex(p.x, p.y, p.z, n.x, n.y, n.z, u, v, color, part);
    }
    const index = g.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) this.indices.push(base + index.getX(i));
    } else {
      for (let i = 0; i < pos.count; i++) this.indices.push(base + i);
    }
    g.dispose();
  }

  toGeometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    g.setAttribute('aPart', new BufferAttribute(new Float32Array(this.parts), 1));
    const count = this.vertexCount;
    g.setIndex(
      new BufferAttribute(
        count > 65535 ? new Uint32Array(this.indices) : new Uint16Array(this.indices),
        1,
      ),
    );
    g.computeBoundingSphere();
    return g;
  }
}
