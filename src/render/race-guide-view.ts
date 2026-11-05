// 9-8 リングレースの道筋の点線（draw call 1）: 前のリング（まだなければ開始位置）→ 次のリング → その先 2 個を、
// ボット・下見と同じ曲線（missions/race/path.ts）の上に点で並べる。次のリングが変わったときだけ点を置き直す。
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
import { sampleLeg } from '../missions/race/path';
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
  private race: RaceRunner | null = null;
  private placedFor = -1;

  constructor(scene: Scene) {
    const g = RACE_GUIDE;
    this.samples = Array.from({ length: g.maxDots }, () => ({ x: 0, y: 0, z: 0 }));
    const geometry = new BufferGeometry();
    this.position = new BufferAttribute(new Float32Array(g.maxDots * 3), 3);
    this.position.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', this.position);
    geometry.setDrawRange(0, 0);
    const material = new PointsMaterial({
      color: g.dotColor,
      size: g.dotSize,
      sizeAttenuation: true,
      map: dotTexture(),
      transparent: true,
      opacity: g.dotOpacity,
      depthWrite: false,
      alphaTest: 0.05,
    });
    this.points = new Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  /** 描画フレームごと。race は進行中のレース（ゴール後・なければ null） */
  update(race: RaceRunner | null): void {
    if (race !== this.race) {
      this.race = race;
      this.placedFor = -1;
    }
    const show = this.enabled && race !== null && race.phase !== 'finished';
    this.points.visible = show;
    if (!show || race.next === this.placedFor) return;
    this.placedFor = race.next;
    const g = RACE_GUIDE;
    let n = 0;
    // 節 race.next（前のリング、0 は開始位置）→ 次のリング → その先
    for (let leg = 0; leg < g.dotLegs; leg++) {
      const ring = race.next + leg;
      if (ring >= race.rings.length) break;
      n += sampleLeg(race.course, race.rings, ring, g.dotSpacing, this.samples, n, g.maxDots);
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
