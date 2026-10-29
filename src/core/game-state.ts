import { EventBus } from './event-bus';

/**
 * 画面の状態。boot は読み込み中（起動直後だけ）。
 * docs/spec.md「UI」: タイトル → モード選択 → プレイ。ハンガー・リザルト等は後のフェーズで足す
 */
export const SCREEN_STATES = ['boot', 'title', 'mode_select', 'flight', 'pause'] as const;
export type ScreenState = (typeof SCREEN_STATES)[number];

/** 許可される遷移（遷移元 → 遷移先の一覧）。ここにない遷移は拒否する */
export const STATE_TRANSITIONS: Readonly<Record<ScreenState, readonly ScreenState[]>> = {
  // ?skipTitle のときは boot から直接 flight
  boot: ['title', 'flight'],
  title: ['mode_select'],
  mode_select: ['title', 'flight'],
  flight: ['pause'],
  pause: ['flight', 'title'],
};

export interface StateChange {
  readonly from: ScreenState;
  readonly to: ScreenState;
}

export interface GameStateEvents extends Record<string, unknown> {
  /** 状態が変わった直後に呼ばれる */
  'state:change': StateChange;
}

export function canTransition(from: ScreenState, to: ScreenState): boolean {
  return STATE_TRANSITIONS[from].includes(to);
}

/** 固定ステップ更新（ゲームの時間）を進める状態か。飛行中だけ進め、ポーズ・メニュー中は止める */
export function isSimulating(state: ScreenState): boolean {
  return state === 'flight';
}

/** 背景をデモカメラ（島の周回）で描く状態か。飛行・ポーズは追従カメラ */
export function usesDemoCamera(state: ScreenState): boolean {
  return state === 'boot' || state === 'title' || state === 'mode_select';
}

/** 画面状態の管理。遷移は STATE_TRANSITIONS で検査し、成功したらバスに 'state:change' を流す */
export class GameState {
  private current: ScreenState = 'boot';

  constructor(readonly bus: EventBus<GameStateEvents> = new EventBus()) {}

  get state(): ScreenState {
    return this.current;
  }

  /** 遷移する。許可されていなければ何もせず false */
  transition(to: ScreenState): boolean {
    const from = this.current;
    if (!canTransition(from, to)) return false;
    this.current = to;
    this.bus.emit('state:change', { from, to });
    return true;
  }

  /** 遷移を購読する。戻り値で購読解除 */
  onChange(fn: (change: StateChange) => void): () => void {
    return this.bus.on('state:change', fn);
  }
}

/** ゲームループの一時停止状態を画面状態に合わせる（Three.js / DOM 非依存なのでテストできる） */
export function syncLoopWithState(
  game: GameState,
  loop: { setPaused(paused: boolean): void },
): () => void {
  loop.setPaused(!isSimulating(game.state));
  return game.onChange(({ to }) => {
    loop.setPaused(!isSimulating(to));
  });
}
