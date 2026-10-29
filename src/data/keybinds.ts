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
] as const;

export type Action = (typeof ACTIONS)[number];

export type KeyBindings = Readonly<Record<Action, readonly string[]>>;

export const DEFAULT_KEYBINDS: KeyBindings = {
  pitchUp: ['KeyS', 'ArrowDown'],
  pitchDown: ['KeyW', 'ArrowUp'],
  rollLeft: ['KeyA', 'ArrowLeft'],
  rollRight: ['KeyD', 'ArrowRight'],
  yawLeft: ['KeyQ'],
  yawRight: ['KeyE'],
  throttleUp: ['ShiftLeft', 'ShiftRight'],
  throttleDown: ['ControlLeft', 'ControlRight'],
  fire: ['Space'],
  missile: ['KeyF'],
  targetNext: ['Tab'],
  cameraToggle: ['KeyC'],
};
