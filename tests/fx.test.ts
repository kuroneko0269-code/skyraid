import { describe, expect, it } from 'vitest';
import {
  EXPLOSION_SCALES,
  EXPLOSION_SPECS,
  FIREBALL_CONFIG,
  HEAT_HAZE_CONFIG,
  WATER_COLUMN_CONFIG,
} from '../src/data/fx';
import { BOMB_CONFIG, ROCKET_CONFIG } from '../src/data/ordnance';
import { FUEL_TANK_BLAST } from '../src/data/ground-targets';
import { MISSILE_CONFIG } from '../src/data/weapons';
import {
  fireballColor,
  scaleForBlastRadius,
  scaleForTarget,
  type Rgb,
} from '../src/render/fx/explosion-scale';
import { hazeLevel } from '../src/render/fx/heat-haze';
import { puffFade } from '../src/render/fx/smoke-field';
import { waterColumnShape } from '../src/render/fx/water-column';

describe('爆発の規模テーブル', () => {
  it('small < 機体 < 地上目標 < 燃料タンクの順に、閃光・火球・煙が大きく数が多い', () => {
    const list = EXPLOSION_SCALES.map((s) => EXPLOSION_SPECS[s]);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      if (!prev || !cur) throw new Error('規模が足りない');
      expect(cur.flashSize).toBeGreaterThan(prev.flashSize);
      expect(cur.fireballEnd).toBeGreaterThan(prev.fireballEnd);
      expect(cur.fireballs).toBeGreaterThan(prev.fireballs);
      expect(cur.smokePuffs).toBeGreaterThan(prev.smokePuffs);
      expect(cur.smokeEnd).toBeGreaterThan(prev.smokeEnd);
    }
  });

  it('範囲ダメージの半径 → 規模: ロケット・ミサイルは small、爆弾は ground、誘爆は fuel', () => {
    expect(scaleForBlastRadius(ROCKET_CONFIG.blast.radius)).toBe('small');
    expect(scaleForBlastRadius(MISSILE_CONFIG.blastRadius)).toBe('small');
    expect(scaleForBlastRadius(BOMB_CONFIG.blast.radius)).toBe('ground');
    expect(scaleForBlastRadius(FUEL_TANK_BLAST.radius)).toBe('fuel');
  });

  it('壊れた対象 → 規模: 燃料タンク / 地上目標 / それ以外（機体）', () => {
    expect(scaleForTarget({ deathBlast: FUEL_TANK_BLAST, type: 'fuel', base: {} })).toBe('fuel');
    expect(scaleForTarget({ deathBlast: null, type: 'radar', base: {} })).toBe('ground');
    expect(scaleForTarget({})).toBe('aircraft');
  });

  it('火球の色: 白 → 橙 → 黒煙の色へ、明るさは下がり続ける', () => {
    const c: Rgb = { r: 0, g: 0, b: 0 };
    let prev = Infinity;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const i = fireballColor(t, c);
      expect(i).toBeLessThanOrEqual(prev + 1e-9);
      prev = i;
    }
    expect(fireballColor(0, c)).toBe(FIREBALL_CONFIG.white.intensity);
    expect(fireballColor(FIREBALL_CONFIG.orangeAt, c)).toBeCloseTo(
      FIREBALL_CONFIG.orange.intensity,
    );
    fireballColor(1, c);
    expect(c.r + c.g + c.b).toBeLessThan(0.5);
  });
});

describe('煙・水柱・陽炎の形', () => {
  it('煙の玉: 出る前（age < 0）は見えず、fadeIn で濃くなり、寿命の最後で消える', () => {
    expect(puffFade(-0.1, 8, 0.25, 0.45)).toBe(0);
    expect(puffFade(0.125, 8, 0.25, 0.45)).toBeCloseTo(0.5);
    expect(puffFade(2, 8, 0.25, 0.45)).toBe(1);
    expect(puffFade(8, 8, 0.25, 0.45)).toBe(0);
    expect(puffFade(7.9, 8, 0.25, 0.45)).toBeLessThan(0.05);
  });

  it('水柱: 立ち上がりで高さ 1 になり、崩れて低く太く透明に（1.5 秒）', () => {
    const w = WATER_COLUMN_CONFIG;
    const top = waterColumnShape(w.riseTime / w.life);
    expect(top.height).toBeCloseTo(1);
    expect(top.alpha).toBe(1);
    const end = waterColumnShape(1);
    expect(end.height).toBeCloseTo(w.endHeightScale);
    expect(end.radius).toBeCloseTo(w.spreadScale);
    expect(end.alpha).toBe(0);
    expect(waterColumnShape(0).height).toBe(0);
  });

  it('陽炎: スロットルで強く、アフターバーナーの炎が出ると消える', () => {
    expect(hazeLevel(0, 0)).toBeCloseTo(HEAT_HAZE_CONFIG.minLevel);
    expect(hazeLevel(1, 0)).toBe(1);
    expect(hazeLevel(0.7, 0)).toBeGreaterThan(hazeLevel(0.3, 0));
    expect(hazeLevel(1, 1)).toBe(0);
  });
});
