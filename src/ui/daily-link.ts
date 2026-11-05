// 日替わりチャレンジ（9-9）と画面・セーブ・オンラインの配線: モード選択の「日替わり」→ 日替わりの画面 → 飛行（練習場の課題か
// 周回のレース。条件の機体・天候・強化なし）→ 終わったら記録（その日の最高・補助の組・挑戦の回数・連続日数）して日替わりの画面へ戻り、
// 今回の結果を出す。オンライン連携の連携中なら、まだ送っていない最高を送る（つながっていなければセーブに残して後で送る）。
// 練習場・レースの記録・報酬・ゴースト・クレジットは出さない（practice-link・race-link はそれぞれの選択が無いので記録しない）。
// リプレイの再生中は記録しない。日付は画面を開くたび・挑戦するたびに読み直す（日本時間の 0 時をまたいだら次の課題）
import type { GameState } from '../core/game-state';
import { usesDemoCamera } from '../core/game-state';
import { t } from '../core/i18n';
import type { Input } from '../core/input';
import { assistPresetOf } from '../core/assist-preset';
import { dailyChannel } from '../online/daily-channel';
import { dailyPracticeValue, dailyRaceValue } from '../missions/daily/setup';
import { dailySpecAt, dailySpecKey, type DailySpec } from '../missions/daily/schedule';
import type { GamePlay } from '../missions/game-play';
import {
  currentStreak,
  markDailySent,
  recordDaily,
  unsentDaily,
  type DailyPreset,
} from '../progression/daily-records';
import type { SaveStore } from '../progression/save-store';
import type { WeatherView } from '../render/weather/weather-view';
import type { ReplayHub } from '../replay/hub';
import { DAILY_RANKING_ENABLED } from '../data/online';
import { DailyScreen, formatDailyValue } from './daily-screen';
import { dailyKindLabel } from '../data/daily';
import type { Screens } from './screens';

export interface DailyLinkParts {
  readonly game: GameState;
  readonly screens: Screens;
  readonly play: GamePlay;
  readonly save: SaveStore;
  readonly input: Pick<Input, 'lastDevice'>;
  readonly weather: WeatherView;
  readonly replay: ReplayHub;
  /** 時刻（テスト用に差し替え） */
  readonly now?: () => number;
}

export interface DailyLink {
  /** 飛ぶ（飛んだばかりの）日替わりの条件。メニューへ戻ると null */
  readonly selection: DailySpec | null;
  afterStart(replaying: boolean, spec: DailySpec): void;
  render(): void;
}

/** 今の補助の組（タッチの端末だけ組で数える。キーボード・パッドは組の補助を使わないのでカスタム） */
export function dailyPresetOf(save: SaveStore, device: string): DailyPreset {
  if (device !== 'touch') return 'custom';
  const c = save.settings.controls;
  if (!save.settings.assist.aim) return 'custom';
  return assistPresetOf(c);
}

export function createDailyLink(p: DailyLinkParts): DailyLink {
  const { game, screens, play, save, replay } = p;
  const now = p.now ?? (() => Date.now());
  let selection: DailySpec | null = null;
  /** 始めたときの補助の組（途中で変えても始めの組で記録する） */
  let startPreset: DailyPreset = 'custom';
  /** この回を記録したか */
  let recorded = true;

  const records = () => save.snapshot.records.daily;
  const screen = new DailyScreen(
    document.body,
    {
      spec: () => dailySpecAt(now()),
      entry: () => {
        const s = dailySpecAt(now());
        const e = records().days[s.day];
        return e && e.spec === dailySpecKey(s) ? e : null;
      },
      streak: () => currentStreak(records(), dailySpecAt(now()).day),
      preset: () => dailyPresetOf(save, p.input.lastDevice),
      rankingState: () => {
        if (!dailyChannel.connected) return 'off';
        if (!DAILY_RANKING_ENABLED) return 'pending';
        return dailyChannel.active ? 'on' : 'off';
      },
      ranking: () => {
        const s = dailySpecAt(now());
        return dailyChannel.ranking(s.day, dailySpecKey(s));
      },
      selfId: () => dailyChannel.selfId,
    },
    {
      onStart: () => {
        selection = dailySpecAt(now());
        screens.nextMission = null;
        game.transition('flight');
      },
      onBack: () => game.transition('mode_select'),
    },
  );
  screens.inDaily = () => selection !== null;
  // モード選択のカード: 今日の課題（種類と難しさ）と、連続日数・今日の最高
  const modeSelect = screens.modeSelect;
  modeSelect.dailyToday = () => {
    const s = dailySpecAt(now());
    return t('daily.today', {
      kind: dailyKindLabel(s.kind).name,
      stars: '★'.repeat(s.tier) + '☆'.repeat(3 - s.tier),
    });
  };
  const baseProgress = modeSelect.progress;
  modeSelect.progress = () => {
    const s = dailySpecAt(now());
    const e = records().days[s.day];
    const best = e && e.spec === dailySpecKey(s) ? e.best : null;
    const days = currentStreak(records(), s.day);
    const daily =
      best === null && days === 0
        ? t('progress.dailyNew')
        : t('progress.daily', { days, best: formatDailyValue(s.kind, best) });
    return { ...baseProgress(), daily };
  };
  dailyChannel.onChange(() => {
    if (game.state === 'daily_select') screen.refresh();
  });
  // 起動・ログインのときにまだ送っていない最高を送る（online-app がつないだ直後にも呼ぶ）
  dailyChannel.setSource({
    unsent: () => unsentDaily(records(), dailySpecAt(now()).day),
    markSent: (day, value) => {
      save.transact((data) => markDailySent(data.records.daily, day, value));
    },
  });

  game.onChange(({ from, to }) => {
    if (to === 'daily_select' && from === 'mode_select') screen.setLastPlay(null);
    screen.setShown(to === 'daily_select');
    if (usesDemoCamera(to) && to !== 'daily_select') selection = null;
    if (to === 'hangar') selection = null;
  });

  /** 終わった回を記録して画面へ戻る */
  const finish = (spec: DailySpec, value: number | null): void => {
    recorded = true;
    const out: { newBest: boolean } = { newBest: false };
    save.transact((data) => {
      const o = recordDaily(data.records.daily, {
        day: spec.day,
        spec: dailySpecKey(spec),
        kind: spec.kind,
        value,
        preset: startPreset,
        at: now(),
      });
      out.newBest = o.newBest;
      return true;
    });
    screen.setLastPlay({ value, newBest: out.newBest });
    void dailyChannel.flush();
    game.transition('daily_select');
  };

  return {
    get selection() {
      return selection;
    },
    afterStart(replaying, spec) {
      // 条件の天候（7-5 の天候の配線・レースの天候の後に呼ばれて上書きする）。時間は止める
      p.weather.set(spec.weatherId);
      p.weather.setTimeFlow(false);
      if (replaying) return;
      recorded = false;
      // 中断して戻ったときに前の回の結果を出さない
      screen.setLastPlay(null);
      startPreset = dailyPresetOf(save, p.input.lastDevice);
      screens.pause.setInMission(true, t('daily.abort'));
    },
    render() {
      const spec = selection;
      if (!spec || recorded || replay.playing || game.state !== 'flight') return;
      const practice = play.practice;
      if (practice?.readyForResult && practice.result) {
        finish(spec, dailyPracticeValue(practice.result.score));
        return;
      }
      const race = play.race;
      if (race?.readyForResult && race.result) finish(spec, dailyRaceValue(race.result));
    },
  };
}
