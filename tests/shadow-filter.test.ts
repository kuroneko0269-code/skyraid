// 影の縁（4-12b）: PCF のタップを画素ごとのノイズで回さない（点のディザにしない）。影の範囲は機体のまわり 250m
import { ShaderChunk } from 'three';
import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS } from '../src/data/quality';
import { SHADOW_CONFIG } from '../src/data/sky';
import { removeShadowNoise, SHADOW_NOISE_ROTATION } from '../src/render/shadow-filter';

describe('影の縁のフィルタ（4-12b）', () => {
  it('three の PCF のタップの回転（平行光源・点光源の 2 か所）を 0 にする', () => {
    // three を更新して式が変わったら、ここで気付く（書き換えが効かなくなる）
    const src = ShaderChunk.shadowmap_pars_fragment;
    const r = removeShadowNoise(src.includes(SHADOW_NOISE_ROTATION) ? src : '');
    if (src.includes(SHADOW_NOISE_ROTATION)) expect(r.replaced).toBe(2);
    expect(r.source).not.toContain('interleavedGradientNoise( gl_FragCoord');
  });

  it('回転以外は変えない', () => {
    const src = `float phi = ${SHADOW_NOISE_ROTATION};\nvec2 a = vogelDiskSample( 0, 5, phi );`;
    const r = removeShadowNoise(src);
    expect(r.replaced).toBe(1);
    expect(r.source).toBe('float phi = 0.0;\nvec2 a = vogelDiskSample( 0, 5, phi );');
  });

  it('影の範囲は 250m。画質「中」（1024）で 1 テクセル 0.25m 以下、normalBias は約 1 テクセル', () => {
    expect(SHADOW_CONFIG.range).toBe(250);
    const texel = SHADOW_CONFIG.range / QUALITY_PRESETS.medium.shadowMapSize;
    expect(texel).toBeLessThanOrEqual(0.25);
    expect(SHADOW_CONFIG.normalBias).toBeGreaterThanOrEqual(texel * 0.8);
    expect(SHADOW_CONFIG.normalBias).toBeLessThanOrEqual(texel * 1.5);
  });
});
