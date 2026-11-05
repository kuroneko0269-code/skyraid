// 9-8 コースの下見（Three.js 非依存）: スタート前に、カメラが道筋（path.ts。ボットが追う線と同じ）を開始位置からゴールまでたどる。
// 判定の固定ステップは進めない（記録・リプレイ・ゴーストは今までと同じ）。数値は src/data/race.ts の RACE_GUIDE.preview
import { RACE_GUIDE } from '../../data/race';
import type { Vec3 } from '../../flight/math';
import type { RaceRing } from './course';
import { coursePath, pathLength } from './path';
import type { CourseDef } from './types';

export class CoursePreview {
  /** 下見の秒数 */
  readonly duration: number;
  /** 道筋の点（ゴールの先の延長は除く）と、先頭からの距離 */
  private readonly points: Vec3[];
  private readonly along: number[];
  private readonly length: number;
  private elapsed = 0;

  constructor(course: CourseDef, rings: readonly RaceRing[]) {
    const index: number[] = [];
    const all = coursePath(course, rings, index);
    const goal = index[rings.length - 1] ?? all.length - 1;
    this.points = all.slice(0, goal + 1);
    this.along = [0];
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1];
      const b = this.points[i];
      this.along.push(
        (this.along[i - 1] ?? 0) + (a && b ? Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) : 0),
      );
    }
    this.length = pathLength(this.points);
    const c = RACE_GUIDE.preview;
    this.duration = Math.min(c.maxSeconds, Math.max(c.minSeconds, this.length / c.speed));
  }

  /** 進めた秒数（0〜duration） */
  get time(): number {
    return this.elapsed;
  }

  get done(): boolean {
    return this.elapsed >= this.duration - 1e-6;
  }

  /** 実時間で進める */
  advance(seconds: number): void {
    this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, seconds));
  }

  /** 今のカメラの位置と見る点を書く */
  pose(eye: Vec3, look: Vec3): void {
    const c = RACE_GUIDE.preview;
    const s = this.distanceAt(this.elapsed / this.duration);
    this.pointAt(s - c.behind, eye);
    eye.y += c.rise;
    this.pointAt(s + c.lookAhead, look);
  }

  /** 0〜1 の時間 → 道筋の上の距離（始めと終わりはゆっくり） */
  private distanceAt(u: number): number {
    const e = RACE_GUIDE.preview.ease;
    const x = Math.min(1, Math.max(0, u));
    // 始めと終わりの e は 2 次でゆっくり、間は一定の速さ（全体で 0〜1）
    const v = 1 / (1 - e);
    let f: number;
    if (x < e) f = (v * x * x) / (2 * e);
    else if (x > 1 - e) f = 1 - (v * (1 - x) * (1 - x)) / (2 * e);
    else f = (v * e) / 2 + v * (x - e);
    return f * this.length;
  }

  /** 道筋の上の距離 s の点（先頭より前・ゴールより先は端の向きに伸ばす） */
  private pointAt(s: number, out: Vec3): void {
    const pts = this.points;
    const along = this.along;
    const n = pts.length;
    if (n < 2) {
      const p = pts[0];
      if (p) Object.assign(out, p);
      return;
    }
    let i: number;
    if (s <= 0) i = 1;
    else if (s >= this.length) i = n - 1;
    else {
      // 二分探索
      let lo = 1;
      let hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((along[mid] ?? 0) < s) lo = mid + 1;
        else hi = mid;
      }
      i = lo;
    }
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) return;
    const a0 = along[i - 1] ?? 0;
    const seg = Math.max(1e-6, (along[i] ?? a0) - a0);
    const t = (s - a0) / seg;
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
  }
}
