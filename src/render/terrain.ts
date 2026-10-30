import { BufferGeometry, Group, Mesh, type Material, type MeshStandardMaterial } from 'three';
import { TERRAIN_CONFIG } from '../data/terrain';
import type { Vec3 } from '../flight/math';
import {
  TerrainPalette,
  buildChunkGeometry,
  mergeChunkGeometries,
  type ChunkGeometry,
  type ChunkRect,
} from './terrain-geometry';
import {
  createHeightField,
  defaultHeightField,
  getGroundHeight,
  getHeight,
  type HeightField,
  type TerrainConfig,
} from './terrain-height';
import {
  CHUNK_EDGES,
  LOD_HIDDEN,
  chunkTriangles,
  distanceToBox,
  lodThresholds,
  selectLod,
  stitchEdge,
  type Box3Like,
} from './terrain-lod';
import {
  createDetailedTerrainMaterial,
  createSimpleTerrainMaterial,
  setTerrainShaderFlags,
  type TerrainShaderFlags,
} from './terrain-material';
import type { CloudUniforms } from './cloud-field';

// 高さ関数は Three.js に依存しない terrain-height.ts にある。ここからも使えるようにする
export { createHeightField, getGroundHeight, getHeight };

/** チャンクの中の LOD を選ぶ単位（4-7）。段ごとの頂点は必要になったときに作り、今と直前の段だけ残す */
interface Block {
  readonly rect: ChunkRect;
  readonly box: Box3Like;
  readonly geometries: (ChunkGeometry | undefined)[];
  /** 隣のブロック（CHUNK_EDGES の順。範囲外は null。チャンクの境をまたぐ） */
  readonly neighbors: (Block | null)[];
  readonly chunk: Chunk;
  level: number;
}

/** 描画の単位（Mesh 1 つ = draw call 1）。中のブロックの頂点をまとめたジオメトリを持つ */
interface Chunk {
  readonly mesh: Mesh;
  readonly blocks: Block[];
  /** ブロックの段・縁の継ぎ合わせが変わり、まとめ直しが要る */
  dirty: boolean;
}

/**
 * ハイトマップの島。chunks × chunks のチャンク（Mesh）に分け、各チャンクをさらに blockSize m 四方の
 * ブロックに分けて、カメラからの距離でブロックごとに LOD の段（分割数）を選ぶ（4-7。draw call は
 * チャンクの数のまま）。描画距離より遠いブロックは描かない
 */
export class Terrain {
  readonly object = new Group();
  private readonly chunks: Chunk[] = [];
  private readonly blocks: Block[] = [];
  private readonly palette: TerrainPalette;
  // 画質「中」以上は PBR + 近距離のディテール、「低」は Lambert（setDetail で切り替える）
  private readonly detailedMaterial: MeshStandardMaterial;
  private readonly simpleMaterial = createSimpleTerrainMaterial();
  private material: Material;
  private thresholds: number[];
  private minLevel = 0;
  private triangles = 0;

  constructor(
    readonly field: HeightField = defaultHeightField,
    private readonly config: TerrainConfig = TERRAIN_CONFIG,
    cloud?: CloudUniforms,
  ) {
    // cloud を渡すと、画質「高」で雲の影を付けられる（setShaderFlags）
    this.detailedMaterial = createDetailedTerrainMaterial(cloud);
    this.material = this.detailedMaterial;
    this.object.name = 'terrain';
    this.palette = new TerrainPalette(config.colors);
    this.thresholds = lodThresholds(5000, config.lod.distanceRatios, config.lod.fineDistance);
    const lod = config.lod;
    const half = config.size / 2;
    // ブロックの格子（全体で n × n）。チャンクは perChunk × perChunk 個のブロックを持つ
    const perChunk = Math.max(1, Math.round(config.size / config.chunks / lod.blockSize));
    const n = config.chunks * perChunk;
    const size = config.size / n;
    for (let c = 0; c < config.chunks * config.chunks; c++) {
      const mesh = new Mesh(undefined, this.material);
      mesh.visible = false;
      // 機体の影を受ける（地形自身は影を落とさない。影の範囲が狭く、山の影が途中で切れるため）
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.object.add(mesh);
      this.chunks.push({ mesh, blocks: [], dirty: false });
    }
    for (let bz = 0; bz < n; bz++) {
      for (let bx = 0; bx < n; bx++) {
        const rect = { minX: -half + bx * size, minZ: -half + bz * size, size };
        const chunk = this.chunks[
          Math.floor(bz / perChunk) * config.chunks + Math.floor(bx / perChunk)
        ] as Chunk;
        const block: Block = {
          rect,
          box: this.measureBox(rect),
          geometries: [],
          neighbors: [],
          chunk,
          level: LOD_HIDDEN,
        };
        chunk.blocks.push(block);
        this.blocks.push(block);
      }
    }
    const at = (bx: number, bz: number): Block | null =>
      bx < 0 || bz < 0 || bx >= n || bz >= n ? null : (this.blocks[bz * n + bx] ?? null);
    this.blocks.forEach((block, index) => {
      const bx = index % n;
      const bz = Math.floor(index / n);
      block.neighbors.push(at(bx, bz - 1), at(bx + 1, bz), at(bx, bz + 1), at(bx - 1, bz));
    });
  }

  /** 画質設定の描画距離と、使う最も細かい段（画質「低」は 2） */
  setQuality(drawDistance: number, minLevel: number): void {
    const lod = this.config.lod;
    this.thresholds = lodThresholds(drawDistance, lod.distanceRatios, lod.fineDistance);
    this.minLevel = minLevel;
  }

  /** 近距離のディテール（PBR + 三面マッピングのノイズ）を使うか。画質「低」は false */
  setDetail(enabled: boolean): void {
    const material = enabled ? this.detailedMaterial : this.simpleMaterial;
    if (material === this.material) return;
    this.material = material;
    for (const chunk of this.chunks) chunk.mesh.material = material;
  }

  /**
   * 層のシェーダーの切り替え: 雲の影（画質「高」。コンストラクタに雲の uniform を渡していないと何もしない）・
   * 岩と崖の法線の細部・木の影の代わりのまだら（4-6）
   */
  setShaderFlags(flags: Partial<TerrainShaderFlags>): void {
    setTerrainShaderFlags(this.detailedMaterial, flags);
  }

  /** カメラ位置でブロックごとの段を選び直す。描画フレームごとに呼ぶ */
  update(camera: Readonly<Vec3>): void {
    const segments = this.config.lod.segments;
    let triangles = 0;
    for (const block of this.blocks) {
      const distance = distanceToBox(camera.x, camera.y, camera.z, block.box);
      const level = selectLod(
        distance,
        this.thresholds,
        this.minLevel,
        block.level,
        this.config.lod.hysteresis,
      );
      if (level !== block.level) this.applyLevel(block, level);
      const seg = segments[level];
      if (seg !== undefined) triangles += chunkTriangles(seg);
    }
    for (const block of this.blocks) this.stitch(block);
    for (const chunk of this.chunks) if (chunk.dirty) this.rebuild(chunk);
    this.triangles = triangles;
  }

  /** 描画対象の地形の三角形数（視錐台カリング前） */
  get triangleCount(): number {
    return this.triangles;
  }

  /** 表示中のチャンク数（= 地形の draw call の上限） */
  get visibleChunks(): number {
    return this.chunks.filter((c) => c.mesh.visible).length;
  }

  private applyLevel(block: Block, level: number): void {
    const previous = block.level;
    block.level = level;
    block.chunk.dirty = true;
    // 今と直前の段だけ残す（ヒステリシスで行き来するとき作り直さない。メモリを増やし続けない）
    block.geometries.forEach((_, i) => {
      if (i !== level && i !== previous) block.geometries[i] = undefined;
    });
    if (level === LOD_HIDDEN || block.geometries[level]) return;
    block.geometries[level] = buildChunkGeometry(
      block.rect,
      this.config.lod.segments[level] ?? 4,
      this.field.getHeight,
      this.palette,
    );
  }

  /** 隣が粗い段の縁は、頂点の高さを隣の縁の直線上に寄せてひび割れを塞ぐ */
  private stitch(block: Block): void {
    const lod = block.geometries[block.level];
    if (!lod) return;
    for (const edge of CHUNK_EDGES) {
      const neighbor = block.neighbors[edge];
      const neighborLod = neighbor ? neighbor.geometries[neighbor.level] : undefined;
      // 隣が描かれていない・同じか細かい段なら元のまま（細かい側が合わせる）
      const step =
        neighbor && neighbor.level > block.level && neighborLod
          ? lod.segments / neighborLod.segments
          : 1;
      if (lod.edgeSteps[edge] === step) continue;
      stitchEdge(lod.positions, lod.baseHeights, lod.segments, edge, step);
      lod.edgeSteps[edge] = step;
      block.chunk.dirty = true;
    }
  }

  /** チャンクの中の描くブロックを 1 つのジオメトリにまとめ直す */
  private rebuild(chunk: Chunk): void {
    chunk.dirty = false;
    const parts: ChunkGeometry[] = [];
    for (const block of chunk.blocks) {
      const lod = block.geometries[block.level];
      if (lod) parts.push(lod);
    }
    const old = chunk.mesh.geometry;
    chunk.mesh.visible = parts.length > 0;
    chunk.mesh.geometry = parts.length > 0 ? mergeChunkGeometries(parts) : new BufferGeometry();
    old.dispose();
  }

  /** ブロックの高さの範囲を粗く測る（LOD の距離計算用）。取りこぼし分の余裕を足す */
  private measureBox(rect: ChunkRect): Box3Like {
    const samples = 16;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let j = 0; j <= samples; j++) {
      for (let i = 0; i <= samples; i++) {
        const h = this.field.getHeight(
          rect.minX + (rect.size * i) / samples,
          rect.minZ + (rect.size * j) / samples,
        );
        minY = Math.min(minY, h);
        maxY = Math.max(maxY, h);
      }
    }
    const margin = 30;
    return {
      minX: rect.minX,
      maxX: rect.minX + rect.size,
      minY: minY - margin,
      maxY: maxY + margin,
      minZ: rect.minZ,
      maxZ: rect.minZ + rect.size,
    };
  }
}
