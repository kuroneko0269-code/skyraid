import { Group, Mesh, type Material } from 'three';
import { TERRAIN_CONFIG } from '../data/terrain';
import type { Vec3 } from '../flight/math';
import {
  TerrainPalette,
  buildChunkGeometry,
  type ChunkGeometry,
  type ChunkRect,
} from './terrain-geometry';
import {
  createHeightField,
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
import { createDetailedTerrainMaterial, createSimpleTerrainMaterial } from './terrain-material';

// 高さ関数は Three.js に依存しない terrain-height.ts にある。ここからも使えるようにする
export { createHeightField, getGroundHeight, getHeight };

interface Chunk {
  readonly rect: ChunkRect;
  readonly box: Box3Like;
  readonly mesh: Mesh;
  /** LOD 段ごとのジオメトリ。必要になったときに作って使い回す */
  readonly geometries: (ChunkGeometry | undefined)[];
  /** 隣のチャンク（CHUNK_EDGES の順。範囲外は null） */
  readonly neighbors: (Chunk | null)[];
  level: number;
}

/**
 * ハイトマップの島。chunks × chunks のチャンクに分け、カメラからの距離で
 * チャンクごとに LOD の段（分割数）を切り替える。描画距離より遠いチャンクは描かない
 */
export class Terrain {
  readonly object = new Group();
  private readonly chunks: Chunk[] = [];
  private readonly palette: TerrainPalette;
  // 画質「中」以上は PBR + 近距離のディテール、「低」は Lambert（setDetail で切り替える）
  private readonly detailedMaterial = createDetailedTerrainMaterial();
  private readonly simpleMaterial = createSimpleTerrainMaterial();
  private material: Material = this.detailedMaterial;
  private thresholds: number[];
  private minLevel = 0;
  private triangles = 0;

  constructor(
    readonly field: HeightField = createHeightField(),
    private readonly config: TerrainConfig = TERRAIN_CONFIG,
  ) {
    this.object.name = 'terrain';
    this.palette = new TerrainPalette(config.colors);
    this.thresholds = lodThresholds(5000, config.lod.distanceRatios);
    const size = config.size / config.chunks;
    const half = config.size / 2;
    for (let cz = 0; cz < config.chunks; cz++) {
      for (let cx = 0; cx < config.chunks; cx++) {
        const rect = { minX: -half + cx * size, minZ: -half + cz * size, size };
        const mesh = new Mesh(undefined, this.material);
        mesh.visible = false;
        // 機体の影を受ける（地形自身は影を落とさない。影の範囲が狭く、山の影が途中で切れるため）
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        this.object.add(mesh);
        this.chunks.push({
          rect,
          box: this.measureBox(rect),
          mesh,
          geometries: [],
          neighbors: [],
          level: LOD_HIDDEN,
        });
      }
    }
    const n = config.chunks;
    const at = (cx: number, cz: number): Chunk | null =>
      cx < 0 || cz < 0 || cx >= n || cz >= n ? null : (this.chunks[cz * n + cx] ?? null);
    this.chunks.forEach((chunk, index) => {
      const cx = index % n;
      const cz = Math.floor(index / n);
      chunk.neighbors.push(at(cx, cz - 1), at(cx + 1, cz), at(cx, cz + 1), at(cx - 1, cz));
    });
  }

  /** 画質設定の描画距離と、使う最も細かい段（画質「低」は 1） */
  setQuality(drawDistance: number, minLevel: number): void {
    this.thresholds = lodThresholds(drawDistance, this.config.lod.distanceRatios);
    this.minLevel = minLevel;
  }

  /** 近距離のディテール（PBR + 三面マッピングのノイズ）を使うか。画質「低」は false */
  setDetail(enabled: boolean): void {
    const material = enabled ? this.detailedMaterial : this.simpleMaterial;
    if (material === this.material) return;
    this.material = material;
    for (const chunk of this.chunks) chunk.mesh.material = material;
  }

  /** カメラ位置でチャンクごとの段を選び直す。描画フレームごとに呼ぶ */
  update(camera: Readonly<Vec3>): void {
    const segments = this.config.lod.segments;
    let triangles = 0;
    for (const chunk of this.chunks) {
      const distance = distanceToBox(camera.x, camera.y, camera.z, chunk.box);
      const level = selectLod(
        distance,
        this.thresholds,
        this.minLevel,
        chunk.level,
        this.config.lod.hysteresis,
      );
      if (level !== chunk.level) this.applyLevel(chunk, level);
      const seg = segments[level];
      if (seg !== undefined) triangles += chunkTriangles(seg);
    }
    for (const chunk of this.chunks) this.stitch(chunk);
    this.triangles = triangles;
  }

  /** 描画対象の地形の三角形数（視錐台カリング前） */
  get triangleCount(): number {
    return this.triangles;
  }

  /** 表示中のチャンク数 */
  get visibleChunks(): number {
    return this.chunks.filter((c) => c.level !== LOD_HIDDEN).length;
  }

  private applyLevel(chunk: Chunk, level: number): void {
    chunk.level = level;
    if (level === LOD_HIDDEN) {
      chunk.mesh.visible = false;
      return;
    }
    let lod = chunk.geometries[level];
    if (!lod) {
      lod = buildChunkGeometry(
        chunk.rect,
        this.config.lod.segments[level] ?? 16,
        this.field.getHeight,
        this.palette,
      );
      chunk.geometries[level] = lod;
    }
    chunk.mesh.geometry = lod.geometry;
    chunk.mesh.visible = true;
  }

  /** 隣が粗い段の縁は、頂点の高さを隣の縁の直線上に寄せてひび割れを塞ぐ */
  private stitch(chunk: Chunk): void {
    const lod = chunk.geometries[chunk.level];
    if (!lod) return;
    let changed = false;
    for (const edge of CHUNK_EDGES) {
      const neighbor = chunk.neighbors[edge];
      const neighborLod = neighbor ? neighbor.geometries[neighbor.level] : undefined;
      // 隣が描かれていない・同じか細かい段なら元のまま（細かい側が合わせる）
      const step =
        neighbor && neighbor.level > chunk.level && neighborLod
          ? lod.segments / neighborLod.segments
          : 1;
      if (lod.edgeSteps[edge] === step) continue;
      stitchEdge(lod.positions, lod.baseHeights, lod.segments, edge, step);
      lod.edgeSteps[edge] = step;
      changed = true;
    }
    const position = lod.geometry.getAttribute('position');
    if (changed) position.needsUpdate = true;
  }

  /** チャンクの高さの範囲を粗く測る（LOD の距離計算用）。取りこぼし分の余裕を足す */
  private measureBox(rect: ChunkRect): Box3Like {
    const samples = 32;
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
