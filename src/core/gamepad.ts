import { DEFAULT_GAMEPAD_MAPPING, GAMEPAD_CONFIG, type GamepadMapping } from '../data/gamepad';
import { ACTIONS, type Action } from '../data/keybinds';
import { applyDeadzone, applyRadialDeadzone } from './analog';
import type { Input } from './input';

/** Gamepad のうち使う部分。テストでは偽物を渡す */
export interface GamepadLike {
  readonly connected: boolean;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly value: number; readonly pressed: boolean }[];
}

export interface GamepadDeadzones {
  stick: number;
  button: number;
}

/** アクション → 値（0〜1）の書き込み先。ACTIONS の順に並ぶ */
export type ActionValues = Float32Array;

export function createActionValues(): ActionValues {
  return new Float32Array(ACTIONS.length);
}

const ACTION_INDEX: Readonly<Record<Action, number>> = Object.fromEntries(
  ACTIONS.map((a, i) => [a, i]),
) as Record<Action, number>;

export function actionIndex(action: Action): number {
  return ACTION_INDEX[action];
}

const stickTmp = { x: 0, y: 0 };

function addValue(out: ActionValues, action: Action | null, value: number): void {
  if (action === null || value <= 0) return;
  const i = ACTION_INDEX[action];
  out[i] = Math.min(1, (out[i] ?? 0) + value);
}

/** パッドの状態をアクションごとの値（0〜1）に変換する。out は 0 クリアしてから書く */
export function mapGamepad(
  pad: GamepadLike,
  out: ActionValues,
  mapping: GamepadMapping = DEFAULT_GAMEPAD_MAPPING,
  deadzones: GamepadDeadzones = {
    stick: GAMEPAD_CONFIG.stickDeadzone,
    button: GAMEPAD_CONFIG.buttonDeadzone,
  },
): ActionValues {
  out.fill(0);
  for (const s of mapping.sticks) {
    const x = pad.axes[s.xAxis] ?? 0;
    const y = pad.axes[s.yAxis] ?? 0;
    applyRadialDeadzone(x, y, deadzones.stick, stickTmp);
    addValue(out, s.left, -stickTmp.x);
    addValue(out, s.right, stickTmp.x);
    addValue(out, s.up, -stickTmp.y);
    addValue(out, s.down, stickTmp.y);
  }
  for (const [key, action] of Object.entries(mapping.buttons)) {
    const button = pad.buttons[Number(key)];
    if (!button) continue;
    // デジタルボタンは value が 0/1、トリガーは 0〜1。pressed だけ立つ実装にも備える
    const raw = Math.max(button.value, button.pressed ? 1 : 0);
    addValue(out, action, applyDeadzone(raw, deadzones.button));
  }
  return out;
}

/** navigator.getGamepads 相当。テストでは偽物を渡す */
export type GamepadSource = () => readonly (GamepadLike | null)[];

/**
 * ゲームパッドを毎ステップ読み、Input の 'gamepad' ソースに書き込む。
 * 接続イベントでパッドの有無を知り、未接続のあいだは読まない
 */
export class GamepadInput {
  private readonly values = createActionValues();
  private connectedCount = 0;
  private wasActive = false;

  constructor(
    private readonly input: Input,
    private readonly source: GamepadSource,
  ) {}

  /** window の gamepadconnected / gamepaddisconnected を購読する */
  attach(target: Pick<EventTarget, 'addEventListener'>): void {
    target.addEventListener('gamepadconnected', () => {
      this.connectedCount++;
    });
    target.addEventListener('gamepaddisconnected', () => {
      this.connectedCount = Math.max(0, this.connectedCount - 1);
    });
  }

  /** 接続中のパッドがあるか（イベントで数えた値） */
  get connected(): boolean {
    return this.connectedCount > 0;
  }

  /** 固定ステップの先頭で呼ぶ。最初に見つかった接続中のパッドを使う */
  poll(): void {
    if (this.connectedCount === 0) {
      if (this.wasActive) this.release();
      return;
    }
    const pad = this.source().find((p) => p?.connected === true);
    if (!pad) {
      if (this.wasActive) this.release();
      return;
    }
    mapGamepad(pad, this.values);
    this.write();
    this.wasActive = true;
  }

  private release(): void {
    this.values.fill(0);
    this.write();
    this.wasActive = false;
  }

  private write(): void {
    for (let i = 0; i < ACTIONS.length; i++) {
      const action = ACTIONS[i];
      if (action) this.input.setAnalog('gamepad', action, this.values[i] ?? 0);
    }
  }
}

/** ブラウザの Gamepad API。非対応環境では空配列 */
export function browserGamepads(): readonly (GamepadLike | null)[] {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
  return navigator.getGamepads();
}
