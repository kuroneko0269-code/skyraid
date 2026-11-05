// 練習場（9-5）と画面・HUD・セーブの配線: モード選択の「練習場」→ 課題の一覧（設定の欄・設定ごとの記録）→ 飛行（数え → 課題）→
// 時間切れで記録（設定ごとの最高。途中で設定を変えたら記録しない）→ 結果（指標・助言・設定の欄・もう一度 / 練習場へ）。
// ポーズには「やり直す」と設定の欄。天候は昼・快晴で固定（比べやすさ）。クレジットは出さず、オンラインのランキングにも送らない。
// リプレイの再生中は記録・結果なし
import { usesDemoCamera, type GameState } from '../core/game-state';
import { t } from '../core/i18n';
import type { Input } from '../core/input';
import { viewport } from '../core/viewport';
import type { PracticeDrill } from '../data/practice';
import { DEFAULT_WEATHER_ID } from '../data/weather';
import type { GamePlay } from '../missions/game-play';
import type { PracticeRunner } from '../missions/practice/runner';
import type { PracticeResult } from '../missions/practice/score';
import {
  practiceSettingsKey,
  practiceSettingsOf,
  recordPractice,
  type PracticeRecordOutcome,
} from '../progression/practice-records';
import type { SaveStore } from '../progression/save-store';
import type { WeatherView } from '../render/weather/weather-view';
import type { ReplayHub } from '../replay/hub';
import { PracticeHud } from './practice-hud';
import { adviceContext, tipText } from './practice-advice-text';
import { HudTip } from './hud-tip';
import type { Hud } from './hud';
import { PRACTICE_TIPS_CONFIG } from '../data/practice-advice';
import { dailyKindLabel } from '../data/daily';
import { tipAllowed, tipDirection, type TipDirection } from '../missions/practice/tips';
import { PracticeResultScreen, type PracticeRecordState } from './practice-result';
import { PracticeSelectScreen } from './practice-select';
import { PracticeSettingsPanel } from './practice-settings';
import type { Screens } from './screens';
import type { TiltSource } from './tilt-source';

export interface PracticeLinkParts {
  readonly game: GameState;
  readonly screens: Screens;
  readonly play: GamePlay;
  readonly save: SaveStore;
  readonly input: Pick<Input, 'lastDevice' | 'steerMode'>;
  readonly weather: WeatherView;
  readonly tilt: TiltSource;
  /** 操作の設定を効かせ直し、設定画面の表示を合わせ直す（ui/controls-link.ts） */
  readonly controls: { apply(): void; sync(): void; onPresetPick(fn: () => void): void };
  readonly replay: ReplayHub;
  /** 9-5d: 飛行中の一言を照準の近くに出す */
  readonly hud: Hud;
}

export interface PracticeLink {
  /** 飛ぶ（飛んだばかりの）課題。メニューへ戻ると null */
  readonly selection: { readonly drill: PracticeDrill } | null;
  /** 狙いの指標に使う画面の縦横比（記録のヘッダ） */
  aspect(): number;
  /** 練習場を始めた直後（ui/flight-start.ts。世界は startFromHeader が作る） */
  afterStart(replaying: boolean): void;
  /** 描画フレームごと */
  render(): void;
  /** 結果の追加の欄（7-B: リプレイを保存） */
  readonly resultExtras: HTMLElement;
}

export function createPracticeLink(p: PracticeLinkParts): PracticeLink {
  const { game, screens, play, save, replay } = p;
  let selection: { drill: PracticeDrill } | null = null;
  /** 始めたときの設定の見出し（終わりと違えば記録しない） */
  let startKey = '';
  let pending: { result: PracticeResult; record: PracticeRecordState; settings: string } | null =
    null;
  const settingsKey = (): string => {
    const c = save.settings.controls;
    const s = practiceSettingsOf(
      c,
      p.input.lastDevice,
      p.input.steerMode,
      save.settings.assist.aim,
    );
    return practiceSettingsKey(s);
  };
  const panels: PracticeSettingsPanel[] = [];
  const changed = (): void => {
    p.controls.apply();
    p.controls.sync();
    for (const panel of panels) panel.sync();
    if (game.state === 'practice_select') select.refresh();
  };
  const select = new PracticeSelectScreen(
    document.body,
    {
      records: () => save.snapshot.records.practice,
      aircraftName: () => screens.hangar.selectedModel.name,
      settingsKey,
    },
    {
      onStart: (drill) => {
        selection = { drill };
        screens.nextMission = null;
        game.transition('flight');
      },
      onBack: () => game.transition('mode_select'),
    },
  );
  const result = new PracticeResultScreen(document.body, {
    onRetry: () => game.transition('flight'),
    onList: () => game.transition('practice_select'),
  });
  // 9-5c: 飛行中の一言（設定で OFF にできる）。9-5d: 照準の近くに出し、自動の補助に任せている一言（自動射撃 ON の射程外・
  // 速度合わせ ON の追い越し）は出さない（今の設定で決める）。見失いは的の向きの矢印と曲がる向き
  const tipView = new HudTip(p.hud);
  const dir: TipDirection = { side: 'right', angleDeg: 0, arrowDeg: 0 };
  const hud = new PracticeHud(
    document.body,
    {
      enabled: () => save.settings.controls.practiceTips && !replay.playing,
      allow: (tip) => tipAllowed(tip, adviceContext(settingsKey())),
      show: (tip) => {
        const s = play.session;
        const target = s.combat.targeting.selected;
        const d =
          tip === 'lost' && target
            ? tipDirection(
                dir,
                s.aircraft.state.orientation,
                s.aircraft.state.position,
                target.position,
              )
            : null;
        const text = tipText(tip, adviceContext(settingsKey()), d);
        if (text) tipView.show(text, PRACTICE_TIPS_CONFIG.showSeconds, d ? d.arrowDeg : null);
      },
      hide: () => {
        tipView.hide();
      },
    },
    // 9-10 の事前修正: 日替わり（記録・再生とも初期状態に条件がある）は日替わりの課題名
    () => {
      const daily = replay.current?.daily;
      return daily ? dailyKindLabel(daily.kind).name : null;
    },
  );
  for (const slot of [select.settingsSlot, screens.pause.extra, result.settingsSlot])
    panels.push(new PracticeSettingsPanel(slot, save, p.tilt, changed));
  // 9-5d: 設定画面で補助の組を選んだとき（ポーズから開いた設定など）
  const presetPicked = (): void => {
    for (const panel of panels) panel.sync();
    if (game.state === 'practice_select') select.refresh();
  };
  p.controls.onPresetPick(presetPicked);
  // チュートリアルの補助の章・初回のダイアログで選んだとき（設定画面の表示も合わせ直す）
  screens.tutorial.onPresetPick = () => {
    p.controls.sync();
    presetPicked();
  };
  screens.inPractice = () => selection !== null;
  screens.pause.onRestart = () => {
    game.restart();
  };

  game.onChange(({ to }) => {
    select.setShown(to === 'practice_select');
    result.setShown(to === 'result' && selection !== null);
    if (to === 'practice_select' || to === 'result' || to === 'pause')
      for (const panel of panels) panel.sync();
    if (to === 'pause') screens.pause.setPracticeAvailable(selection !== null && !replay.playing);
    if (usesDemoCamera(to) || to === 'hangar') {
      selection = null;
      pending = null;
    }
  });

  play.onPracticeChange((runner) => {
    pending = null;
    hud.attach(runner);
    if (runner) bind(runner);
  });

  /** 時間切れ: この設定・機体の最高なら記録する（途中で設定を変えたら記録しない） */
  const bind = (runner: PracticeRunner): void => {
    runner.bus.on('practice:end', ({ result: r }) => {
      // 9-9: 日替わりチャレンジ（練習場の選択が無い）は記録しない（daily-link.ts が日替わりの記録にする）
      if (replay.playing || selection === null) return;
      const key = settingsKey();
      let record: PracticeRecordState = { kind: 'changed' };
      if (key === startKey) {
        const saved: { out: PracticeRecordOutcome | null } = { out: null };
        save.transact((data) => {
          const aircraftId = screens.hangar.selectedId;
          const o = recordPractice(data.records.practice, r, key, aircraftId, Date.now());
          saved.out = o;
          return o.newSettingsBest;
        });
        if (saved.out) record = { kind: 'saved', out: saved.out };
      }
      pending = { result: r, record, settings: startKey };
    });
  };

  return {
    resultExtras: result.extras,
    get selection() {
      return selection;
    },
    aspect: () => viewport.width / Math.max(1, viewport.height),
    afterStart(replaying) {
      // 比べやすいよう天候は昼・快晴で固定（7-5 の天候の配線の後に呼ばれて上書きする）
      p.weather.set(DEFAULT_WEATHER_ID, true);
      p.weather.setTimeFlow(false);
      if (replaying) return;
      startKey = settingsKey();
      screens.pause.setInMission(true, t('practice.abort'));
    },
    render() {
      const runner = play.practice;
      if (!runner || game.state !== 'flight') return;
      hud.update();
      tipView.update();
      if (runner.readyForResult && pending && !replay.playing) {
        const r = pending;
        pending = null;
        result.show(r.result, r.record, { settings: r.settings, pilotName: save.pilotName });
        game.transition('result');
      }
    },
  };
}
