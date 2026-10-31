// フォトモード（7-A）: 軌道カメラの距離・角度の制限、プリセットの値、画面の調整の上書きと復元、
// 天候の上書きと復元（解像度・画面の状態は photo-capture.test.ts）
import { describe, expect, it } from 'vitest';
import { formatHour } from '../src/core/photo-format';
import {
  GradeOverride,
  defaultGrade,
  gradeUniforms,
  createGradeUniforms,
  setGradeValue,
  type GradeUniforms,
} from '../src/core/photo-grade';
import {
  applyPreset,
  clampOrbit,
  createOrbit,
  findPreset,
  orbitPose,
  panOrbit,
  rotateOrbit,
  wheelZoomFactor,
  zoomOrbit,
} from '../src/core/photo-orbit';
import { WeatherOverride } from '../src/core/photo-weather';
import { WeatherDirector } from '../src/core/weather-state';
import { PHOTO_GRADE_RANGE, PHOTO_ORBIT, PHOTO_PRESETS } from '../src/data/photo';

const FLAT = (): number => 0;
const NORTH = { x: 0, z: -1 };

function pose(orbit = createOrbit(), center = { x: 0, y: 500, z: 0 }, ground = FLAT) {
  return orbitPose(orbit, center, NORTH, ground, {
    position: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
  });
}

function mustPreset(id: string) {
  const p = findPreset(id);
  if (!p) throw new Error(id);
  return p;
}

function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

describe('軌道カメラの制限', () => {
  it('距離は 4〜300m、画角 20〜110°、ロール ±45°、仰角 ±85° に収まる', () => {
    const o = createOrbit();
    zoomOrbit(o, 1000);
    expect(o.distance).toBe(PHOTO_ORBIT.maxDistance);
    expect(o.distance).toBe(300);
    zoomOrbit(o, 0.0001);
    expect(o.distance).toBe(4);
    o.fov = 5;
    o.roll = 90;
    clampOrbit(o);
    expect(o.fov).toBe(20);
    expect(o.roll).toBe(45);
    o.fov = 170;
    o.roll = -90;
    clampOrbit(o);
    expect(o.fov).toBe(110);
    expect(o.roll).toBe(-45);
    rotateOrbit(o, 0, 10000);
    expect(o.elevation).toBe(85);
    rotateOrbit(o, 0, -100000);
    expect(o.elevation).toBe(-85);
  });

  it('方位は −180〜180° に回る（何周しても同じ向き）', () => {
    const o = createOrbit();
    rotateOrbit(o, 1200 / PHOTO_ORBIT.rotatePerPixel, 0);
    expect(o.azimuth).toBeGreaterThanOrEqual(-180);
    expect(o.azimuth).toBeLessThan(180);
    expect(o.azimuth).toBeCloseTo(-180 + ((180 + 1200 + 180) % 360), 6);
  });

  it('平行移動を足しても、カメラは機体から 300m を超えない', () => {
    const o = createOrbit();
    zoomOrbit(o, 1000);
    // 平行移動はカメラの奥・手前どちらへ伸ばしても上限で切る
    for (let i = 0; i < 50; i++) panOrbit(o, 400, -300, 720, NORTH);
    expect(Math.hypot(o.pan.x, o.pan.y, o.pan.z)).toBeLessThanOrEqual(PHOTO_ORBIT.maxPan + 1e-9);
    const center = { x: 100, y: 800, z: -50 };
    for (const az of [0, 45, 90, 180, -120]) {
      for (const el of [-60, 0, 30, 80]) {
        o.azimuth = az;
        o.elevation = el;
        const p = pose(o, center);
        expect(dist(p.position, center)).toBeLessThanOrEqual(300 + 1e-6);
      }
    }
  });

  it('カメラは地面・海面から 2m 以上に置く', () => {
    const o = createOrbit();
    o.elevation = -80;
    o.distance = 200;
    const p = pose(o, { x: 0, y: 20, z: 0 }, () => 10);
    expect(p.position.y).toBeGreaterThanOrEqual(12);
  });

  it('方位 180°（真後ろ）は機首の反対側、90° は右（機首の向きの水平の枠）', () => {
    const o = createOrbit();
    o.elevation = 0;
    o.azimuth = 180;
    o.distance = 50;
    expect(pose(o, { x: 0, y: 0, z: 0 }).position.z).toBeCloseTo(50, 6);
    o.azimuth = 90;
    const side = pose(o, { x: 0, y: 0, z: 0 }).position;
    expect(side.x).toBeCloseTo(50, 6);
    expect(side.z).toBeCloseTo(0, 6);
  });

  it('右へドラッグした平行移動は注視点が左へ（画面が指に付いてくる）', () => {
    const o = createOrbit();
    o.azimuth = 180;
    o.elevation = 0;
    panOrbit(o, 100, 0, 720, NORTH);
    expect(o.pan.x).toBeLessThan(0);
    expect(Math.abs(o.pan.y)).toBeLessThan(1e-9);
    panOrbit(o, 0, 100, 720, NORTH);
    expect(o.pan.y).toBeGreaterThan(0);
  });

  it('ホイール: 手前へ回すと近づき、奥へ回すと離れる', () => {
    expect(wheelZoomFactor(-100)).toBeLessThan(1);
    expect(wheelZoomFactor(100)).toBeCloseTo(PHOTO_ORBIT.zoomBase, 9);
    expect(wheelZoomFactor(0)).toBe(1);
  });
});

describe('プリセット角度', () => {
  it('6 種（正面 / 真横 / 後方上 / 翼端 / 見上げ / 俯瞰）の値', () => {
    expect(PHOTO_PRESETS.map((p) => p.label)).toEqual([
      '正面',
      '真横',
      '後方上',
      '翼端',
      '見上げ',
      '俯瞰',
    ]);
    const v = (id: string) => {
      const p = findPreset(id);
      if (!p) throw new Error(id);
      return [p.azimuth, p.elevation, p.distance, p.fov];
    };
    expect(v('front')).toEqual([0, 6, 24, 45]);
    expect(v('side')).toEqual([90, 0, 32, 40]);
    expect(v('rear-high')).toEqual([180, 25, 36, 55]);
    expect(v('wingtip')).toEqual([120, 4, 10, 75]);
    expect(v('low')).toEqual([30, -35, 60, 50]);
    expect(v('top')).toEqual([180, 80, 120, 45]);
  });

  it('どのプリセットも制限の中で、当てるとロールは 0 に戻る', () => {
    for (const p of PHOTO_PRESETS) {
      const o = createOrbit();
      o.roll = 30;
      applyPreset(o, p);
      expect(o.roll).toBe(0);
      expect(o.azimuth).toBe(
        p.azimuth > 180 ? p.azimuth - 360 : p.azimuth === 180 ? -180 : p.azimuth,
      );
      expect(o.elevation).toBe(p.elevation);
      expect(o.distance).toBe(p.distance);
      expect(o.fov).toBe(p.fov);
      expect(dist(pose(o).position, { x: 0, y: 500, z: 0 })).toBeLessThanOrEqual(300);
    }
  });

  it('見上げはカメラが機体より下、俯瞰は上', () => {
    const c = { x: 0, y: 500, z: 0 };
    const low = createOrbit();
    applyPreset(low, mustPreset('low'));
    expect(pose(low, c).position.y).toBeLessThan(c.y);
    const top = createOrbit();
    applyPreset(top, mustPreset('top'));
    expect(pose(top, c).position.y).toBeGreaterThan(c.y + 100);
  });
});

describe('画面の調整（ポストエフェクトの一時上書き）', () => {
  function target() {
    const calls: (GradeUniforms | null)[] = [];
    return {
      calls,
      setGrade: (g: Readonly<GradeUniforms> | null) => {
        calls.push(g ? { ...g, tint: [...g.tint] } : null);
      },
    };
  }

  it('露出 ±2EV、各値は範囲に収める', () => {
    const g = defaultGrade();
    setGradeValue(g, 'exposure', 5);
    expect(g.exposure).toBe(2);
    setGradeValue(g, 'exposure', -5);
    expect(g.exposure).toBe(-2);
    setGradeValue(g, 'saturation', Number.NaN);
    expect(g.saturation).toBe(1);
    const u = gradeUniforms(g, createGradeUniforms());
    expect(u.exposureScale).toBeCloseTo(0.25, 9);
  });

  it('既定値はいつもの画面（ビネット 0.22、色温度で色が変わらない）', () => {
    const u = gradeUniforms(defaultGrade(), createGradeUniforms());
    expect(u.exposureScale).toBe(1);
    expect(u.vignette).toBe(0.22);
    expect(u.tint).toEqual([1, 1, 1]);
    expect(PHOTO_GRADE_RANGE.vignette.default).toBe(0.22);
  });

  it('色温度: 暖は赤を上げて青を下げ、寒はその逆', () => {
    const g = defaultGrade();
    setGradeValue(g, 'temperature', -1);
    const warm = gradeUniforms(g, createGradeUniforms()).tint;
    expect(warm[0]).toBeGreaterThan(1);
    expect(warm[2]).toBeLessThan(1);
    setGradeValue(g, 'temperature', 1);
    const cool = gradeUniforms(g, createGradeUniforms()).tint;
    expect(cool[0]).toBeLessThan(1);
    expect(cool[2]).toBeGreaterThan(1);
  });

  it('上書き: 入ると既定値、変えると入れ、出ると上書きを外す（次に入ると既定値から）', () => {
    const t = target();
    const o = new GradeOverride(t);
    o.set('contrast', 1.4);
    expect(t.calls).toEqual([]);
    o.begin();
    expect(t.calls.at(-1)).toBeNull();
    o.set('contrast', 1.4);
    o.setFilter('sepia');
    o.setFilter('unknown');
    const last = t.calls.at(-1);
    expect(last?.contrast).toBe(1.4);
    expect(last?.filter).toBe(3);
    o.end();
    expect(t.calls.at(-1)).toBeNull();
    expect(o.settings).toEqual(defaultGrade());
    o.begin();
    expect(o.settings.contrast).toBe(1);
    o.set('exposure', 1);
    o.reset();
    expect(t.calls.at(-1)).toBeNull();
  });
});

describe('天候の上書きと復元', () => {
  it('プリセットは補間なしですぐ変わり、出ると入る前（時間の進行・補間の途中も）へ戻る', () => {
    const d = new WeatherDirector('day-clear');
    d.setTimeFlow(true);
    d.set('evening-clear');
    d.update(1);
    const before = d.snapshot();
    const o = new WeatherOverride(d);
    o.begin();
    expect(d.timeFlow).toBe(false);
    o.setPreset('night-rain');
    expect(o.preset).toBe('night-rain');
    expect(d.transitioning).toBe(false);
    expect(d.current.rain).toBe(1);
    o.setHour(6.5);
    expect(d.current.hour).toBe(6.5);
    o.end();
    expect(d.preset).toBe('evening-clear');
    expect(d.timeFlow).toBe(true);
    expect(d.transitioning).toBe(true);
    expect(d.current).toEqual(before.current);
  });

  it('「元に戻す」は元の天候へ戻し、上書きは続ける', () => {
    const d = new WeatherDirector('dawn-fog');
    const o = new WeatherOverride(d);
    o.begin();
    o.setPreset('day-rain');
    o.revert();
    expect(o.preset).toBeNull();
    expect(o.active).toBe(true);
    expect(d.preset).toBe('dawn-fog');
    expect(d.current.fog).toBeGreaterThan(0);
  });

  it('時刻のスライダーは 0〜24 に収める', () => {
    const d = new WeatherDirector('day-clear');
    const o = new WeatherOverride(d);
    o.begin();
    o.setHour(30);
    expect(d.current.hour).toBe(24);
    o.setHour(-3);
    expect(d.current.hour).toBe(0);
    expect(formatHour(15.5)).toBe('15:30');
    expect(formatHour(0)).toBe('00:00');
  });
});
