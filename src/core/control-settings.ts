// 操作設定（4-11）の型と変換（DOM・Three.js 非依存）: 感度・デッドゾーンの値の扱い、キー割当の組み立てと重複の検出。
// 値の範囲・初期値は src/data/controls.ts。保存はセーブの settings.controls（v5）
import {
  BUTTON_SIZES,
  CONTROL_SETTINGS,
  REMAPPABLE_ACTIONS,
  type ButtonSize,
  type RemappableAction,
} from '../data/controls';
import { FLIGHT_CONFIG } from '../data/flight';
import { ACTIONS, DEFAULT_KEYBINDS, type Action, type KeyBindings } from '../data/keybinds';

export interface ControlSettings {
  /** スティック感度（0.6〜1.6） */
  sensitivity: number;
  /** タッチのスティックのデッドゾーン（半径に対する比、0.05〜0.25） */
  deadzone: number;
  invertPitch: boolean;
  autoLevel: boolean;
  /** タッチのスティックとボタン群を左右反転 */
  swapSides: boolean;
  /** 振動（Android のみ） */
  vibration: boolean;
  buttonSize: ButtonSize;
  /** キー割当の変更（アクション → 主キーの KeyboardEvent.code）。ないアクションは初期の割当 */
  keys: Partial<Record<RemappableAction, string>>;
}

/** 初期値（4-10 までの挙動と同じ） */
export function defaultControls(): ControlSettings {
  return {
    sensitivity: CONTROL_SETTINGS.sensitivity.default,
    deadzone: CONTROL_SETTINGS.deadzone.default,
    invertPitch: FLIGHT_CONFIG.defaults.invertPitch,
    autoLevel: FLIGHT_CONFIG.defaults.autoLevel,
    swapSides: false,
    vibration: false,
    buttonSize: CONTROL_SETTINGS.defaultButtonSize,
    keys: {},
  };
}

/** 範囲に収め、刻み（step）にそろえる。数でなければ fallback */
export function quantize(
  v: unknown,
  range: { readonly min: number; readonly max: number; readonly step: number },
  fallback: number,
): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const clamped = Math.min(range.max, Math.max(range.min, v));
  const steps = Math.round((clamped - range.min) / range.step);
  // 0.1 刻みの足し算の誤差（0.7000000001）を丸める
  return Math.round((range.min + steps * range.step) * 1000) / 1000;
}

/** 読み込んだ値を確かめる。不正な項目は初期値 */
export function normalizeControls(raw: unknown): ControlSettings {
  const c = defaultControls();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return c;
  const r = raw as Record<string, unknown>;
  c.sensitivity = quantize(r.sensitivity, CONTROL_SETTINGS.sensitivity, c.sensitivity);
  c.deadzone = quantize(r.deadzone, CONTROL_SETTINGS.deadzone, c.deadzone);
  for (const k of ['invertPitch', 'autoLevel', 'swapSides', 'vibration'] as const) {
    const v = r[k];
    if (typeof v === 'boolean') c[k] = v;
  }
  if ((BUTTON_SIZES as readonly unknown[]).includes(r.buttonSize))
    c.buttonSize = r.buttonSize as ButtonSize;
  const keys = r.keys;
  if (typeof keys === 'object' && keys !== null) {
    for (const a of REMAPPABLE_ACTIONS) {
      const code = (keys as Record<string, unknown>)[a];
      if (isAssignableCode(code)) c.keys[a] = code;
    }
  }
  return c;
}

/** キーに割り当てられる code か（空・Esc は不可） */
export function isAssignableCode(code: unknown): code is string {
  return (
    typeof code === 'string' &&
    /^[A-Za-z0-9]{1,24}$/.test(code) &&
    !(CONTROL_SETTINGS.reservedCodes as readonly string[]).includes(code)
  );
}

/**
 * スティックの値（0〜1、デッドゾーン適用後）に感度を掛ける。1 で頭打ち。
 * 1 未満の感度では倒しきっても 1 に届かない（最大の角速度も下がる）。飛行モデルの数値は変えない
 */
export function applySensitivity(value: number, sensitivity: number): number {
  return Math.min(1, Math.max(0, value * sensitivity));
}

/**
 * キー割当を組み立てる。変更のあるアクションは主キー（初期の割当の先頭。WASD など）を差し替え、
 * 残り（矢印キーなど）は初期のまま
 */
export function buildKeyBindings(
  keys: Readonly<Partial<Record<RemappableAction, string>>>,
): KeyBindings {
  const out: Record<Action, readonly string[]> = { ...DEFAULT_KEYBINDS };
  for (const a of REMAPPABLE_ACTIONS) {
    const code = keys[a];
    if (code === undefined) continue;
    const rest = DEFAULT_KEYBINDS[a].slice(1).filter((c) => c !== code);
    out[a] = [code, ...rest];
  }
  return out;
}

/** 2 つ以上のアクションに割り当てられたキー（code → アクション） */
export function findKeyConflicts(bindings: KeyBindings): Map<string, Action[]> {
  const byCode = new Map<string, Action[]>();
  for (const a of ACTIONS) {
    for (const code of bindings[a]) {
      const list = byCode.get(code);
      if (list) list.push(a);
      else byCode.set(code, [a]);
    }
  }
  for (const [code, list] of byCode) if (list.length < 2) byCode.delete(code);
  return byCode;
}

/** action の主キーと重なっているほかのアクション（設定の警告） */
export function conflictsOf(bindings: KeyBindings, action: Action): Action[] {
  const code = bindings[action][0];
  if (code === undefined) return [];
  return (
    findKeyConflicts(bindings)
      .get(code)
      ?.filter((a) => a !== action) ?? []
  );
}

const KEY_NAMES: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: 'Shift',
  ShiftRight: '右Shift',
  ControlLeft: 'Ctrl',
  ControlRight: '右Ctrl',
  AltLeft: 'Alt',
  AltRight: '右Alt',
  Space: 'Space',
  Escape: 'Esc',
};

/** KeyboardEvent.code の表示名（KeyW → W、Digit1 → 1、ArrowUp → ↑） */
export function keyLabel(code: string): string {
  const named = KEY_NAMES[code];
  if (named) return named;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num${code.slice(6)}`;
  return code;
}
