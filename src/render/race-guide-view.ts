// 9-8 リングレースの道筋の点線（draw call 1）: ボット・下見と同じ曲線（missions/race/path.ts）の上に点で並べる。
// 9-9b: 飛行中は自機 → 次のリング → その次のリングの 2 区間だけ（自機が動くので描画フレームごとに置き直す）、細く・薄く。
// 下見の間は道筋の全部（開始位置 → ゴール。9-8 は前のリングから 3 区間だけで、下見の途中で切れていた）。
// 設定（表示 → リングレースの道筋の点線）で OFF にできる
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DynamicDrawUsage,
  Points,
  PointsMaterial,
  RGBAFormat,
  type Scene,
} from 'three';
import { RACE_GUIDE } from '../data/race';
import type { Vec3 } from '../flight/math';
import { sampleFromPoint, sampleLeg, samplePath } from '../missions/race/path';
import type { RaceRunner } from '../missions/race/runner';

/** 丸い点の形（16×16 の円。外側をぼかす） */
function dotTexture(): DataTexture {
  const size = 16;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const a = Math.max(0, Math.min(1, (1 - d) * 3));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  const tex = new DataTexture(data, size, size, RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

export class RaceGuideView {
  /** 設定の ON/OFF（app が毎フレーム入れる） */
  enabled: boolean = RACE_GUIDE.guideLineDefault;
  private readonly points: Points;
  private readonly position: BufferAttribute;
  private readonly samples: Vec3[];
  private readonly material: PointsMaterial;
  private race: RaceRunner | null = null;
  /** 次 → その次の区間を置いたときの次のリングと点の数（区間は配列の先頭。次のリングが変わるまで置き直さない） */
  private legFor = -1;
  private legCount = 0;
  /** 下見の道筋を置いたか（下見の間は置き直さない） */
  private previewPlaced: readonly Readonly<Vec3>[] | null = null;

  constructor(scene: Scene) {
    const g = RACE_GUIDE;
    this.samples = Array.from({ length: g.maxDots }, () => ({ x: 0, y: 0, z: 0 }));
    const geometry = new BufferGeometry();
    this.position = new BufferAttribute(new Float32Array(g.maxDots * 3), 3);
    this.position.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', this.position);
    geometry.setDrawRange(0, 0);
    const material = (this.material = new PointsMaterial({
      color: g.dotColor,
      size: g.dotSize,
      sizeAttenuation: true,
      map: dotTexture(),
      transparent: true,
      opacity: g.dotOpacity,
      depthWrite: false,
      alphaTest: 0.02,
    }));
    this.points = new Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  /**
   * 描画フレームごと。race は進行中のレース（ゴール後・なければ null）、player は自機の位置、
   * preview は下見の道筋（下見の間だけ。9-9b）
   */
  update(
    race: RaceRunner | null,
    player: Readonly<Vec3> | null = null,
    preview: readonly Readonly<Vec3>[] | null = null,
  ): void {
    if (race !== this.race) {
      this.race = race;
      this.previewPlaced = null;
      this.legFor = -1;
    }
    const show = this.enabled && race !== null && race.phase !== 'finished';
    this.points.visible = show;
    if (!show) return;
    const g = RACE_GUIDE;
    let n: number;
    if (preview) {
      if (preview === this.previewPlaced) return;
      this.previewPlaced = preview;
      this.legFor = -1;
      this.material.size = g.previewDotSize;
      this.material.opacity = g.previewDotOpacity;
      // 道筋の全部（長いコースは点の数が maxDots に収まるよう間隔を広げる）
      let len = 0;
      for (let i = 1; i < preview.length; i++) {
        const a = preview[i - 1];
        const b = preview[i];
        if (a && b) len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      }
      n = samplePath(
        preview,
        Math.max(g.dotSpacing, len / (g.maxDots - 1)),
        this.samples,
        g.maxDots,
      );
    } else {
      this.previewPlaced = null;
      this.material.size = g.dotSize;
      this.material.opacity = g.dotOpacity;
      // 次のリング → その次のリング（配列の先頭。次のリングが変わったときだけ）と、自機 → 次のリング（毎フレーム）
      if (race.next !== this.legFor) {
        this.legFor = race.next;
        this.legCount =
          race.next + 1 < race.rings.length
            ? sampleLeg(
                race.course,
                race.rings,
                race.next + 1,
                g.dotSpacing,
                this.samples,
                0,
                g.maxDots,
              )
            : 0;
      }
      n = this.legCount;
      const next = race.rings[race.next];
      if (next && player)
        n += sampleFromPoint(player, next, g.dotSpacing, this.samples, n, g.maxDots, g.dotNear);
    }
    const arr = this.position.array;
    for (let i = 0; i < n; i++) {
      const s = this.samples[i];
      if (!s) continue;
      arr[i * 3] = s.x;
      arr[i * 3 + 1] = s.y;
      arr[i * 3 + 2] = s.z;
    }
    this.position.needsUpdate = true;
    this.points.geometry.setDrawRange(0, n);
  }
}
