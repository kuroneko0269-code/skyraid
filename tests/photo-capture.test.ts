// フォトモード（7-A）: 解像度の選択と保存・透かしの設定、画面の状態（入れる遷移・時間停止）、画質ごとの被写界深度
import { describe, expect, it } from 'vitest';
import {
  availableResolutions,
  captureSize,
  photoFileName,
  resolveResolution,
  saveMethod,
  watermarkLayout,
} from '../src/core/photo-capture';
import { focusFromSlider, focusToSlider } from '../src/core/photo-format';
import {
  GameState,
  canTransition,
  isFrozenFlight,
  isResume,
  isSimulating,
  syncLoopWithState,
} from '../src/core/game-state';
import { GameLoop } from '../src/core/loop';
import { QUALITY_PRESETS } from '../src/data/quality';
import { DEFAULT_KEYBINDS } from '../src/data/keybinds';
import { defaultSettings, normalizeSettings } from '../src/progression/save-settings';

describe('解像度の選択と保存', () => {
  it('画面サイズ / 2 倍 / 4K（長辺 3840、縦横比は画面のまま）', () => {
    expect(captureSize('screen', 1280, 720, false)).toEqual({ width: 1280, height: 720 });
    expect(captureSize('double', 1280, 720, false)).toEqual({ width: 2560, height: 1440 });
    expect(captureSize('uhd', 1280, 720, false)).toEqual({ width: 3840, height: 2160 });
    expect(captureSize('uhd', 844, 390, false)).toEqual({ width: 3840, height: 1774 });
  });

  it('スマホは 2 倍まで（4K を選んでいたら 2 倍）', () => {
    expect(availableResolutions(true)).toEqual(['screen', 'double']);
    expect(availableResolutions(false)).toEqual(['screen', 'double', 'uhd']);
    expect(resolveResolution('uhd', true)).toBe('double');
    expect(captureSize('uhd', 844, 390, true)).toEqual({ width: 1688, height: 780 });
  });

  it('GPU の上限を超えない', () => {
    expect(captureSize('uhd', 1920, 1080, false, 2048)).toEqual({ width: 2048, height: 1152 });
  });

  it('透かしは右下、保存はスマホで共有できれば Web Share API・他は download', () => {
    const l = watermarkLayout(3840, 2160);
    expect(l.x).toBeLessThan(3840);
    expect(l.y).toBeLessThan(2160);
    expect(l.x).toBeGreaterThan(3700);
    expect(l.fontPx).toBe(Math.round(2160 * 0.028));
    expect(saveMethod(true, true)).toBe('share');
    expect(saveMethod(true, false)).toBe('download');
    expect(saveMethod(false, true)).toBe('download');
    expect(photoFileName('skyraid', new Date(2026, 9, 31, 9, 5, 7))).toBe(
      'skyraid-20261031-090507.png',
    );
  });

  it('透かしの設定は既定 ON、セーブに保存できる', () => {
    expect(defaultSettings().photoWatermark).toBe(true);
    expect(normalizeSettings({ photoWatermark: false }).photoWatermark).toBe(false);
    expect(normalizeSettings({}).photoWatermark).toBe(true);
  });

  it('ピントの距離のスライダーは対数（往復で戻る）', () => {
    expect(focusFromSlider(0)).toBeCloseTo(2, 9);
    expect(focusFromSlider(1000)).toBeCloseTo(2000, 6);
    expect(focusFromSlider(focusToSlider(30))).toBeCloseTo(30, 0);
  });
});

describe('フォトモードの画面の状態', () => {
  it('飛行（P）・ポーズ（メニュー）から入り、出ると飛行へ', () => {
    expect(canTransition('flight', 'photo')).toBe(true);
    expect(canTransition('pause', 'photo')).toBe(true);
    expect(canTransition('photo', 'flight')).toBe(true);
    expect(canTransition('photo', 'title')).toBe(false);
    expect(canTransition('lobby', 'photo')).toBe(false);
    expect(isResume('photo')).toBe(true);
    expect(isFrozenFlight('photo')).toBe(true);
    expect(DEFAULT_KEYBINDS.photo).toEqual(['KeyP']);
  });

  it('フォトモード中は固定ステップが止まり（時間停止）、出ると再開する', () => {
    expect(isSimulating('photo')).toBe(false);
    const game = new GameState();
    const loop = new GameLoop();
    syncLoopWithState(game, loop);
    let steps = 0;
    loop.onUpdate(() => steps++);
    game.transition('flight');
    loop.advance(1 / 60);
    expect(steps).toBe(1);
    game.transition('photo');
    loop.advance(1);
    expect(steps).toBe(1);
    game.transition('flight');
    loop.advance(1 / 60);
    expect(steps).toBe(2);
  });

  it('被写界深度は画質「高」だけ', () => {
    expect(QUALITY_PRESETS.low.photoFocus).toBe(false);
    expect(QUALITY_PRESETS.medium.photoFocus).toBe(false);
    expect(QUALITY_PRESETS.high.photoFocus).toBe(true);
  });
});
