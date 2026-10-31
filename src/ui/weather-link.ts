// 天候（7-5）と画面・HUD・音の配線（main.ts から分けた）: メニューの背景の天候、ブリーフィングの天候の下見、
// ロビーのホスト設定の天候、HUD のマーカーの距離と夜の減光（設定は settings-link.ts）、雨・風・夜の環境音。
// 開発用: ?weather=<プリセット id> でフリーフライトの天候、?timeflow で「時間が流れる」を ON にしておく
import type { WeatherSoundInput } from '../audio/params';
import type { GameAudio } from '../audio/game-audio';
import { isResume, type GameState } from '../core/game-state';
import {
  DEFAULT_WEATHER_ID,
  isWeatherId,
  missionWeather,
  NIGHT_CONFIG,
  weatherForFlight,
} from '../data/weather';
import type { SaveStore } from '../progression/save-store';
import type { HudLink } from '../render/hud-link';
import type { WeatherView } from '../render/weather/weather-view';
import type { Hud } from './hud';
import type { PvpEntry } from './pvp-entry';
import type { Screens } from './screens';

export interface WeatherLinkParts {
  readonly game: GameState;
  readonly screens: Screens;
  readonly pvp: PvpEntry;
  readonly hud: Hud;
  readonly hudLink: HudLink;
  readonly audio: GameAudio;
  readonly save: SaveStore;
}

/** 夜の HUD の不透明度（夜らしさ 0〜1。無効なら 1） */
export function nightHudOpacity(night: number, enabled: boolean): number {
  if (!enabled) return 1;
  return 1 - (1 - NIGHT_CONFIG.hudDim) * Math.min(1, Math.max(0, night));
}

/**
 * 天候を画面の流れにつなぐ。飛行の始め（ポーズからの再開以外）は、PvP・協力（ロビーから）はホスト設定、
 * ミッションは固定、フリーフライトはモード選択の天候にし、時間が流れるのはフリーフライトだけ。
 * 今の空から 3 秒で移る
 */
export function linkWeather(weather: WeatherView, p: WeatherLinkParts): void {
  const { screens } = p;
  const params = new URLSearchParams(window.location.search);
  const q = params.get('weather');
  if (isWeatherId(q)) screens.modeSelect.freeWeatherId = q;
  if (params.has('timeflow')) screens.modeSelect.freeTimeFlow = true;

  p.game.onChange(({ from, to }) => {
    if (to === 'flight' && !isResume(from)) {
      const net = from === 'lobby';
      const def = screens.nextMission;
      const mode = screens.modeSelect;
      const id = weatherForFlight(net, def?.id ?? null, p.pvp.weatherId, mode.freeWeatherId);
      // ?skipTitle で起動からすぐ飛ぶとき（開発・確認用）は補間しない
      weather.set(id, from === 'boot');
      weather.setTimeFlow(!net && !def && mode.freeTimeFlow);
    } else if (to === 'title' || to === 'mode_select' || to === 'mission_select') {
      // メニューの背景は昼・快晴。ブリーフィングはそのミッションの天候を下見する
      weather.set(DEFAULT_WEATHER_ID);
      weather.setTimeFlow(false);
    } else if (to === 'briefing' && screens.nextMission) {
      weather.set(missionWeather(screens.nextMission.id));
      weather.setTimeFlow(false);
    }
  });

  // HUD: 霧・雨・夜は敵のマーカーを索敵距離の 60% まで（レーダーは出る）
  p.hudLink.visibility = () => weather.lowVisibility;

  const sound: WeatherSoundInput = { rain: 0, wind: 0, night: 0 };
  p.audio.weather = () => {
    const w = weather.params;
    sound.rain = w.rain;
    sound.wind = w.wind;
    sound.night = weather.night;
    return sound;
  };

  let lastOpacity = '';
  weather.onFrame = () => {
    // ロビーではホストが選んだ天候を背景に下見する（変わったときだけ補間が始まる）
    if (p.game.state === 'lobby') weather.set(p.pvp.weatherId);
    const dim = p.save.settings.nightHudDim;
    const opacity = String(Math.round(nightHudOpacity(weather.night, dim) * 100) / 100);
    if (opacity !== lastOpacity) {
      lastOpacity = opacity;
      // インラインの opacity は画面で隠す CSS を上書きしてしまうので、変数で渡す（7-5b）
      p.hud.root.style.setProperty('--hud-night-opacity', opacity);
    }
  };
}
