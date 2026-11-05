// 9-8 リングレースの道案内（Three.js 非依存。判定・タイムには使わない）: 普通に飛ぶと通れないリングの印
// （上へ・下へ・宙返り・引き起こし）と、次のリングを通り損ねた（後ろへ回った）かどうか。数値は src/data/race.ts の RACE_GUIDE
import { RACE_GUIDE } from '../../data/race';
import type { Vec3 } from '../../flight/math';
import { anglesOf, type RaceRing } from './course';
import type { CourseDef } from './types';

const DEG = Math.PI / 180;

/** リングの印: 上へ（真上向き）・下へ（真下向き）・宙返り（上へ回って向きを変える）・引き起こし（下へ回って向きを変える） */
export const RING_CUES = ['up', 'down', 'loop', 'pull'] as const;
export type RingCue = (typeof RING_CUES)[number];

function headingDiff(a: number, b: number): number {
  const d = Math.abs(((((a - b) % 360) + 540) % 360) - 180);
  return d;
}

/**
 * 各リングの印（なければ null）。急なリング（法線の上向きの角度が ±steepPitchDeg 以上）は上へ・下へ。
 * それ以外は、前の急でないリング（なければ開始位置）から方位が reverseDeg 以上変わり、reverseRise m 以上上なら宙返り・下なら引き起こし
 */
export function ringCues(course: CourseDef, rings: readonly RaceRing[]): (RingCue | null)[] {
  const g = RACE_GUIDE;
  let refHeading = course.start.headingDeg;
  let refY = course.start.y;
  return rings.map((r) => {
    const { headingDeg, pitchDeg } = anglesOf(r.normal);
    if (pitchDeg >= g.steepPitchDeg) return 'up';
    if (pitchDeg <= -g.steepPitchDeg) return 'down';
    let cue: RingCue | null = null;
    if (headingDiff(headingDeg, refHeading) >= g.reverseDeg) {
      const rise = r.position.y - refY;
      if (rise >= g.reverseRise) cue = 'loop';
      else if (rise <= -g.reverseRise) cue = 'pull';
    }
    refHeading = headingDeg;
    refY = r.position.y;
    return cue;
  });
}

/**
 * 次のリングを通り損ねたか（後ろへ回った）: 進む向きから missAngleDeg より後ろ・missDistance m より遠いと true。
 * 一度 true になったら、clearAngleDeg 内に戻るまで true（was は前のフレームの値）
 */
export function missedRing(
  ring: { readonly position: Readonly<Vec3> },
  position: Readonly<Vec3>,
  velocity: Readonly<Vec3>,
  was: boolean,
): boolean {
  const g = RACE_GUIDE;
  const dx = ring.position.x - position.x;
  const dy = ring.position.y - position.y;
  const dz = ring.position.z - position.z;
  const dist = Math.hypot(dx, dy, dz);
  const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
  if (dist < 1e-6 || speed < 1e-6) return was;
  const cos = (dx * velocity.x + dy * velocity.y + dz * velocity.z) / (dist * speed);
  if (was) return cos < Math.cos(g.clearAngleDeg * DEG);
  return dist > g.missDistance && cos < Math.cos(g.missAngleDeg * DEG);
}
