import { describe, expect, it } from 'vitest';
import { SCENE_CONFIG } from '../src/data/scene';

describe('SCENE_CONFIG', () => {
  it('カメラの near/far が妥当', () => {
    expect(SCENE_CONFIG.camera.near).toBeGreaterThan(0);
    expect(SCENE_CONFIG.camera.far).toBeGreaterThan(SCENE_CONFIG.camera.near);
  });
});
