// チュートリアル（4-11）: 定義・文・段階の遷移（ボットで通し）・練習（撃墜されない・墜落は上空へ）・初回だけの報酬
import { describe, expect, it } from 'vitest';
import { LOCALES } from '../src/core/locale';
import { ISLAND_MAP } from '../src/data/maps';
import { MISSIONS } from '../src/data/missions';
import { TUTORIAL_CONFIG, TUTORIAL_MISSION, TUTORIAL_STEPS } from '../src/data/tutorial';
import { SaveStore } from '../src/progression/save-store';
import { bindTutorialReward } from '../src/progression/tutorial-reward';
import { getGroundHeight } from '../src/render/terrain-height';
import { tutorialStepText, tutorialStrings } from '../src/ui/tutorial-text';
import { AVERAGE, VETERAN } from './ai-sim';
import { DT, createControls, newPlay } from './mission-bots';
import { TutorialBot } from './tutorial-bot';
import { createCombatInput } from '../src/combat/combat-system';

describe('チュートリアルの定義と文', () => {
  it('5 段階（リング 3 → 360 m/s → 的 2 → ドローン 1 → rookie 1）。失敗条件・制限時間なし、練習。キャンペーンの一覧には入れない', () => {
    const m = TUTORIAL_MISSION;
    expect(m.objectives.map((o) => o.id)).toEqual([...TUTORIAL_STEPS]);
    expect(m.objectives.map((o) => o.start)).toEqual([
      'withPrevious',
      'afterPrevious',
      'afterPrevious',
      'afterPrevious',
      'afterPrevious',
    ]);
    const [rings, speed, targets, drone, bandit] = m.objectives;
    expect(rings?.type === 'rings' && rings.rings.length).toBe(3);
    expect(speed?.type === 'speed' && speed.speed).toBe(360);
    expect(targets?.type === 'kill' && [targets.target, targets.count]).toEqual(['target', 2]);
    expect(drone?.type === 'kill' && [drone.target, drone.count]).toEqual(['drone', 1]);
    expect(bandit?.type === 'kill' && [bandit.target, bandit.count]).toEqual(['enemyFighter', 1]);
    const enemy = m.spawns.find((s) => s.kind === 'enemyFighter');
    expect(enemy?.kind === 'enemyFighter' && enemy.difficulty).toBe('rookie');
    expect(m.failConditions).toEqual([]);
    expect(m.timeLimitSeconds).toBeUndefined();
    expect(m.practice).toBe(true);
    expect(MISSIONS.some((x) => x.id === m.id)).toBe(false);
    expect(TUTORIAL_CONFIG.rewardCredits).toBe(500);
  });

  it('開始位置・リング・敵機の出現位置は戦域の中で、地表から 300m 以上', () => {
    const m = TUTORIAL_MISSION;
    const rings = m.objectives[0]?.type === 'rings' ? m.objectives[0].rings : [];
    const enemy = m.spawns.flatMap((s) => (s.kind === 'enemyFighter' ? s.positions : []));
    for (const p of [m.start, ...rings, ...enemy]) {
      expect(Math.hypot(p.x, p.z)).toBeLessThan(ISLAND_MAP.radius);
      expect(p.y - Math.max(0, getGroundHeight(p.x, p.z))).toBeGreaterThan(300);
    }
  });

  it('指示の文は日本語・英語の両方で、段階 × 入力系統（タッチ / キーボード / パッド）ごとにある。キーボードは今の割当のキー名', () => {
    for (const locale of LOCALES) {
      const t = tutorialStrings(locale);
      for (const k of ['title', 'prompt', 'start', 'later', 'abort', 'complete', 'safety'] as const)
        expect(t[k].length).toBeGreaterThan(0);
      for (const step of TUTORIAL_STEPS) {
        for (const device of ['touch', 'keyboard', 'gamepad'] as const) {
          const text = tutorialStepText(step, device, locale, (a) => `<${a}>`);
          expect(text.length).toBeGreaterThan(10);
          // 置き換え忘れの {action} が残らない
          expect(text).not.toMatch(/\{[a-zA-Z]+\}/);
        }
      }
      expect(Object.keys(t.hints)).toEqual(TUTORIAL_CONFIG.hints.map((h) => h.id));
    }
    const keys = tutorialStepText('rings', 'keyboard', 'ja', (a) => (a === 'pitchUp' ? 'K' : '?'));
    expect(keys).toContain('K で引く');
  });
});

describe('チュートリアルの段階遷移（ボットで通し）', () => {
  it('熟練者役・平均的の 4 シードとも、5 段階を順に進めて完了する。撃墜は 0、3 分以内', () => {
    for (const skill of [VETERAN, AVERAGE]) {
      for (let seed = 1; seed <= 4; seed++) {
        const play = newPlay(seed);
        const runner = play.startMission(TUTORIAL_MISSION);
        const order: string[] = runner.objectives
          .filter((o) => o.status === 'active')
          .map((o) => o.def.id);
        runner.bus.on('objective:activate', ({ id }) => order.push(id));
        const bot = new TutorialBot(play, runner, skill, seed);
        for (let i = 0; i < 300 * 60 && runner.running; i++) {
          bot.think(DT);
          play.step(bot.controls, bot.input, DT);
        }
        expect(runner.status, `seed ${seed}`).toBe('success');
        expect(order).toEqual([...TUTORIAL_STEPS]);
        expect(runner.elapsed).toBeLessThan(180);
        expect(play.session.player.downCount).toBe(0);
      }
    }
  }, 60000);

  it('速度の段階は 360 m/s に届けば達成（スロットル最大の 330 では届かず、アフターバーナーが要る）', () => {
    const play = newPlay(1);
    const runner = play.startMission(TUTORIAL_MISSION);
    // リングを飛ばして速度の段階へ
    const rings = runner.objectives[0];
    if (rings) rings.status = 'complete';
    play.step(createControls(), createCombatInput(), DT);
    const speed = runner.objectives[1];
    expect(speed?.status).toBe('active');
    const controls = createControls(1);
    for (let i = 0; i < 20 * 60; i++) play.step(controls, createCombatInput(), DT);
    expect(speed?.status).toBe('active');
    expect(play.session.aircraft.state.speed).toBeLessThan(360);
    controls.afterburner = true;
    for (let i = 0; i < 6 * 60 && speed?.status === 'active'; i++)
      play.step(controls, createCombatInput(), DT);
    expect(speed?.status).toBe('complete');
  });
});

describe('練習（撃墜されない）', () => {
  it('被弾で HP は減るが 1 で止まり、撃墜されない（被弾の赤い光は出る）', () => {
    const play = newPlay(1);
    play.startMission(TUTORIAL_MISSION);
    const p = play.session.player;
    expect(p.immortal).toBe(true);
    p.applyDamage(p.maxHp - 10);
    expect(p.hp).toBe(10);
    p.applyDamage(1000);
    expect(p.hp).toBe(1);
    expect(p.active).toBe(true);
    expect(p.downCount).toBe(0);
    expect(p.flashTimer).toBeGreaterThan(0);
    // フリーフライト・通常のミッションでは今までどおり撃墜される
    play.startFree();
    expect(p.immortal).toBe(false);
    p.applyDamage(1000);
    expect(p.isDestroyed).toBe(true);
  });

  it('地面に当たっても墜落にならず、その場の地表から 300m 上空へ戻る（ミッションは続く）', () => {
    const play = newPlay(1);
    const runner = play.startMission(TUTORIAL_MISSION);
    const s = play.session;
    let respawns = 0;
    s.onRespawn(() => respawns++);
    const dive = createControls(1);
    dive.pitch = -1;
    for (let i = 0; i < 60 * 60 && s.aircraft.crashCount === 0; i++)
      play.step(dive, createCombatInput(), DT);
    expect(s.aircraft.crashCount).toBe(1);
    expect(s.player.downCount).toBe(0);
    expect(s.player.active).toBe(true);
    expect(respawns).toBe(1);
    const pos = s.aircraft.state.position;
    expect(pos.y - getGroundHeight(pos.x, pos.z)).toBeGreaterThan(250);
    expect(runner.running).toBe(true);
  });
});

describe('チュートリアルの報酬', () => {
  it('初めて完了したときだけ 500 CR と印。2 回目は 0', () => {
    const store = SaveStore.open(null).store;
    const finish = (): number => {
      const play = newPlay(1);
      const runner = play.startMission(TUTORIAL_MISSION);
      const reward = bindTutorialReward(runner.bus, store);
      for (const o of runner.objectives) o.status = 'complete';
      play.step(createControls(), createCombatInput(), DT);
      expect(runner.status).toBe('success');
      reward.off();
      return reward.paid;
    };
    expect(store.flag('tutorialDone')).toBe(false);
    expect(finish()).toBe(500);
    expect(store.credits).toBe(500);
    expect(store.flag('tutorialDone')).toBe(true);
    expect(finish()).toBe(0);
    expect(store.credits).toBe(500);
  });
});
