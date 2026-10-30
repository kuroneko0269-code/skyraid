// 操作設定（4-11）の配線: 設定の値を入力（感度・キー割当）・タッチ操作（デッドゾーン・左右入替・大きさ）・
// 機体（ピッチ反転・オートレベル。URL の ?invert / ?autolevel があればそちらを優先）・振動に効かせる
import { buildKeyBindings, type ControlSettings } from '../core/control-settings';
import type { FlightControlOptions } from '../core/flight-options';
import type { Input } from '../core/input';
import { Vibrator } from '../core/vibration';
import { CONTROL_SETTINGS } from '../data/controls';
import type { FlightSession } from '../missions/flight-session';
import type { SaveStore } from '../progression/save-store';
import type { FxEvents } from '../render/fx/fx-events';
import { createControlSettings } from './control-settings';
import type { TouchControls } from './touch-controls';

export function createControlsLink(
  panel: HTMLElement,
  save: SaveStore,
  input: Input,
  touch: TouchControls,
  session: FlightSession,
  fxEvents: FxEvents,
  urlOverrides: Readonly<Partial<FlightControlOptions>>,
): void {
  const vibrator = new Vibrator(typeof navigator === 'undefined' ? undefined : navigator);
  // 振動: 被弾・自機のミサイル発射・撃墜
  fxEvents.add({
    playerHit: () => {
      vibrator.pulse('hit');
    },
    missileLaunch: (_x, _y, _z, _dx, _dy, _dz, byPlayer) => {
      if (byPlayer) vibrator.pulse('launch');
    },
    playerKill: () => {
      vibrator.pulse('kill');
    },
  });
  let keys = '';
  createControlSettings(panel, save, vibrator.supported, (c: Readonly<ControlSettings>) => {
    input.stickSensitivity = c.sensitivity;
    // 割り当てを変えたときだけ（setBindings は押しているキーを離した扱いにする）
    const nextKeys = JSON.stringify(c.keys);
    if (nextKeys !== keys) {
      keys = nextKeys;
      input.setBindings(buildKeyBindings(c.keys));
    }
    touch.configure(c.deadzone, c.swapSides, CONTROL_SETTINGS.buttonScale[c.buttonSize]);
    const options = session.aircraft.flight.options;
    options.invertPitch = urlOverrides.invertPitch ?? c.invertPitch;
    options.autoLevel = urlOverrides.autoLevel ?? c.autoLevel;
    vibrator.enabled = c.vibration;
  });
}
