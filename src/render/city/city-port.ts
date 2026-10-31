// 港の設備（6-4）: 桟橋（海へ突き出した床と杭の列）・ガントリークレーン（脚 4 本・梁・海へ伸びる腕）・岸壁のコンテナの山。
// 壊れない飾り。箱を頂点カラー付きで 1 つのジオメトリにまとめる（draw call 1）
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createRandom } from '../../core/random';
import { CITY_CONFIG } from '../../data/city';
import type { CityLayout } from './layout';

function box(
  cx: number,
  y0: number,
  cz: number,
  w: number,
  h: number,
  d: number,
  hex: number,
  shade = 1,
): BufferGeometry {
  const g = new BoxGeometry(w, h, d).translate(cx, y0 + h / 2, cz);
  const c = new Color(hex).multiplyScalar(shade);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

export function createPortMesh(layout: CityLayout): Mesh {
  const p = CITY_CONFIG.port;
  const pc = CITY_CONFIG.portColors;
  const rng = createRandom(CITY_CONFIG.seed + 5);
  const parts: BufferGeometry[] = [];
  const deck = p.pierDeck;
  for (const pier of layout.piers) {
    const w = pier.maxX - pier.minX;
    const len = pier.maxZ - pier.minZ;
    // 床（海面の上 deck m）と杭（海底まで）
    parts.push(
      box(
        (pier.minX + pier.maxX) / 2,
        deck - 1.5,
        (pier.minZ + pier.maxZ) / 2,
        w,
        1.5,
        len,
        pc.pier,
      ),
    );
    for (let z = pier.minZ + 12; z < pier.maxZ; z += 24) {
      for (const sx of [-1, 1])
        parts.push(
          box(
            (pier.minX + pier.maxX) / 2 + sx * (w / 2 - 2),
            -16,
            z,
            1.6,
            16 + deck - 1.5,
            1.6,
            pc.pier,
            0.7,
          ),
        );
    }
  }
  const h = p.craneHeight;
  for (const c of layout.cranes) {
    // 脚 4 本（間隔 16 × 20m）・上の梁・海（+Z）へ伸びる腕と陸側の釣り合い
    const y0 = c.z > layout.rect.maxZ ? deck : CITY_CONFIG.groundHeight;
    for (const sx of [-8, 8])
      for (const sz of [-10, 10]) parts.push(box(c.x + sx, y0, c.z + sz, 1.8, h, 1.8, pc.crane));
    parts.push(box(c.x, y0 + h, c.z, 20, 3, 24, pc.crane, 0.9));
    parts.push(box(c.x, y0 + h + 3, c.z + 30, 4, 3, 90, pc.crane));
    parts.push(box(c.x, y0 + h + 2, c.z - 22, 8, 6, 14, 0x555555));
  }
  // 岸壁のコンテナの山（倉庫の帯の手前、岸壁沿い）
  const r = layout.rect;
  for (let x = r.minX + 80; x < r.maxX - 80; x += 34) {
    if (rng() < 0.45) continue;
    const stacks = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < stacks; k++) {
      const hex = pc.container[Math.floor(rng() * pc.container.length)] ?? pc.container[0];
      parts.push(
        box(
          x,
          CITY_CONFIG.groundHeight + k * 2.6,
          r.maxZ - 15,
          12,
          2.6,
          2.5,
          hex,
          0.8 + 0.3 * rng(),
        ),
      );
    }
  }
  const geometry = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  const mesh = new Mesh(
    geometry,
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.2 }),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'city-port';
  return mesh;
}
