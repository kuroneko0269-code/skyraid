import { ANALOG_INPUT } from '../data/input';
import { ACTIONS, DEFAULT_KEYBINDS, type Action, type KeyBindings } from '../data/keybinds';

/** キーイベントの発生源。ブラウザでは window、テストでは EventTarget を渡す */
export type KeyEventSource = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** キーイベントのうち入力処理で使う部分 */
interface KeyLike {
  code: string;
  repeat?: boolean;
  preventDefault?: () => void;
}

/** 連続値（0〜1）を送ってくる入力系統 */
export const ANALOG_SOURCES = ['touch', 'gamepad'] as const;
export type AnalogSource = (typeof ANALOG_SOURCES)[number];

/** 最後に操作した入力系統（4-12。操作補助はタッチ・パッドのときだけ効かせる） */
export type InputDevice = 'keyboard' | AnalogSource;

interface AnalogState {
  /** アクションごとの値（0〜1） */
  readonly values: Map<Action, number>;
  /** しきい値で「押している」とみなしたアクション */
  readonly held: Set<Action>;
}

/**
 * キーボード・タッチ・ゲームパッドの入力をアクション名で取得できるようにする。
 * - value: 0〜1 の連続値（キーボードは 0 か 1）。系統をまたいで最大値
 * - axis: 負側と正側の差（-1〜+1）。キーボードだけなら ±1 / 0 のまま
 * - isDown: 押下中か（連続値はしきい値で判定）
 * - wasPressed: 前回の endStep() 以降に押されたか（押した瞬間の判定）
 */
export class Input {
  private readonly codeToActions = new Map<string, Action[]>();
  private readonly downCodes = new Set<string>();
  private readonly pressed = new Set<Action>();
  private readonly analog: Record<AnalogSource, AnalogState> = {
    touch: { values: new Map(), held: new Set() },
    gamepad: { values: new Map(), held: new Set() },
  };
  private throttleTarget: number | null = null;
  private source: KeyEventSource | null = null;
  /** 最後に操作した入力系統。キーを押す・タッチやパッドの値が 0 より大きくなると切り替わる */
  lastDevice: InputDevice = 'keyboard';

  constructor(bindings: KeyBindings = DEFAULT_KEYBINDS) {
    this.setBindings(bindings);
  }

  setBindings(bindings: KeyBindings): void {
    this.codeToActions.clear();
    for (const action of ACTIONS) {
      for (const code of bindings[action]) {
        const list = this.codeToActions.get(code);
        if (list) list.push(action);
        else this.codeToActions.set(code, [action]);
      }
    }
    this.reset();
  }

  attach(source: KeyEventSource): void {
    this.detach();
    this.source = source;
    source.addEventListener('keydown', this.onKeyDownEvent);
    source.addEventListener('keyup', this.onKeyUpEvent);
    source.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    if (!this.source) return;
    this.source.removeEventListener('keydown', this.onKeyDownEvent);
    this.source.removeEventListener('keyup', this.onKeyUpEvent);
    this.source.removeEventListener('blur', this.onBlur);
    this.source = null;
    this.reset();
  }

  isDown(action: Action): boolean {
    if (this.isKeyDown(action)) return true;
    for (const src of ANALOG_SOURCES) {
      if (this.analog[src].held.has(action)) return true;
    }
    return false;
  }

  wasPressed(action: Action): boolean {
    return this.pressed.has(action);
  }

  /** アクションの連続値（0〜1）。キーボードは押下で 1。系統をまたいで最大値 */
  value(action: Action): number {
    let v = this.isKeyDown(action) ? 1 : 0;
    for (const src of ANALOG_SOURCES) {
      v = Math.max(v, this.analog[src].values.get(action) ?? 0);
    }
    return v;
  }

  /**
   * 軸の値（-1〜+1）。系統ごとに「正側 − 負側」を出して足し、±1 で頭打ち。
   * キーボードだけなら +1 / 0 / -1 のまま
   */
  axis(negative: Action, positive: Action): number {
    let sum = (this.isKeyDown(positive) ? 1 : 0) - (this.isKeyDown(negative) ? 1 : 0);
    for (const src of ANALOG_SOURCES) {
      const values = this.analog[src].values;
      sum += (values.get(positive) ?? 0) - (values.get(negative) ?? 0);
    }
    return Math.min(1, Math.max(-1, sum));
  }

  /**
   * タッチ・ゲームパッドからの連続値（0〜1）を設定する。
   * しきい値をまたいだら isDown / wasPressed にも反映する
   */
  setAnalog(source: AnalogSource, action: Action, value: number): void {
    const state = this.analog[source];
    const v = Math.min(1, Math.max(0, value));
    if (v === 0) state.values.delete(action);
    else {
      state.values.set(action, v);
      this.lastDevice = source;
    }
    if (state.held.has(action)) {
      if (v < ANALOG_INPUT.releaseThreshold) state.held.delete(action);
    } else if (v >= ANALOG_INPUT.pressThreshold) {
      state.held.add(action);
      this.pressed.add(action);
    }
  }

  /** 系統の連続値をすべて 0 にする（パッド切断・タッチ操作を隠したとき） */
  clearAnalog(source: AnalogSource): void {
    this.analog[source].values.clear();
    this.analog[source].held.clear();
  }

  /** スロットル位置（0〜1）を直接指定する（タッチのスライダー）。次の takeThrottleTarget で受け取る */
  setThrottleTarget(value: number): void {
    this.throttleTarget = Math.min(1, Math.max(0, value));
    this.lastDevice = 'touch';
  }

  /** 指定されたスロットル位置を受け取ってクリアする。指定がなければ null */
  takeThrottleTarget(): number | null {
    const t = this.throttleTarget;
    this.throttleTarget = null;
    return t;
  }

  /** 固定更新1回の終わりに呼び、押した瞬間の判定をリセットする */
  endStep(): void {
    this.pressed.clear();
  }

  /** すべてのキー・連続値を離した扱いにする（フォーカス喪失時など） */
  reset(): void {
    this.downCodes.clear();
    this.pressed.clear();
    for (const src of ANALOG_SOURCES) this.clearAnalog(src);
    this.throttleTarget = null;
  }

  handleKeyDown(e: KeyLike): void {
    const actions = this.codeToActions.get(e.code);
    if (!actions) return;
    // Space のスクロールや Tab のフォーカス移動を止める
    e.preventDefault?.();
    if (e.repeat || this.downCodes.has(e.code)) return;
    this.downCodes.add(e.code);
    this.lastDevice = 'keyboard';
    for (const a of actions) this.pressed.add(a);
  }

  handleKeyUp(e: KeyLike): void {
    if (!this.codeToActions.has(e.code)) return;
    e.preventDefault?.();
    this.downCodes.delete(e.code);
  }

  private isKeyDown(action: Action): boolean {
    for (const code of this.downCodes) {
      if (this.codeToActions.get(code)?.includes(action)) return true;
    }
    return false;
  }

  private readonly onKeyDownEvent = (e: Event): void => {
    if (isKeyLike(e)) this.handleKeyDown(e);
  };

  private readonly onKeyUpEvent = (e: Event): void => {
    if (isKeyLike(e)) this.handleKeyUp(e);
  };

  private readonly onBlur = (): void => {
    this.reset();
  };
}

// KeyboardEvent が存在しない環境（テストの node）でも動くよう、形で判定する
function isKeyLike(e: Event): e is Event & KeyLike {
  return 'code' in e && typeof e.code === 'string';
}
