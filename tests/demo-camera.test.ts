import { describe, expect, it } from 'vitest';
import { SCREEN_CONFIG } from '../src/data/screens';
import { getGroundHeight } from '../src/render/terrain-height';
import { demoOrbitPose, type DemoCameraPose } from '../src/render/demo-camera';

const cfg = SCREEN_CONFIG.demoCamera;
const pose = (): DemoCameraPose => ({
  position: { x: 0, y: 0, z: 0 },
  lookAt: { x: 0, y: 0, z: 0 },
});

describe('デモカメラの周回', () => {
  it('常に島の中心から radius の距離・一定の高さで、中心を向く', () => {
    for (const t of [0, 10, 37.5, 100, cfg.periodSeconds]) {
      const { position: p, lookAt: l } = demoOrbitPose(cfg, t, pose());
      expect(Math.hypot(p.x - cfg.centerX, p.z - cfg.centerZ)).toBeCloseTo(cfg.radius, 6);
      expect(p.y).toBe(cfg.height);
      expect(l).toEqual({ x: cfg.centerX, y: cfg.lookAtHeight, z: cfg.centerZ });
    }
  });

  it('開始は +Z 側（起動位置と同じ南側）で、periodSeconds で 1 周する', () => {
    const start = demoOrbitPose(cfg, 0, pose()).position;
    expect(start.x).toBeCloseTo(0, 6);
    expect(start.z).toBeCloseTo(cfg.radius, 6);
    const quarter = demoOrbitPose(cfg, cfg.periodSeconds / 4, pose()).position;
    expect(quarter.x).toBeCloseTo(cfg.radius, 6);
    const lap = demoOrbitPose(cfg, cfg.periodSeconds, pose()).position;
    expect(lap.z).toBeCloseTo(cfg.radius, 6);
  });

  it('カメラは海岸線（平均 2900m）より外で、経路の真下の地表から 300m 以上', () => {
    expect(cfg.radius).toBeGreaterThan(2900);
    for (let t = 0; t < cfg.periodSeconds; t += 1) {
      const p = demoOrbitPose(cfg, t, pose()).position;
      expect(p.y - Math.max(0, getGroundHeight(p.x, p.z))).toBeGreaterThan(300);
    }
  });

  it('山頂（島の中心の最高点）は画面の中央より下（山が画面の下半分に入る。2-5 の事前修正）', () => {
    const peak = getGroundHeight(0, 0);
    const aimDeg = (Math.atan2(cfg.lookAtHeight - cfg.height, cfg.radius) * 180) / Math.PI;
    const peakDeg = (Math.atan2(peak - cfg.height, cfg.radius) * 180) / Math.PI;
    expect(peakDeg).toBeLessThan(aimDeg - 2);
    // 見上げすぎない（視線は水平から 10° 以内）
    expect(aimDeg).toBeLessThan(10);
  });
});
