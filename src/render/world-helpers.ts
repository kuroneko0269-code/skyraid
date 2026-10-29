import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  type Scene,
  type Vector3,
} from 'three';
import { WORLD_HELPERS_CONFIG } from '../data/scene';

/**
 * 速度感のグリッド線と高度感の箱。どちらも機体の位置に合わせて動かし、
 * 見た目上は無限に続いているようにする
 */
export class WorldHelpers {
  private readonly grid: LineSegments;
  private readonly boxes: Mesh[] = [];

  constructor(
    scene: Scene,
    private readonly ground: Object3D,
  ) {
    const g = WORLD_HELPERS_CONFIG.grid;
    this.grid = new LineSegments(
      createGridGeometry(g.size, g.spacing),
      new LineBasicMaterial({ color: g.color }),
    );
    this.grid.position.y = g.height;
    scene.add(this.grid);

    const b = WORLD_HELPERS_CONFIG.boxes;
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshStandardMaterial({ color: b.color, roughness: 0.9 });
    for (const item of b.items) {
      const box = new Mesh(geometry, material);
      box.scale.setScalar(item.size);
      box.position.y = item.y;
      scene.add(box);
      this.boxes.push(box);
    }
  }

  /** focus（機体の位置）に合わせて地面・グリッド・箱を動かす */
  update(focus: Readonly<Vector3>): void {
    const spacing = WORLD_HELPERS_CONFIG.grid.spacing;
    // グリッド間隔単位でずらすので、線は地面に固定されて見える
    const gx = Math.round(focus.x / spacing) * spacing;
    const gz = Math.round(focus.z / spacing) * spacing;
    this.grid.position.x = gx;
    this.grid.position.z = gz;
    this.ground.position.x = gx;
    this.ground.position.z = gz;

    const { tileSize, items } = WORLD_HELPERS_CONFIG.boxes;
    items.forEach((item, i) => {
      const box = this.boxes[i];
      if (!box) return;
      box.position.x = item.x + Math.round((focus.x - item.x) / tileSize) * tileSize;
      box.position.z = item.z + Math.round((focus.z - item.z) / tileSize) * tileSize;
    });
  }
}

/**
 * XZ 平面のグリッド線。GridHelper と違い1本の線を間隔ごとの短い線分に分ける。
 * カメラの真横を通る長い線分は環境（SwiftShader 等）によってクリップで丸ごと消えるため
 */
function createGridGeometry(size: number, spacing: number): BufferGeometry {
  const half = size / 2;
  const count = Math.round(size / spacing);
  const positions: number[] = [];
  for (let i = 0; i <= count; i++) {
    const line = -half + i * spacing;
    for (let j = 0; j < count; j++) {
      const a = -half + j * spacing;
      const b = a + spacing;
      positions.push(line, 0, a, line, 0, b); // Z 方向の線
      positions.push(a, 0, line, b, 0, line); // X 方向の線
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}
