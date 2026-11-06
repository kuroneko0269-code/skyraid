// 9-10d: 画面の作り直し（練習場の結果・レイドの怪獣選び・ロビー）の DOM 非依存の部分
import { afterEach, describe, expect, it } from 'vitest';
import { PRACTICE_GOODS, PRACTICE_ISSUES } from '../src/data/practice-advice';
import { KAIJU_PROFILES } from '../src/data/kaiju-profiles';
import { RAID_KAIJU_IDS } from '../src/data/raid-kaiju';
import { NET_CONFIG } from '../src/data/net';
import { AIRCRAFT_MODELS } from '../src/data/aircraft';
import { defaultPaint } from '../src/progression/paint';
import { WEATHER_PRESETS, weatherShortLabel } from '../src/data/weather';
import type { PracticeResult } from '../src/missions/practice/score';
import type { GameSettings, PlayerInfo } from '../src/net/protocol';
import { goodTitle, issueFix, issueTitle } from '../src/ui/practice-advice-text';
import {
  flaggedMetrics,
  GOOD_METRIC,
  ISSUE_METRIC,
  metricView,
  PRACTICE_METRICS,
} from '../src/ui/practice-metrics';
import { roomTitle, seatGroups, seatStatus, waitText } from '../src/ui/lobby-text';
import { t } from '../src/core/i18n';
import { useLocale } from './i18n-helpers';

afterEach(() => {
  useLocale('ja');
});

const RESULT: PracticeResult = {
  drill: 'bandit',
  seconds: 90,
  score: 698,
  kills: 6,
  shots: 111,
  hits: 20,
  accuracy: 20 / 111,
  avgKillSeconds: 12.01,
  offAim: 0.7876,
  offScreen: 0.1782,
  offScreenSeconds: 14.6,
  overshoots: 52,
  overshootPerMinute: 34.7,
  offRange: 0.6,
  overtakes: 6,
  advice: 'offAim',
  issues: ['overtake', 'offRange', 'offAim'],
  good: 'fastKills',
};

const CONTEXTS = [
  { touch: false, autoFire: false, speedMatch: false },
  { touch: true, autoFire: true, speedMatch: true },
  { touch: true, autoFire: false, speedMatch: false },
];

describe('練習場の結果の指標と助言の札（9-10d）', () => {
  it('指標は 8 つ。どの助言・良かった点も指標に結び付く', () => {
    expect(PRACTICE_METRICS).toHaveLength(8);
    for (const k of PRACTICE_ISSUES) expect(PRACTICE_METRICS).toContain(ISSUE_METRIC[k]);
    for (const k of PRACTICE_GOODS) {
      const m = GOOD_METRIC[k];
      if (m !== null) expect(PRACTICE_METRICS).toContain(m);
    }
  });

  it('札の数と補足（例: 6 回・60%・20 / 111 発）', () => {
    expect(metricView('overtakes', RESULT).value).toBe('6 回');
    expect(metricView('offRange', RESULT).value).toBe('60.0%');
    expect(metricView('accuracy', RESULT).sub).toBe('20 / 111 発');
    expect(metricView('kills', RESULT).sub).toBe('90 秒で');
    expect(metricView('avgKill', RESULT).value).toBe('12.0 秒');
    expect(metricView('offScreen', RESULT).sub).toContain('17.8%');
    // 撃っていない・撃墜なし・対象なし
    const none = {
      ...RESULT,
      shots: 0,
      hits: 0,
      accuracy: null,
      avgKillSeconds: null,
      offScreen: null,
    };
    expect(metricView('accuracy', none).value).toBe('—');
    expect(metricView('avgKill', none).sub).toBe('撃墜なし');
    expect(metricView('offScreen', none).value).toBe('—');
  });

  it('助言に出た指標だけをオレンジの枠にする', () => {
    expect([...flaggedMetrics(RESULT.issues)].sort()).toEqual(['offAim', 'offRange', 'overtakes']);
    expect(flaggedMetrics([]).size).toBe(0);
  });

  it('見出し・直し方・良かった点の文が日本語・英語ともそろっている（キーのままにならない）', () => {
    for (const lang of ['ja', 'en'] as const) {
      useLocale(lang);
      for (const k of PRACTICE_ISSUES) {
        expect(issueTitle(k)).not.toContain('practice.');
        for (const c of CONTEXTS) expect(issueFix(k, c)).not.toContain('practice.');
      }
      for (const k of PRACTICE_GOODS) expect(goodTitle(k, RESULT)).not.toContain('practice.');
      for (const m of PRACTICE_METRICS) {
        const v = metricView(m, RESULT);
        for (const s of [v.label, v.short, v.sub]) expect(s).not.toMatch(/practice\.|\{/);
      }
    }
  });
});

describe('レイドの怪獣選び（9-10d）', () => {
  it('レイドの怪獣はすべて紹介があり、画像は public/kaiju-art の webp', () => {
    for (const id of RAID_KAIJU_IDS) {
      const p = KAIJU_PROFILES.find((x) => x.id === id);
      expect(p).toBeDefined();
      expect(p?.art).toBe(`kaiju-art/${id}.webp`);
    }
  });

  it('紹介の文（一言・概要・攻撃・攻めどき・難易度）が日本語・英語ともそろっている', () => {
    for (const lang of ['ja', 'en'] as const) {
      useLocale(lang);
      for (const p of KAIJU_PROFILES) {
        const k = `raidSelect.kaiju.${p.id}`;
        const keys = ['tagline', 'size', 'motion', 'parts', 'opening', 'normal', 'hard'].map(
          (x) => `${k}.${x}`,
        );
        for (const a of p.attacks) keys.push(`${k}.attacks.${a}.name`, `${k}.attacks.${a}.note`);
        for (const key of keys) expect(t(key)).not.toBe(key);
      }
    }
  });
});

const FIRST_MODEL = AIRCRAFT_MODELS[0];
if (!FIRST_MODEL) throw new Error('機体がありません');
const PAINT = defaultPaint(FIRST_MODEL.shape, 0);

const player = (id: number, team: number, ready: boolean, away = false): PlayerInfo => ({
  id,
  name: `P${id}`,
  aircraftId: 'kestrel',
  paint: PAINT,
  maxHp: 100,
  team,
  ready,
  again: false,
  away,
});

const settings = (mode: GameSettings['mode']): GameSettings => ({
  ...NET_CONFIG.defaultSettings,
  mode,
});

describe('ロビーの部屋の画面（9-10d）', () => {
  it('席: 個人戦は 4 席（空きは null）、チーム戦はチームごとに 2 席', () => {
    const ps = [player(0, 0, false), player(1, 1, true), player(2, 0, false)];
    const ffa = seatGroups(ps, false);
    expect(ffa).toHaveLength(1);
    expect(ffa[0]?.seats.map((p) => p?.id ?? null)).toEqual([0, 1, 2, null]);
    const team = seatGroups(ps, true);
    expect(team.map((g) => g.team)).toEqual([0, 1]);
    expect(team[0]?.seats.map((p) => p?.id ?? null)).toEqual([0, 2]);
    expect(team[1]?.seats.map((p) => p?.id ?? null)).toEqual([1, null]);
  });

  it('席の状態: ホストは準備OK、再接続中が先', () => {
    expect(seatStatus(player(0, 0, false))).toBe('ready');
    expect(seatStatus(player(1, 0, false))).toBe('preparing');
    expect(seatStatus(player(2, 0, true))).toBe('ready');
    expect(seatStatus(player(3, 0, true, true))).toBe('away');
  });

  it('題: PvP · 個人戦 / 協力レイド · 怪獣 / 協力防衛戦 · マップ', () => {
    expect(roomTitle(settings('ffa'))).toBe('PvP · 個人戦');
    expect(roomTitle(settings('team'))).toBe('PvP · チーム戦（2 対 2）');
    expect(roomTitle({ ...settings('raid'), raidKaiju: 1 })).toBe('協力レイド · ネフィルガ');
    expect(roomTitle(settings('defense'))).toContain('協力防衛戦 · ');
  });

  it('待ちの文: 準備OKの数・ホストの開始・自分の準備', () => {
    const ps = [player(0, 0, false), player(1, 1, true), player(2, 0, false)];
    const base = { localId: 0, players: ps, settings: settings('ffa') };
    expect(waitText({ ...base, isHost: true })).toBe('全員の「準備OK」を待っています（2 / 3）');
    expect(waitText({ ...base, isHost: false, localId: 1 })).toBe(t('lobby.wait.host'));
    expect(waitText({ ...base, isHost: false, localId: 2 })).toBe(t('lobby.wait.pick'));
    expect(waitText({ ...base, isHost: true, players: [player(0, 0, false)] })).toBe(
      t('lobby.block.players'),
    );
    expect(
      waitText({ ...base, isHost: true, players: [player(0, 0, false), player(1, 1, true)] }),
    ).toBe(t('lobby.wait.allReady'));
  });

  it('天候の短い名前は 8 つとも違う（風は省く）', () => {
    for (const lang of ['ja', 'en'] as const) {
      useLocale(lang);
      const names = WEATHER_PRESETS.map((w) => weatherShortLabel(w.id));
      expect(new Set(names).size).toBe(WEATHER_PRESETS.length);
    }
  });
});
