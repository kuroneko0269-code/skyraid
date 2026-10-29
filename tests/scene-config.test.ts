import { describe, expect, it } from 'vitest';
import { SCENE_CONFIG } from '../src/data/scene';

describe('SCENE_CONFIG', () => {
  it('カメラの near/far と霧の範囲が妥当', () => {
    expect(SCENE_CONFIG.camera.near).toBeGreaterThan(0);
    expect(SCENE_CONFIG.camera.far).toBeGreaterThan(SCENE_CONFIG.camera.near);
    expect(SCENE_CONFIG.fogFar).toBeGreaterThan(SCENE_CONFIG.fogNear);
    expect(SCENE_CONFIG.fogFar).toBeLessThanOrEqual(SCENE_CONFIG.camera.far);
  });
});
