// 操作設定（4-11）の配線: 設定の値を入力（感度・キー割当）・タッチ操作（デッドゾーン・左右入替・大きさ・9-2 の方式・カーブ・位置）・
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
import type { TouchLink } from './touch-link';
import { effectiveSteerMode, levelTilt, linkTiltStartup } from './tilt-settings';

export function createControlsLink(
  panel: HTMLElement,
  save: SaveStore,
  input: Input,
  touchLink: TouchLink,
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
  const touch = touchLink.controls;
  const tilt = touchLink.tilt;
  const apply = (c: Readonly<ControlSettings>): void => {
    input.stickSensitivity = c.sensitivity;
    // 割り当てを変えたときだけ（setBindings は押しているキーを離した扱いにする）
    const nextKeys = JSON.stringify(c.keys);
    if (nextKeys !== keys) {
      keys = nextKeys;
      input.setBindings(buildKeyBindings(c.keys));
    }
    // 9-4: 傾きは使える状態になるまで「方向へ倒す」で（許可を待つ間・使えない端末）
    const mode = effectiveSteerMode(c.steerMode, tilt);
    if (mode === 'tilt' && touch.mode !== 'tilt') tilt.calibrate();
    tilt.reader.setOptions({ deadzone: c.deadzone, curve: c.stickCurve });
    touch.configure(c.deadzone, c.swapSides, CONTROL_SETTINGS.buttonScale[c.buttonSize], {
      mode,
      curve: c.stickCurve,
      fixed: c.stickPosition === 'fixed',
    });
    touchLink.refresh();
    const options = session.aircraft.flight.options;
    options.invertPitch = urlOverrides.invertPitch ?? c.invertPitch;
    options.autoLevel = urlOverrides.autoLevel ?? c.autoLevel;
    vibrator.enabled = c.vibration;
  };
  const ui = createControlSettings(panel, save, vibrator.supported, tilt, apply);
  // 9-4: 傾きを保存していれば使い始める（iOS は次のタップで許可を求める）。使えなければ「方向へ倒す」に戻す
  linkTiltStartup(
    save,
    tilt,
    () => {
      apply(save.settings.controls);
    },
    ui.syncSteerMode,
  );
  touch.onTiltLevel = () => {
    levelTilt(tilt);
  };
}
