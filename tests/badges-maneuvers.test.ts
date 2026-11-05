// 勲章（9-10）の操縦の判定: 宙返り・インメルマン・低空・背面・最高速（水平の旋回・置き直し・撃墜では取れない）
import { describe, expect, it } from 'vitest';
import { BADGE_CONFIG } from '../src/data/badges';
import { multiplyQuat, quatIdentity, type Quat } from '../src/flight/math';
import { ManeuverWatch, type ManeuverSample } from '../src/missions/badges/maneuvers';

const DT = 1 / 60;

/** 軸の回転（x・y・z の単位ベクトルのまわりに a ラジアン） */
function axisQuat(ax: 'x' | 'y' | 'z', a: number): Quat {
  const s = Math.sin(a / 2);
  return {
    x: ax === 'x' ? s : 0,
    y: ax === 'y' ? s : 0,
    z: ax === 'z' ? s : 0,
    w: Math.cos(a / 2),
  };
}

const mul = (a: Quat, b: Quat): Quat => multiplyQuat(quatIdentity(), a, b);

interface Pose {
  x: number;
  y: number;
  z: number;
  q: Quat;
  speed?: number;
  agl?: number;
}

/** 姿勢の並びを流す（地表の高さは 0。agl を渡せば上書き） */
function run(poses: readonly Pose[], w = new ManeuverWatch()): ManeuverWatch {
  for (const p of poses) {
    const s: ManeuverSample = {
      position: { x: p.x, y: p.y, z: p.z },
      orientation: p.q,
      speed: p.speed ?? 250,
      agl: p.agl ?? p.y,
      active: true,
      downs: 0,
    };
    w.step(s, DT);
  }
  return w;
}

/** 水平に seconds 秒（向き q のまま -Z へ進む） */
function level(seconds: number, from: Pose): Pose[] {
  const out: Pose[] = [];
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) out.push({ ...from, z: from.z - (from.speed ?? 250) * DT * i });
  return out;
}

/** 縦の円（半径 r・angle まで）。始めは水平で -Z 向き */
function pitchArc(angle: number, seconds: number, y0: number, r = 200): Pose[] {
  const out: Pose[] = [];
  const n = Math.round(seconds * 60);
  for (let i = 0; i <= n; i++) {
    const th = (angle * i) / n;
    out.push({ x: 0, y: y0 + r * (1 - Math.cos(th)), z: -r * Math.sin(th), q: axisQuat('x', th) });
  }
  return out;
}

describe('操縦の判定', () => {
  it('宙返り: 縦に 1 周すると取れる。旋回（バンク 80° の水平の引き）では取れない', () => {
    const lead = level(1, { x: 0, y: 1000, z: 0, q: quatIdentity() });
    expect([...run([...lead, ...pitchArc(Math.PI * 2, 6, 1000)]).done]).toContain('loop');
    // 半分では取れない
    expect(run([...lead, ...pitchArc(Math.PI, 3, 1000)]).done.has('loop')).toBe(false);
    // バンク 80° で水平に 2 周（機首は真上を向かない）
    const turn: Pose[] = [];
    const bank = axisQuat('z', (-80 * Math.PI) / 180);
    for (let i = 0; i <= 600; i++) {
      const psi = (Math.PI * 4 * i) / 600;
      turn.push({
        x: Math.sin(psi) * 400,
        y: 1000,
        z: Math.cos(psi) * 400,
        q: mul(axisQuat('y', psi), bank),
      });
    }
    expect(run(turn).done.size).toBe(0);
  });

  it('インメルマン: 半宙返りの後に背面から水平へ戻すと取れる（向きが逆・高く）。宙返りの途中の置き直しではやり直す', () => {
    const lead = level(1, { x: 0, y: 1000, z: 0, q: quatIdentity() });
    const half = pitchArc(Math.PI, 3, 1000);
    const top = half[half.length - 1];
    if (!top) throw new Error('arc');
    const roll: Pose[] = [];
    for (let i = 0; i <= 60; i++)
      roll.push({
        ...top,
        z: top.z + 4 * i,
        q: mul(axisQuat('x', Math.PI), axisQuat('z', (Math.PI * i) / 60)),
      });
    const w = run([...lead, ...half, ...roll]);
    expect(w.done.has('immelmann')).toBe(true);
    expect(w.done.has('loop')).toBe(false);
    // 宙返りの途中で 500m 跳んだ（復帰・置き直し）ら数え直す
    const arc = pitchArc(Math.PI * 2, 6, 1000);
    const jumped = arc.map((p, i) => (i > 180 ? { ...p, x: p.x + 500 } : p));
    expect(run([...lead, ...jumped]).done.has('loop')).toBe(false);
  });

  it('背面飛行・低空飛行・最高速', () => {
    const inv = mul(quatIdentity(), axisQuat('z', Math.PI));
    expect(run(level(10.5, { x: 0, y: 500, z: 0, q: inv })).done.has('inverted')).toBe(true);
    expect(run(level(9, { x: 0, y: 500, z: 0, q: inv })).done.has('inverted')).toBe(false);
    // 地表から 100m 未満は数えない
    expect(run(level(11, { x: 0, y: 80, z: 0, q: inv })).done.has('inverted')).toBe(false);
    const c = BADGE_CONFIG.lowPass;
    const low = { x: 0, y: 20, z: 0, q: quatIdentity(), speed: c.minSpeed + 10 };
    expect(run(level(c.seconds + 0.5, low)).done.has('lowPass')).toBe(true);
    expect(run(level(c.seconds + 0.5, { ...low, y: c.maxAglM + 5 })).done.has('lowPass')).toBe(
      false,
    );
    expect(
      run(level(c.seconds + 0.5, { ...low, speed: c.minSpeed - 10 })).done.has('lowPass'),
    ).toBe(false);
    const fast = { x: 0, y: 900, z: 0, q: quatIdentity(), speed: BADGE_CONFIG.topSpeed };
    expect(run(level(0.1, fast)).done.has('topSpeed')).toBe(true);
    expect(run(level(1, { ...fast, speed: 420 })).done.has('topSpeed')).toBe(false);
  });

  it('撃墜されている間・撃墜の数が変わったら数え直す', () => {
    const w = new ManeuverWatch();
    const poses = level(10.5, { x: 0, y: 500, z: 0, q: axisQuat('z', Math.PI) });
    poses.forEach((p, i) => {
      w.step(
        {
          position: p,
          orientation: p.q,
          speed: 250,
          agl: 500,
          active: true,
          downs: i > 300 ? 1 : 0,
        },
        DT,
      );
    });
    expect(w.done.has('inverted')).toBe(false);
  });
});
