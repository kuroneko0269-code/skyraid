// 天候と時間帯（7-5）: ミッションごとの天候の割当、welcome に天候が含まれること、HUD のマーカーの距離・夜の HUD・環境音
import { describe, expect, it } from 'vitest';
import { lowVisibilityOf, markerRange, presetParams } from '../src/core/weather-state';
import { MISSIONS } from '../src/data/missions';
import { RAID_MISSION } from '../src/data/missions-special';
import { NET_CONFIG } from '../src/data/net';
import {
  DEFAULT_WEATHER_ID,
  findWeather,
  missionWeather,
  NIGHT_CONFIG,
  RAID_COOP_DEFAULT_WEATHER,
  weatherForFlight,
} from '../src/data/weather';
import { initialSettings, normalizeSettings } from '../src/net/lobby-rules';
import { decodeMessage, encodeMessage } from '../src/net/message-codec';
import type { WelcomeMsg } from '../src/net/protocol';
import { weatherSoundParams } from '../src/audio/params';
import { nightHudOpacity } from '../src/ui/weather-link';
import { createLobby, pump } from './net-helpers';

describe('天候: モードごとの割当', () => {
  it('キャンペーン: M1 昼・M2 早朝・M3 曇り・M4 夕方・M5 夜・雨', () => {
    const ids = MISSIONS.map((m) => missionWeather(m.id));
    expect(MISSIONS).toHaveLength(5);
    expect(ids).toEqual(['day-clear', 'dawn-clear', 'day-overcast', 'evening-clear', 'night-rain']);
    expect(findWeather(ids[2] ?? '').sky).toBe('overcast');
    expect(findWeather(ids[4] ?? '')).toMatchObject({ time: 'night', sky: 'rain' });
  });

  it('ソロのレイドは夕方・快晴、協力はホストの選択（初期値は夕方・快晴）', () => {
    expect(weatherForFlight(false, RAID_MISSION.id, 'day-clear', 'day-clear')).toBe(
      'evening-clear',
    );
    expect(weatherForFlight(true, RAID_MISSION.id, 'night-rain', 'day-clear')).toBe('night-rain');
    expect(initialSettings(true)?.weather).toBe(RAID_COOP_DEFAULT_WEATHER);
    expect(RAID_COOP_DEFAULT_WEATHER).toBe('evening-clear');
  });

  it('フリーフライトはモード選択のプリセット、PvP はロビーのホスト設定（知らない id は初期値）', () => {
    expect(weatherForFlight(false, null, 'night-rain', 'dawn-fog')).toBe('dawn-fog');
    expect(weatherForFlight(true, null, 'night-rain', 'dawn-fog')).toBe('night-rain');
    expect(weatherForFlight(true, null, 'bogus', 'dawn-fog')).toBe(DEFAULT_WEATHER_ID);
    expect(NET_CONFIG.defaultSettings.weather).toBe(DEFAULT_WEATHER_ID);
    expect(normalizeSettings({ ...NET_CONFIG.defaultSettings, weather: 'bogus' }).weather).toBe(
      DEFAULT_WEATHER_ID,
    );
  });
});

describe('天候: welcome に天候が含まれる', () => {
  it('welcome の直列化で天候が往復する', () => {
    const msg: WelcomeMsg = {
      type: 'welcome',
      status: 'ok',
      yourId: 1,
      yourToken: 7,
      inMatch: false,
      settings: { ...NET_CONFIG.defaultSettings, weather: 'dawn-fog' },
      players: [],
    };
    const back = decodeMessage(encodeMessage(msg));
    expect(back).toEqual(msg);
  });

  it('ホストが天候を変えると、全員の名簿の welcome で同じ天候になる', async () => {
    const { net, host, clients } = await createLobby(2);
    host.setSettings({ ...host.settings, weather: 'night-rain' });
    await pump(net, 100, [host, ...clients]);
    for (const c of clients) expect(c.settings.weather).toBe('night-rain');
  });
});

describe('天候: HUD と音', () => {
  it('霧・雨・夜は敵のマーカーが索敵距離の 60% まで、昼・快晴は 100%', () => {
    expect(markerRange(5000, lowVisibilityOf(presetParams('day-clear')))).toBe(5000);
    for (const id of ['dawn-fog', 'day-rain', 'night-clear', 'night-rain'])
      expect(markerRange(5000, lowVisibilityOf(presetParams(id)))).toBeCloseTo(3000, 6);
    expect(markerRange(5000, lowVisibilityOf(presetParams('day-overcast')))).toBe(5000);
  });

  it('夜の HUD は少し暗く、設定で無効にできる', () => {
    expect(nightHudOpacity(0, true)).toBe(1);
    expect(nightHudOpacity(1, true)).toBeCloseTo(NIGHT_CONFIG.hudDim, 9);
    expect(nightHudOpacity(1, false)).toBe(1);
  });

  it('雨は小さなノイズ、強風は風切り音を大きく、夜は環境音を静かに', () => {
    const calm = weatherSoundParams({ rain: 0, wind: 0, night: 0 }, 0);
    expect(calm.rainGain).toBe(0);
    expect(calm.windScale).toBe(1);
    const storm = weatherSoundParams({ rain: 1, wind: 1, night: 0 }, 0);
    expect(storm.rainGain).toBeGreaterThan(0);
    expect(storm.rainGain).toBeLessThan(0.1);
    expect(storm.windScale).toBeGreaterThan(1.4);
    const nightStorm = weatherSoundParams({ rain: 1, wind: 1, night: 1 }, 0);
    expect(nightStorm.rainGain).toBeLessThan(storm.rainGain);
    expect(nightStorm.windScale).toBeLessThan(storm.windScale);
  });
});
