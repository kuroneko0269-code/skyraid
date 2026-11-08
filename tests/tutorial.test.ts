import { readFileSync } from 'node:fs';
import { TUTORIAL_TASKS } from '../src/data/tutorial-tasks';
// チュートリアル（4-11 → 9-5c で章に分けた）: 章の定義・方式ごとの文・ボットで全章 × 全方式の通し・練習（撃墜されない）・
// 章の印と初回だけの報酬・ヒント
import { useLocale } from './i18n-helpers';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '../src/core/locale';
import { ISLAND_MAP } from '../src/data/maps';
import { MISSIONS } from '../src/data/missions';
import {
  TUTORIAL_CHAPTER_DEFS,
  TUTORIAL_CHAPTERS,
  TUTORIAL_CONFIG,
  TUTORIAL_FIGURES,
  TUTORIAL_FLIGHT_CHAPTERS,
  nextTutorialChapter,
  tutorialChapterOf,
} from '../src/data/tutorial';
import { GamePlay } from '../src/missions/game-play';
import { SaveStore } from '../src/progression/save-store';
import { normalizeRecords } from '../src/progression/save-records';
import {
  bindTutorialReward,
  completeTutorialChapter,
  tutorialChaptersDone,
} from '../src/progression/tutorial-reward';
import { getGroundHeight } from '../src/render/terrain-height';
import {
  TUTORIAL_VARIANTS,
  tutorialLiveHint,
  tutorialStepHint,
  tutorialStepText,
  tutorialStrings,
  tutorialVariant,
} from '../src/ui/tutorial-text';
import { DT, createControls, newPlay } from './mission-bots';
import { TUTORIAL_BOT_MODES, runTutorialChapter } from './tutorial-bot';
import { createCombatInput } from '../src/combat/combat-system';

const FLIGHT = TUTORIAL_FLIGHT_CHAPTERS;

describe('チュートリアルの章の定義', () => {
  it('9 章（最後の「補助の設定と練習場」だけ飛ばない）。飛ぶ章は練習（失敗条件・制限時間なし）で、キャンペーンの一覧に入れない', () => {
    expect(TUTORIAL_CHAPTERS).toEqual([
      'steer',
      'speed',
      'gun',
      'moving',
      'missile',
      'flare',
      'loop',
      'find',
      'assist',
    ]);
    expect(FLIGHT).toHaveLength(8);
    expect(TUTORIAL_CHAPTER_DEFS.assist.mission).toBeNull();
    for (const c of FLIGHT) {
      const m = TUTORIAL_CHAPTER_DEFS[c].mission;
      if (!m) throw new Error(c);
      expect(m.practice).toBe(true);
      expect(m.failConditions).toEqual([]);
      expect(m.timeLimitSeconds).toBeUndefined();
      expect(MISSIONS.some((x) => x.id === m.id)).toBe(false);
      expect(tutorialChapterOf(m.id)).toBe(c);
      // 段階は順に（最初の目標だけ同時に始まる）・どれも表示（図・光らせる部品）がある
      expect(m.objectives.map((o) => o.start)).toEqual(
        m.objectives.map((_, i) => (i === 0 ? 'withPrevious' : 'afterPrevious')),
      );
      for (const o of m.objectives) {
        const view = TUTORIAL_CHAPTER_DEFS[c].steps[o.id];
        expect(view, `${c}.${o.id}`).toBeDefined();
        expect(TUTORIAL_FIGURES).toContain(view?.figure);
      }
    }
    expect(tutorialChapterOf('first-sortie')).toBeNull();
    expect(nextTutorialChapter('find')).toBe('assist');
    expect(nextTutorialChapter('assist')).toBeNull();
    expect(TUTORIAL_CONFIG.rewardCredits).toBe(500);
  });

  it('開始位置・リングは戦域の中で、地表から 300m 以上', () => {
    for (const c of FLIGHT) {
      const m = TUTORIAL_CHAPTER_DEFS[c].mission;
      if (!m) continue;
      const rings = m.objectives.flatMap((o) => (o.type === 'rings' ? o.rings : []));
      for (const p of [m.start, ...rings]) {
        expect(Math.hypot(p.x, p.z)).toBeLessThan(ISLAND_MAP.radius);
        expect(p.y - Math.max(0, getGroundHeight(p.x, p.z)), c).toBeGreaterThan(300);
      }
    }
  });

  it('進行役はリプレイの状態に入れない（GamePlay の transientKeys）。章を始めると付き、ほかの飛行で外れる', () => {
    expect(GamePlay.transientKeys).toContain('tutorial');
    const play = newPlay(1);
    expect(play.startTutorial('assist')).toBeNull();
    play.startTutorial('steer');
    expect(play.tutorial?.chapter).toBe('steer');
    play.startFree();
    expect(play.tutorial).toBeNull();
  });
});

describe('チュートリアルの文（日本語・英語 × 6 方式）', () => {
  it('全章の全段階に指示とヒントがあり、キーボードは今の割当のキー名を埋める（置き換え忘れなし）', () => {
    for (const locale of LOCALES) {
      useLocale(locale);
      const s = tutorialStrings();
      for (const k of ['title', 'prompt', 'start', 'later', 'abort', 'safety'] as const)
        expect(s[k].length).toBeGreaterThan(0);
      for (const c of TUTORIAL_CHAPTERS) {
        expect(s.chapters[c].name.length).toBeGreaterThan(0);
        expect(s.chapters[c].goal.length).toBeGreaterThan(0);
        const m = TUTORIAL_CHAPTER_DEFS[c].mission;
        for (const o of m?.objectives ?? [])
          for (const v of TUTORIAL_VARIANTS) {
            const text = tutorialStepText(c, o.id, v, (a) => `<${a}>`);
            const hint = tutorialStepHint(c, o.id, v, (a) => `<${a}>`);
            expect(text.length, `${locale} ${c}.${o.id} ${v}`).toBeGreaterThan(10);
            expect(hint.length, `${locale} ${c}.${o.id} ${v} hint`).toBeGreaterThan(10);
            expect(text + hint).not.toMatch(/\{[a-zA-Z]+\}/);
          }
      }
      for (const hint of ['overtake', 'offRange', 'lost', 'needSpeed', 'missileHit', 'replaced'])
        for (const v of TUTORIAL_VARIANTS)
          expect(tutorialLiveHint(hint, v, (a) => a).length).toBeGreaterThan(5);
      expect(s.chapters.assist.page.length).toBeGreaterThan(3);
      expect(Object.keys(s.hints)).toEqual(TUTORIAL_CONFIG.hints.map((h) => h.id));
    }
    useLocale('ja');
    expect(
      tutorialStepText('steer', 'climb', 'keys', (a) => (a === 'pitchUp' ? 'K' : '?')),
    ).toContain('K で上昇');
  });

  it('入力系統とタッチの方式から文の出し分けを決める', () => {
    expect(tutorialVariant('keyboard', 'tilt')).toBe('keys');
    expect(tutorialVariant('gamepad', 'direct')).toBe('pad');
    expect(tutorialVariant('touch', 'drag')).toBe('drag');
    expect(tutorialVariant('touch', 'classic')).toBe('classic');
  });
});

describe('ボットで全章を通す（模擬の人・初心者役 × 6 方式）', () => {
  for (const role of ['human', 'beginner'] as const)
    for (const mode of TUTORIAL_BOT_MODES)
      it(`${role} / ${mode}: 飛ぶ 8 章とも達成（5 分以内・撃墜されない）`, () => {
        for (const c of FLIGHT) {
          const r = runTutorialChapter(c, mode, role, 1, 300);
          expect(r.status, `${role} ${mode} ${c}`).toBe('success');
        }
      }, 120000);
});

describe('ヒント', () => {
  it('段階を 20 秒達成できないと段階のヒント（もう一度は 50 秒）', () => {
    const play = newPlay(1);
    const runner = play.startTutorial('steer');
    const hints: number[] = [];
    play.tutorial?.bus.on('tutorial:hint', ({ hint }) => {
      if (hint === 'step') hints.push(runner?.elapsed ?? 0);
    });
    const idle = createControls(0.75);
    for (let i = 0; i < 60 * 60; i++) play.step(idle, createCombatInput(), DT);
    expect(hints).toHaveLength(2);
    expect(hints[0]).toBeCloseTo(TUTORIAL_CONFIG.stepHintSeconds, 0);
    expect(hints[1]).toBeCloseTo(TUTORIAL_CONFIG.stepHintSeconds * 2.5, 0);
  });

  it('宙返りの章は遅い速さから始まり、上へ引き続けると NEED SPEED のヒント', () => {
    const play = newPlay(1);
    play.startTutorial('loop');
    const seen: string[] = [];
    play.tutorial?.bus.on('tutorial:hint', ({ hint }) => seen.push(hint));
    const pull = createControls(0.45);
    pull.pitch = 1;
    for (let i = 0; i < 12 * 60; i++) play.step(pull, createCombatInput(), DT);
    expect(seen).toContain('needSpeed');
  });

  it('フレアの章は後ろからミサイルを撃たせ、撒かずに当たるとヒント（撃墜はされない）', () => {
    const play = newPlay(1);
    play.startTutorial('flare');
    const seen: string[] = [];
    play.tutorial?.bus.on('tutorial:hint', ({ hint }) => seen.push(hint));
    let warned = false;
    const s = play.session;
    for (let i = 0; i < 30 * 60; i++) {
      play.step(createControls(0.75), createCombatInput(), DT);
      warned ||= s.combat.incomingMissiles(s.player) > 0;
    }
    expect(warned).toBe(true);
    expect(seen).toContain('missileHit');
    expect(s.player.active).toBe(true);
  });
});

describe('練習（撃墜されない）', () => {
  it('被弾で HP は減るが 1 で止まり、地面に当たってもその場の上空へ戻る（章は続く）', () => {
    const play = newPlay(1);
    const runner = play.startTutorial('steer');
    const s = play.session;
    expect(s.player.immortal).toBe(true);
    s.player.applyDamage(10000);
    expect(s.player.hp).toBe(1);
    const dive = createControls(1);
    dive.pitch = -1;
    for (let i = 0; i < 60 * 60 && s.aircraft.crashCount === 0; i++)
      play.step(dive, createCombatInput(), DT);
    expect(s.aircraft.crashCount).toBe(1);
    expect(s.player.downCount).toBe(0);
    const pos = s.aircraft.state.position;
    expect(pos.y - getGroundHeight(pos.x, pos.z)).toBeGreaterThan(250);
    expect(runner?.running).toBe(true);
  });
});

describe('章の印と報酬', () => {
  it('章を終えると印（records.tutorial）。飛ぶ章がそろった初めてだけ 500 CR と tutorialDone', () => {
    const store = SaveStore.open(null).store;
    const finish = (c: (typeof FLIGHT)[number]): number => {
      const play = newPlay(1);
      const runner = play.startTutorial(c);
      if (!runner) throw new Error(c);
      const reward = bindTutorialReward(runner.bus, store, c);
      for (const o of runner.objectives) o.status = 'complete';
      play.step(createControls(), createCombatInput(), DT);
      expect(runner.status).toBe('success');
      reward.off();
      return reward.paid;
    };
    const paid = FLIGHT.map(finish);
    expect(paid.slice(0, -1).every((p) => p === 0)).toBe(true);
    expect(paid[paid.length - 1]).toBe(500);
    expect(store.credits).toBe(500);
    expect(store.flag('tutorialDone')).toBe(true);
    expect([...tutorialChaptersDone(store)].sort()).toEqual([...FLIGHT].sort());
    expect(finish('steer')).toBe(0);
    expect(completeTutorialChapter(store, 'assist')).toBe(0);
    expect(tutorialChaptersDone(store).has('assist')).toBe(true);
    expect(store.credits).toBe(500);
  });

  it('4-11 のチュートリアルを終えた人（tutorialDone）は、章をそろえても報酬なし', () => {
    const store = SaveStore.open(null).store;
    store.setFlag('tutorialDone');
    for (const c of FLIGHT) expect(completeTutorialChapter(store, c)).toBe(0);
    expect(store.credits).toBe(0);
  });

  it('セーブの records.tutorial は知らない章・重複を捨てる（無いセーブは空）', () => {
    expect(normalizeRecords({}).tutorial).toEqual([]);
    expect(normalizeRecords({ tutorial: ['gun', 'x', 'gun', 3, 'steer'] }).tutorial).toEqual([
      'gun',
      'steer',
    ]);
  });
});

describe('10-4b: チュートリアルの課題の名前', () => {
  it('課題の種類すべてに目標の名前がある（日本語・英語。生のキーが出ない）', () => {
    for (const lang of ['ja', 'en'] as const) {
      const tree = JSON.parse(readFileSync(`src/data/i18n/${lang}.json`, 'utf8')) as {
        objectives: { task: Record<string, string> };
      };
      for (const task of TUTORIAL_TASKS)
        expect([lang, task, tree.objectives.task[task]]).not.toContain(undefined);
    }
  });
});
