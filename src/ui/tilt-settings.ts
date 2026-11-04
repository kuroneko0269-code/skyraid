// 傾き操作（9-4）の設定の側: 操縦（タッチ）の選択肢（傾きの使えない端末には出さない）、iOS の許可のボタン、
// 使えなかったときの理由と元の方式への戻し、起動時に保存されていた傾きの再開
import type { ControlSettings } from '../core/control-settings';
import { t } from '../core/i18n';
import { STEER_LABELS, STEER_MODES, type SteerMode } from '../data/steer';
import type { SaveStore } from '../progression/save-store';
import type { GameState } from '../core/game-state';
import type { PauseMenu } from './pause';
import type { TouchLink } from './touch-link';
import { el } from './hud-dom';
import { TiltSource, type TiltResult } from './tilt-source';
import { showToast } from './toast';

/** 効かせる方式: 傾きは使える状態（値が来ている）になるまで「方向へ倒す」 */
export function effectiveSteerMode(mode: SteerMode, tilt: Pick<TiltSource, 'ready'>): SteerMode {
  return mode === 'tilt' && !tilt.ready ? 'direct' : mode;
}

/** 使えなかった理由の文 */
function failureText(r: TiltResult): string {
  return r === 'denied' ? t('controls.steer.tiltDenied') : t('controls.steer.tiltUnsupported');
}

const NOTICE_SECONDS = 6;

/**
 * 起動時: 傾きが保存されていれば使い始める（iOS は許可にボタン操作が要るので、次のタップで求める）。
 * 使えない端末・許可されなかった・値が来ないときは理由を出して「方向へ倒す」に戻し、保存する
 */
export function linkTiltStartup(
  save: SaveStore,
  tilt: TiltSource,
  reapply: () => void,
  sync: (mode: SteerMode) => void,
): void {
  tilt.onReadyChange = reapply;
  if (save.settings.controls.steerMode !== 'tilt') return;
  const fallback = (r: TiltResult): void => {
    save.updateControls((c) => (c.steerMode = 'direct'));
    sync('direct');
    reapply();
    showToast(failureText(r), { seconds: NOTICE_SECONDS });
  };
  if (!TiltSource.usable()) {
    save.updateControls((c) => (c.steerMode = 'direct'));
    sync('direct');
    reapply();
    return;
  }
  const done = (r: TiltResult): void => {
    if (r !== 'ok' && r !== 'needsGesture') fallback(r);
  };
  void tilt.enable(false).then((r) => {
    if (r === 'needsGesture') tilt.enableOnNextGesture(done);
    else done(r);
  });
}

/**
 * 操縦（タッチ）の選択肢（9-2 の select に 9-4 の傾き・ドラッグ）。傾きを選ぶと、許可が要る端末（iOS）は「傾きを使う」ボタンを出し、
 * 押したときに許可を求める。使えると分かってから保存する。使えなければ理由を出して元の方式に戻す
 */
export function createSteerModeChoice(
  parent: HTMLElement,
  c: Readonly<ControlSettings>,
  tilt: TiltSource,
  commit: (mode: SteerMode) => void,
): { sync: (mode: SteerMode) => void } {
  const modes = STEER_MODES.filter((m) => m !== 'tilt' || TiltSource.usable());
  const row = el('label', 'ui-toggle settings-item control-size', parent);
  row.textContent = `${STEER_LABELS.mode} `;
  const select = el('select', '', row);
  for (const m of modes) {
    const option = el('option', '', select, STEER_LABELS.modes[m]);
    option.value = m;
  }
  select.value = c.steerMode;
  const permit = el('button', 'ui-button settings-item control-tilt-permit', parent, '');
  permit.type = 'button';
  permit.textContent = t('controls.steer.tiltPermit');
  permit.hidden = true;
  const note = el('div', 'settings-item control-tilt-note', parent);
  note.hidden = true;
  let committed: SteerMode = c.steerMode;
  const say = (text: string): void => {
    note.textContent = text;
    note.hidden = text === '';
  };
  const finish = (r: TiltResult): void => {
    permit.hidden = true;
    if (r === 'ok') {
      committed = 'tilt';
      say(t('controls.steer.tiltReady'));
      commit('tilt');
      return;
    }
    tilt.disable();
    select.value = committed;
    say(failureText(r));
  };
  const start = (fromGesture: boolean): void => {
    say(t('controls.steer.tiltWaiting'));
    void tilt.enable(fromGesture).then((r) => {
      if (r === 'needsGesture') {
        permit.hidden = false;
        say('');
      } else finish(r);
    });
  };
  permit.addEventListener('click', () => {
    permit.blur();
    start(true);
  });
  select.addEventListener('change', () => {
    const v = modes.find((m) => m === select.value);
    // フォーカスが残ると矢印キー（ピッチ/ロール）で値が変わってしまうため外す
    select.blur();
    if (!v) return;
    say('');
    permit.hidden = true;
    if (v === 'tilt') {
      start(false);
      return;
    }
    if (committed === 'tilt') tilt.disable();
    committed = v;
    commit(v);
  });
  return {
    sync: (mode) => {
      committed = mode;
      select.value = mode;
    },
  };
}

/** 「水平を合わせ直す」（9-4。飛行中の ◎ ボタン・ポーズ）: 今の持ち方を中立にして知らせる */
export function levelTilt(tilt: Pick<TiltSource, 'calibrate'>): void {
  tilt.calibrate();
  showToast(t('controls.steer.tiltLeveled'), { seconds: 2 });
}

/** ポーズの「傾きを合わせ直す」（9-4。傾き操作のときだけ出す） */
export function linkTiltPause(game: GameState, pause: PauseMenu, touch: TouchLink): void {
  pause.onTiltLevel = () => {
    levelTilt(touch.tilt);
  };
  game.onChange(({ to }) => {
    if (to === 'pause') pause.setTiltLevelAvailable(touch.controls.mode === 'tilt');
  });
}
