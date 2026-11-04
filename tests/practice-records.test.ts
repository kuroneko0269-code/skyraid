// 練習場（9-5）の続き: スコアと助言・記録（設定ごと）・リプレイで同じ結果・画面の流れ・文（日本語・英語）・案内
import { describe, expect, it } from 'vitest';
import { defaultControls } from '../src/core/control-settings';
import { GameState } from '../src/core/game-state';
import { LOCALES } from '../src/core/locale';
import { PRACTICE_CONFIG, PRACTICE_DRILL_LABELS, PRACTICE_DRILLS } from '../src/data/practice';
import { buildPracticeResult, practiceAdvice, practiceScore } from '../src/missions/practice/score';
import {
  normalizePracticeRecords,
  parsePracticeSettings,
  practiceEntries,
  practiceSettingsKey,
  practiceSettingsOf,
  recordPractice,
  type PracticeRecords,
} from '../src/progression/practice-records';
import { createInitialSave } from '../src/progression/save';
import { modeProgress } from '../src/progression/mode-progress';
import { normalizeRecords } from '../src/progression/save-records';
import { replayOutcomeLabel, replayTitle } from '../src/replay/outcome';
import { ReplayRecorder } from '../src/replay/recorder';
import { applyFrame, captureFrame, simHash, startFromHeader, stepWorld } from '../src/replay/sim';
import type { ReplayStart } from '../src/replay/types';
import { formatRatio, practiceHintFor, practiceSettingsLabel } from '../src/ui/practice-text';
import { VETERAN } from './ai-sim';
import { useLocale } from './i18n-helpers';
import { DT } from './mission-bots';
import { PracticeBot } from './practice-bot';
import { BASE_START, createWorld, replay } from './replay-helpers';

describe('スコアと助言', () => {
  it('スコア = 撃墜 × (100 + 命中率 %)', () => {
    expect(practiceScore(7, 0.36)).toBe(Math.round(7 * 136));
    expect(practiceScore(0, 0.9)).toBe(0);
    expect(practiceScore(3, null)).toBe(300);
  });

  it('助言は上から: 撃っていない → 照準の外 → 画面の外 → 行き過ぎ → 撃墜なし → 安定', () => {
    const aim = {
      fireSteps: 100,
      fireInCone: 70,
      engagedSteps: 1000,
      offScreenSteps: 100,
      overshoots: 10,
      aliveSteps: 3600,
      fireOutOfRange: 25,
      overtakes: 2,
    };
    const counts = { kills: 3, shots: 100, hits: 30, killTimes: [5, 10, 15] };
    const r = buildPracticeResult('static', 60, counts, aim);
    expect(r.advice).toBe('steady');
    expect(r.avgKillSeconds).toBe(10);
    // 9-5b: 射程外で撃った割合・追い越した回数
    expect(r.offRange).toBe(0.25);
    expect(r.overtakes).toBe(2);
    expect(r.offAim).toBeCloseTo(0.3);
    expect(r.offScreen).toBeCloseTo(0.1);
    expect(r.offScreenSeconds).toBeCloseTo(100 / 60);
    expect(r.overshootPerMinute).toBeCloseTo(10);
    expect(practiceAdvice({ ...r, shots: 0 })).toBe('noShots');
    expect(practiceAdvice({ ...r, offAim: 0.9 })).toBe('offAim');
    // 撃った数が少ないうちは照準の外の割合で決めない
    expect(practiceAdvice({ ...r, offAim: 0.9, shots: 10 })).toBe('steady');
    expect(practiceAdvice({ ...r, offScreen: 0.6 })).toBe('offScreen');
    expect(practiceAdvice({ ...r, overshootPerMinute: 60 })).toBe('overshoot');
    expect(practiceAdvice({ ...r, kills: 0 })).toBe('noKills');
  });
});

describe('記録（設定ごと）', () => {
  const result = (score: number, drill: 'static' | 'moving' = 'static') => ({
    ...buildPracticeResult(
      drill,
      60,
      { kills: Math.floor(score / 100), shots: 10, hits: 1, killTimes: [] },
      {
        fireSteps: 0,
        fireInCone: 0,
        engagedSteps: 0,
        offScreenSteps: 0,
        overshoots: 0,
        aliveSteps: 0,
        fireOutOfRange: 0,
        overtakes: 0,
      },
    ),
    score,
  });

  it('設定の見出し: タッチは方式・補助（エイムアシスト OFF なら off）・自動射撃・カーブ、キーボード・パッドは入力系統だけ', () => {
    const c = defaultControls();
    const touch = practiceSettingsOf(c, 'touch', 'direct', true);
    // 9-5b: 速度合わせ ON（初期値）は末尾に :s。OFF は 9-5 の見出しのまま（9-5 の記録は速度合わせなしの記録として並ぶ）
    expect(practiceSettingsKey(touch)).toBe('touch:direct:normal:1:1.5:s');
    expect(practiceSettingsKey(practiceSettingsOf(c, 'touch', 'tilt', false))).toBe(
      'touch:tilt:off:1:1.5:s',
    );
    const off = practiceSettingsOf({ ...c, speedMatch: false }, 'touch', 'direct', true);
    expect(practiceSettingsKey(off)).toBe('touch:direct:normal:1:1.5');
    expect(practiceSettingsKey(practiceSettingsOf(c, 'keyboard', 'direct', true))).toBe('keyboard');
    expect(parsePracticeSettings('touch:direct:normal:1:1.5:s')).toEqual(touch);
    expect(parsePracticeSettings('touch:direct:normal:1:1.5')).toEqual(off);
    expect(parsePracticeSettings('gamepad')).toEqual({ device: 'gamepad', touch: null });
    for (const bad of [
      'touch:x:normal:1:1.5',
      'touch:direct:normal:2:1.5',
      'touch:direct:normal:1:1.5:x',
      'mouse',
      'keyboard:x',
    ])
      expect(parsePracticeSettings(bad)).toBeNull();
  });

  it('この設定・機体の最高のときだけ書く。課題の最高・この設定の最高を返す。12 個まで', () => {
    const r: PracticeRecords = {};
    const a = recordPractice(r, result(500), 'keyboard', 'kestrel', 1);
    expect(a).toMatchObject({ newBest: true, newSettingsBest: true, previous: null });
    const b = recordPractice(r, result(300), 'keyboard', 'kestrel', 2);
    expect(b).toMatchObject({ newBest: false, newSettingsBest: false });
    expect(b.previous?.score).toBe(500);
    const c = recordPractice(r, result(400), 'touch:direct:normal:1:1.5', 'kestrel', 3);
    expect(c).toMatchObject({ newBest: false, newSettingsBest: true });
    expect(c.best?.score).toBe(500);
    expect(practiceEntries(r, 'static').map((e) => e.score)).toEqual([500, 400]);
    // 別の機体は別の行
    recordPractice(r, result(600), 'keyboard', 'other', 4);
    expect(practiceEntries(r, 'static')).toHaveLength(3);
    for (let i = 0; i < 20; i++) recordPractice(r, result(100 + i), `gamepad`, `a${i}`, 10 + i);
    expect(practiceEntries(r, 'static')).toHaveLength(PRACTICE_CONFIG.maxEntries);
    expect(practiceEntries(r, 'static')[0]?.score).toBe(600);
  });

  it('セーブ: 無いセーブ（9-4 まで）は空。壊れた行・知らない課題は捨てる', () => {
    expect(normalizeRecords({ defenseWaves: {}, raidBestMs: {} }).practice).toEqual({});
    const ok = {
      settings: 'keyboard',
      aircraftId: 'kestrel',
      score: 10,
      kills: 1,
      accuracy: 0.5,
      date: 1,
    };
    const r = normalizePracticeRecords({
      static: [ok, { ...ok, score: -1 }, { ...ok, settings: 'x' }, { ...ok, accuracy: 2 }, 'x'],
      moving: [{ ...ok, accuracy: null }],
      nope: [ok],
    });
    expect(r).toEqual({ static: [ok], moving: [{ ...ok, accuracy: null }] });
  });

  it('モード選択のカード: 課題ごとの最高（記録の無い課題は —）', () => {
    const save = createInitialSave();
    expect(modeProgress(save, []).practice).toBeUndefined();
    recordPractice(save.records.practice, result(512, 'moving'), 'keyboard', 'kestrel', 1);
    useLocale('ja');
    expect(modeProgress(save, []).practice).toBe('最高 — / 512 / —');
  });
});

describe('リプレイ', () => {
  it('ボットの練習をリプレイに残すと、再生しても同じ結果（スコア・撃墜・指標）', () => {
    const w = createWorld();
    const start: ReplayStart = {
      ...BASE_START,
      mode: 'practice',
      practiceDrill: 'bandit',
      practiceAspect: 1.78,
    };
    startFromHeader(w, start);
    const rec = new ReplayRecorder();
    rec.begin(start, {
      title: 't',
      pilotName: 'p',
      date: '2026-11-04T00:00:00Z',
      gameVersion: '1.0.5',
      startHash: simHash(w),
    });
    const p = w.play.practice;
    if (!p) throw new Error('no practice');
    const bot = new PracticeBot(w.play, 'bandit', VETERAN, 4);
    while (!p.readyForResult) {
      bot.think(DT);
      const f = captureFrame(rec.frame, bot.controls, bot.input, w.play.session);
      const input = { ...bot.input };
      applyFrame(f, w.controls, input, w.play.session);
      rec.push(f);
      stepWorld(w.play, w.buildings(), w.controls, input, DT);
    }
    const live = p.result;
    const data = rec.finish(null);
    if (!data || !live) throw new Error('no data');
    expect(live.kills).toBeGreaterThan(0);
    const { player } = replay(createWorld(), data);
    expect(player).toBeDefined();
    const again = createWorld();
    replay(again, data);
    expect(again.play.practice?.result).toEqual(live);
    useLocale('ja');
    expect(replayTitle(start)).toBe('模擬の敵');
    expect(
      replayOutcomeLabel({
        label: '',
        success: true,
        result: { kind: 'practice', score: live.score, kills: live.kills },
      }),
    ).toBe(`スコア ${live.score}（撃墜 ${live.kills}）`);
  });
});

describe('画面の流れ・文・案内', () => {
  it('モード選択 → 課題の一覧 → 飛行 → 結果 → 課題の一覧。ポーズの「やり直す」は飛行を始め直す（restart）', () => {
    const game = new GameState();
    for (const s of ['title', 'mode_select', 'practice_select', 'flight', 'result'] as const)
      expect(game.transition(s), s).toBe(true);
    expect(game.transition('practice_select')).toBe(true);
    expect(game.transition('flight')).toBe(true);
    expect(game.restart()).toBe(false);
    expect(game.transition('pause')).toBe(true);
    const changes: { from: string; to: string; restart?: boolean }[] = [];
    game.onChange((c) => changes.push(c));
    expect(game.restart()).toBe(true);
    expect(changes).toEqual([{ from: 'pause', to: 'flight', restart: true }]);
    expect(game.transition('pause')).toBe(true);
    expect(game.transition('practice_select')).toBe(true);
  });

  it('文は日本語・英語の両方（課題・助言・設定の見出し・割合）', () => {
    for (const locale of LOCALES) {
      useLocale(locale);
      for (const d of PRACTICE_DRILLS) {
        expect(PRACTICE_DRILL_LABELS[d].name.length, `${locale} ${d}`).toBeGreaterThan(0);
        expect(PRACTICE_DRILL_LABELS[d].note.length).toBeGreaterThan(0);
      }
      const label = practiceSettingsLabel('touch:drag:off:0:2');
      expect(label).not.toContain('practice.');
      expect(practiceSettingsLabel('keyboard').length).toBeGreaterThan(0);
    }
    useLocale('ja');
    expect(practiceSettingsLabel('touch:direct:normal:1:1.5:s')).toBe(
      'タッチ・方向へ倒す・補助 標準・自動射撃 ON・カーブ 1.5・速度合わせ ON',
    );
    expect(practiceSettingsLabel('touch:direct:normal:1:1.5')).toBe(
      'タッチ・方向へ倒す・補助 標準・自動射撃 ON・カーブ 1.5・速度合わせ OFF',
    );
    expect(formatRatio(0.1234)).toBe('12.3%');
    useLocale('en');
    expect(practiceSettingsLabel('touch:direct:weak:0:1')).toContain('Auto-fire off');
  });

  it('案内: チュートリアルの狙いの章（9-5c: 機銃・動く的・的の探し方）の完了と、M1・M2 の失敗だけ', () => {
    expect(practiceHintFor(true, { outcome: 'success', missionId: 'tutorial-gun' })).toBe(
      'tutorial',
    );
    expect(practiceHintFor(true, { outcome: 'success', missionId: 'tutorial-find' })).toBe(
      'tutorial',
    );
    expect(
      practiceHintFor(true, { outcome: 'success', missionId: 'tutorial-steer' }),
    ).toBeUndefined();
    expect(
      practiceHintFor(true, { outcome: 'aborted', missionId: 'tutorial-gun' }),
    ).toBeUndefined();
    expect(practiceHintFor(false, { outcome: 'failed', missionId: 'training' })).toBe('failed');
    expect(practiceHintFor(false, { outcome: 'failed', missionId: 'first-sortie' })).toBe('failed');
    expect(practiceHintFor(false, { outcome: 'success', missionId: 'training' })).toBeUndefined();
    expect(practiceHintFor(false, { outcome: 'failed', missionId: 'escort' })).toBeUndefined();
  });
});
