import { ACTIONS, DEFAULT_KEYBINDS, type Action, type KeyBindings } from '../data/keybinds';

/** キーイベントの発生源。ブラウザでは window、テストでは EventTarget を渡す */
export type KeyEventSource = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** キーイベントのうち入力処理で使う部分 */
interface KeyLike {
  code: string;
  repeat?: boolean;
  preventDefault?: () => void;
}

/**
 * キーボード入力をアクション名で取得できるようにする。
 * - isDown: 押下中か
 * - wasPressed: 前回の endStep() 以降に押されたか（押した瞬間の判定）
 */
export class Input {
  private readonly codeToActions = new Map<string, Action[]>();
  private readonly downCodes = new Set<string>();
  private readonly pressed = new Set<Action>();
  private source: KeyEventSource | null = null;

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
    for (const code of this.downCodes) {
      if (this.codeToActions.get(code)?.includes(action)) return true;
    }
    return false;
  }

  wasPressed(action: Action): boolean {
    return this.pressed.has(action);
  }

  /** positive が押されていれば +1、negative なら -1、両方/なしは 0 */
  axis(negative: Action, positive: Action): number {
    return (this.isDown(positive) ? 1 : 0) - (this.isDown(negative) ? 1 : 0);
  }

  /** 固定更新1回の終わりに呼び、押した瞬間の判定をリセットする */
  endStep(): void {
    this.pressed.clear();
  }

  /** すべてのキーを離した扱いにする（フォーカス喪失時など） */
  reset(): void {
    this.downCodes.clear();
    this.pressed.clear();
  }

  handleKeyDown(e: KeyLike): void {
    const actions = this.codeToActions.get(e.code);
    if (!actions) return;
    // Space のスクロールや Tab のフォーカス移動を止める
    e.preventDefault?.();
    if (e.repeat || this.downCodes.has(e.code)) return;
    this.downCodes.add(e.code);
    for (const a of actions) this.pressed.add(a);
  }

  handleKeyUp(e: KeyLike): void {
    if (!this.codeToActions.has(e.code)) return;
    e.preventDefault?.();
    this.downCodes.delete(e.code);
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
