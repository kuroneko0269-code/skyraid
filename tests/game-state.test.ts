import { describe, expect, it } from 'vitest';
import { runBoot } from '../src/core/boot';
import { parseSkipTitle } from '../src/core/debug-flags';
import { EventBus } from '../src/core/event-bus';
import {
  GameState,
  SCREEN_STATES,
  STATE_TRANSITIONS,
  canTransition,
  isSimulating,
  syncLoopWithState,
  usesDemoCamera,
  type ScreenState,
  type StateChange,
} from '../src/core/game-state';
import { GameLoop } from '../src/core/loop';

const STEP = 1 / 60;

/** 指定した順に遷移した GameState */
function gameAt(...path: ScreenState[]): GameState {
  const game = new GameState();
  for (const s of path) expect(game.transition(s)).toBe(true);
  return game;
}

describe('EventBus', () => {
  it('登録順に呼び、解除したものは呼ばない', () => {
    const bus = new EventBus<{ ping: number }>();
    const got: string[] = [];
    bus.on('ping', (n) => got.push(`a${n}`));
    const off = bus.on('ping', (n) => got.push(`b${n}`));
    bus.emit('ping', 1);
    off();
    bus.emit('ping', 2);
    expect(got).toEqual(['a1', 'b1', 'a2']);
  });
});

describe('GameState の遷移', () => {
  it('boot から始まる', () => {
    expect(new GameState().state).toBe('boot');
  });

  it('タイトル → モード選択 → 飛行 → ポーズ → 再開 → ポーズ → タイトル の一周ができる', () => {
    const game = gameAt('title', 'mode_select', 'flight', 'pause', 'flight', 'pause', 'title');
    expect(game.state).toBe('title');
  });

  it('?skipTitle 用に boot から直接 flight へ行ける。モード選択からタイトルへ戻れる', () => {
    expect(gameAt('flight').state).toBe('flight');
    expect(gameAt('title', 'mode_select', 'title').state).toBe('title');
  });

  it('許可されていない遷移は false を返し、状態もイベントも変わらない', () => {
    const forbidden: [ScreenState[], ScreenState][] = [
      [[], 'pause'],
      [[], 'mode_select'],
      [['title'], 'flight'],
      [['title'], 'pause'],
      [['title', 'mode_select'], 'pause'],
      [['title', 'mode_select', 'flight'], 'title'],
      [['title', 'mode_select', 'flight'], 'mode_select'],
      [['title', 'mode_select', 'flight', 'pause'], 'mode_select'],
      [['title'], 'boot'],
      [['title'], 'title'],
    ];
    for (const [path, to] of forbidden) {
      const game = gameAt(...path);
      const before = game.state;
      let events = 0;
      game.onChange(() => events++);
      expect(game.transition(to), `${before} → ${to}`).toBe(false);
      expect(game.state).toBe(before);
      expect(events).toBe(0);
    }
  });

  it('遷移表の全組み合わせで canTransition と transition が一致する。boot へは戻れない', () => {
    for (const from of SCREEN_STATES) {
      for (const to of SCREEN_STATES) {
        expect(canTransition(from, to)).toBe(STATE_TRANSITIONS[from].includes(to));
        expect(canTransition(from, 'boot')).toBe(false);
      }
    }
  });

  it('遷移はイベントバスで from / to を通知する', () => {
    const bus = new EventBus<{ 'state:change': StateChange }>();
    const seen: StateChange[] = [];
    bus.on('state:change', (c) => seen.push(c));
    const game = new GameState(bus);
    game.transition('title');
    game.transition('mode_select');
    expect(seen).toEqual([
      { from: 'boot', to: 'title' },
      { from: 'title', to: 'mode_select' },
    ]);
  });

  it('固定更新を進めるのは飛行中だけ。デモカメラはメニュー（boot / title / mode_select / mission_select / briefing）', () => {
    expect(SCREEN_STATES.filter(isSimulating)).toEqual(['flight']);
    expect(SCREEN_STATES.filter(usesDemoCamera)).toEqual([
      'boot',
      'title',
      'mode_select',
      'mission_select',
      'briefing',
    ]);
  });

  it('キャンペーン（2-4）: ミッション一覧 → ブリーフィング → 飛行 → リザルト → もう一度 / 一覧へ、ポーズから中断', () => {
    const game = gameAt('title', 'mode_select', 'mission_select', 'briefing', 'flight', 'result');
    expect(game.transition('flight')).toBe(true);
    expect(game.transition('result')).toBe(true);
    expect(game.transition('mission_select')).toBe(true);
    expect(
      gameAt(
        'title',
        'mode_select',
        'mission_select',
        'briefing',
        'flight',
        'pause',
        'mission_select',
      ).state,
    ).toBe('mission_select');
    // 戻る
    expect(
      gameAt('title', 'mode_select', 'mission_select', 'briefing', 'mission_select', 'mode_select')
        .state,
    ).toBe('mode_select');
    // リザルトからポーズ・タイトルへは行かない
    const result = gameAt('title', 'mode_select', 'flight', 'result');
    expect(result.transition('pause')).toBe(false);
    expect(result.transition('title')).toBe(false);
  });
});

describe('ポーズとゲームループ', () => {
  it('ポーズ中は update が呼ばれず、描画は続く。再開すると update が戻る', () => {
    const game = gameAt('title', 'mode_select', 'flight');
    const loop = new GameLoop();
    let updates = 0;
    let renders = 0;
    loop.onUpdate(() => updates++);
    loop.onRender(() => renders++);
    syncLoopWithState(game, loop);

    expect(loop.advance(STEP * 2)).toBe(2);
    game.transition('pause');
    expect(loop.paused).toBe(true);
    for (let i = 0; i < 120; i++) loop.advance(STEP);
    expect(updates).toBe(2);
    expect(renders).toBe(121);

    // ポーズ中の時間は貯めない（再開した瞬間にまとめて進まない）
    game.transition('flight');
    expect(loop.advance(STEP)).toBe(1);
    expect(updates).toBe(3);
  });

  it('タイトル・モード選択でも update は呼ばれない', () => {
    const game = new GameState();
    const loop = new GameLoop();
    let updates = 0;
    loop.onUpdate(() => updates++);
    syncLoopWithState(game, loop);
    loop.advance(STEP * 5);
    game.transition('title');
    loop.advance(STEP * 5);
    game.transition('mode_select');
    loop.advance(STEP * 5);
    expect(updates).toBe(0);
    game.transition('flight');
    expect(loop.advance(STEP)).toBe(1);
  });

  it('update の中でポーズしたら、同じフレームの残りの更新もしない', () => {
    const game = gameAt('flight');
    const loop = new GameLoop();
    syncLoopWithState(game, loop);
    let updates = 0;
    loop.onUpdate(() => {
      updates++;
      game.transition('pause');
    });
    expect(loop.advance(STEP * 4)).toBe(1);
    expect(updates).toBe(1);
  });

  it('ポーズ中の補間係数は止めた時点のまま', () => {
    const loop = new GameLoop();
    const alphas: number[] = [];
    loop.onRender((a) => alphas.push(a));
    loop.advance(STEP * 1.5);
    loop.setPaused(true);
    loop.advance(STEP * 0.3);
    loop.advance(STEP * 0.3);
    expect(alphas[1]).toBeCloseTo(alphas[0] ?? NaN, 9);
    expect(alphas[2]).toBeCloseTo(alphas[0] ?? NaN, 9);
  });
});

describe('起動シーケンスと ?skipTitle', () => {
  it('タスクを順に待ち、最後に進捗 1 を通知する。タスク 0 個なら即完了', async () => {
    const progress: number[] = [];
    const order: string[] = [];
    await runBoot(
      [
        { label: 'a', run: () => Promise.resolve().then(() => void order.push('a')) },
        { label: 'b', run: () => Promise.resolve().then(() => void order.push('b')) },
      ],
      (p) => progress.push(p),
    );
    expect(order).toEqual(['a', 'b']);
    expect(progress).toEqual([0, 0.5, 1]);

    const empty: number[] = [];
    await runBoot([], (p) => empty.push(p));
    expect(empty).toEqual([1]);
  });

  it('?skipTitle でタイトルを飛ばす。他のパラメータと併用できる', () => {
    expect(parseSkipTitle('')).toBe(false);
    expect(parseSkipTitle('?skipTitle')).toBe(true);
    expect(parseSkipTitle('?debug&skipTitle&invert')).toBe(true);
    expect(parseSkipTitle('?skiptitle=1')).toBe(true);
    expect(parseSkipTitle('?title=skip')).toBe(false);
  });
});
