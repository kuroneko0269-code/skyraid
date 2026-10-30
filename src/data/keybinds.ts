// キーボードのキー割当。値は KeyboardEvent.code（配列レイアウト非依存の物理位置）
// docs/spec.md「操作」の表に対応。ピッチは操縦桿の感覚（W/↑ = 機首下げ）

export const ACTIONS = [
  'pitchUp',
  'pitchDown',
  'rollLeft',
  'rollRight',
  'yawLeft',
  'yawRight',
  'throttleUp',
  'throttleDown',
  'fire',
  'missile',
  'targetNext',
  'cameraToggle',
  'afterburner',
  'flare',
  'rocket',
  'bomb',
  'secondary',
  'bombHold',
  'debugToggle',
  'hudToggle',
  'pause',
] as const;

export type Action = (typeof ACTIONS)[number];

/**
 * キーを割り当てないアクション（タッチ・パッドの長押しで使う。2-6）。
 * secondary: タッチの MSL ボタン（短く押すと今の兵装を撃ち、長押しでミサイル ⇄ ロケットを切替）。
 * bombHold: タッチの AB ボタン・パッドの RT（長押しで爆弾を投下。AB・ヨーと兼ねる）
 */
export const ANALOG_ONLY_ACTIONS: readonly Action[] = ['secondary', 'bombHold'];

export type KeyBindings = Readonly<Record<Action, readonly string[]>>;

export const DEFAULT_KEYBINDS: KeyBindings = {
  pitchUp: ['KeyS', 'ArrowDown'],
  pitchDown: ['KeyW', 'ArrowUp'],
  rollLeft: ['KeyA', 'ArrowLeft'],
  rollRight: ['KeyD', 'ArrowRight'],
  yawLeft: ['KeyQ'],
  yawRight: ['KeyE'],
  throttleUp: ['ShiftLeft', 'ShiftRight'],
  throttleDown: ['KeyZ'],
  fire: ['Space'],
  missile: ['KeyF'],
  targetNext: ['Tab'],
  cameraToggle: ['KeyC'],
  afterburner: ['KeyR'],
  flare: ['KeyX'],
  rocket: ['KeyG'],
  bomb: ['KeyB'],
  secondary: [],
  bombHold: [],
  debugToggle: ['F3'],
  hudToggle: ['KeyH'],
  pause: ['Escape'],
};
