// 画面遷移のテスト（tests/game-state.test.ts）の続き（7-D。300 行の目安のため分けた）:
// 設定画面はタイトル / モード選択 / ポーズの上に重ね、「戻る」で開いた元へ戻る（core/settings-route.ts）
import { describe, expect, it } from 'vitest';
import { GameState, isResume, isSimulating, type ScreenState } from '../src/core/game-state';
import { SETTINGS_ORIGINS, SettingsRoute } from '../src/core/settings-route';

/** 指定した順に遷移した GameState */
function gameAt(...path: ScreenState[]): GameState {
  const game = new GameState();
  for (const s of path) expect(game.transition(s)).toBe(true);
  return game;
}

describe('設定画面の戻り先（7-D）', () => {
  const paths: Record<(typeof SETTINGS_ORIGINS)[number], ScreenState[]> = {
    title: ['title'],
    mode_select: ['title', 'mode_select'],
    pause: ['title', 'mode_select', 'flight', 'pause'],
  };

  it('タイトル / モード選択 / ポーズから開き、「戻る」で開いた元へ戻る。画面の状態は変えない', () => {
    for (const origin of SETTINGS_ORIGINS) {
      const game = gameAt(...paths[origin]);
      const route = new SettingsRoute();
      let events = 0;
      game.onChange(() => events++);
      expect(route.open(game.state), origin).toBe(true);
      expect(route.isOpen).toBe(true);
      expect(game.state).toBe(origin);
      expect(route.close()).toBe(origin);
      expect(route.isOpen).toBe(false);
      expect(game.state).toBe(origin);
      expect(events).toBe(0);
    }
  });

  it('ポーズから開いても飛行は止まったまま、戻ってからの再開は飛行のやり直しではない', () => {
    const game = gameAt(...paths.pause);
    const route = new SettingsRoute();
    route.open(game.state);
    expect(isSimulating(game.state)).toBe(false);
    expect(route.close()).toBe('pause');
    const seen: [ScreenState, ScreenState][] = [];
    game.onChange(({ from, to }) => seen.push([from, to]));
    expect(game.transition('flight')).toBe(true);
    expect(seen).toEqual([['pause', 'flight']]);
    expect(isResume('pause')).toBe(true);
  });

  it('ほかの画面からは開けない。二重には開かない。閉じていれば close は null', () => {
    const route = new SettingsRoute();
    for (const s of ['boot', 'flight', 'hangar', 'lobby', 'result', 'mission_select'] as const)
      expect(route.open(s), s).toBe(false);
    expect(route.close()).toBeNull();
    expect(route.open('title')).toBe(true);
    expect(route.open('mode_select')).toBe(false);
    expect(route.origin).toBe('title');
  });

  it('開いたまま別の画面へ移ったら閉じる（同じ状態なら閉じない）', () => {
    const route = new SettingsRoute();
    route.open('pause');
    expect(route.follow('pause')).toBe(false);
    expect(route.isOpen).toBe(true);
    expect(route.follow('title')).toBe(true);
    expect(route.isOpen).toBe(false);
    expect(route.close()).toBeNull();
  });
});
