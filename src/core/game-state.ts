import { EventBus } from './event-bus';

/**
 * 画面の状態。boot は読み込み中（起動直後だけ）。
 * docs/spec.md「UI」: タイトル → モード選択 → （キャンペーン: ミッション一覧 → ブリーフィング）→ プレイ → リザルト（2-4）。
 * 初回起動（セーブにパイロット名がない）はタイトルの後にパイロット名の入力（3-1）。
 * ハンガー（3-3）はモード選択とブリーフィング（機体変更）から開き、開いた画面へ戻る。
 * PvP（5-1）はモード選択 → ロビー → 飛行。飛行からはモード選択へ（退出・ホストの切断）、対戦が終わるとロビーへ（5-3）。
 * PvP の飛行にポーズはない
 */
export const SCREEN_STATES = [
  'boot',
  'title',
  'pilot_name',
  'mode_select',
  'mission_select',
  'briefing',
  'flight',
  'pause',
  'result',
  'hangar',
  'lobby',
] as const;
export type ScreenState = (typeof SCREEN_STATES)[number];

/** 許可される遷移（遷移元 → 遷移先の一覧）。ここにない遷移は拒否する */
export const STATE_TRANSITIONS: Readonly<Record<ScreenState, readonly ScreenState[]>> = {
  // ?skipTitle のときは boot から直接 flight
  boot: ['title', 'flight'],
  // 初回起動はパイロット名の入力を挟む（3-1）。入力から Esc でタイトルへ戻れる
  title: ['mode_select', 'pilot_name'],
  pilot_name: ['mode_select', 'title'],
  mode_select: ['title', 'flight', 'mission_select', 'hangar', 'lobby'],
  lobby: ['mode_select', 'flight'],
  mission_select: ['mode_select', 'briefing'],
  briefing: ['mission_select', 'flight', 'hangar'],
  hangar: ['mode_select', 'briefing'],
  // ミッションが終わるとリザルトへ。チュートリアル（4-11）は指示の「中断」でモード選択へ
  // PvP の対戦が終わるとロビー（のリザルト）へ（5-3）
  flight: ['pause', 'result', 'mode_select', 'lobby'],
  // ミッション中はポーズから「ミッションを中断」でミッション一覧へ（チュートリアルはモード選択へ）
  pause: ['flight', 'title', 'mission_select', 'mode_select'],
  // 「もう一度」は飛行へ直接、「ミッション一覧へ」（チュートリアルは「モード選択へ」）
  result: ['flight', 'mission_select', 'mode_select'],
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

/**
 * 背景をデモカメラ（島の周回）で描く状態か。飛行・ポーズ・リザルトは追従カメラ（リザルトは止まった飛行の画面の上に出す）。
 * ハンガーは機体の展示のカメラ（render/hangar-stage.ts）
 */
export function usesDemoCamera(state: ScreenState): boolean {
  return (
    state === 'boot' ||
    state === 'title' ||
    state === 'pilot_name' ||
    state === 'mode_select' ||
    state === 'mission_select' ||
    state === 'briefing' ||
    state === 'lobby'
  );
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
