// 初期ミッション 5 本（2-5）のデータと、シード固定のボットでの通し（本番と同じ FlightSession + MissionRunner）。
// 「順当に進めれば成功」「放置すれば失敗」を確かめる。ボットの成功率は docs/decisions.md に記録
import { describe, expect, it } from 'vitest';
import { createRandom } from '../src/core/random';
import { LOCALES } from '../src/core/locale';
import { ISLAND_MAP } from '../src/data/maps';
import {
  ENCOUNTER_MISSION,
  ESCORT_MISSION,
  ESCORT_ROUTE,
  FIRST_SORTIE_MISSION,
  KAIJU_ROUTE,
  MISSIONS,
  STRIKE_MISSION,
  TRAINING_MISSION,
} from '../src/data/missions';
import { KAIJU_PLACEHOLDER_CONFIG, TRANSPORT_CONFIG } from '../src/data/mission-props';
import type { GamePlay } from '../src/missions/game-play';
import type { MissionRunner } from '../src/missions/runner';
import type { MissionDef } from '../src/missions/types';
import { getGroundHeight, getHeight } from '../src/render/terrain-height';
import { missionStrings } from '../src/ui/mission-text';
import { AVERAGE, PilotBot, VETERAN } from './ai-sim';
import { DT, LoiterBot, StrikeBot, nearestActive, newPlay } from './mission-bots';

describe('初期ミッション 5 本のデータ', () => {
  it('M1 訓練 → M2 初陣 → M3 護衛 → M4 爆撃 → M5 遭遇 の順。基本報酬は 1000 / 1500 / 2000 / 2000 / 3000', () => {
    expect(MISSIONS.map((m) => m.id)).toEqual([
      'training',
      'first-sortie',
      'escort',
      'strike',
      'encounter',
    ]);
    expect(MISSIONS.map((m) => m.reward.baseCredits)).toEqual([1000, 1500, 2000, 2000, 3000]);
  });

  it('タイトルと 3〜4 行のブリーフィング文が日本語・英語の両方にある', () => {
    for (const m of MISSIONS) {
      for (const locale of LOCALES) {
        const text = missionStrings(m.id, locale);
        expect(text.title).not.toBe(m.id);
        expect(text.briefing.length).toBeGreaterThanOrEqual(3);
        expect(text.briefing.length).toBeLessThanOrEqual(4);
      }
    }
  });

  it('開始位置・敵機の出現位置は戦域の中で、地表から 300m 以上', () => {
    for (const m of MISSIONS) {
      const points = [
        m.start,
        ...m.spawns.flatMap((s) => (s.kind === 'enemyFighter' ? s.positions : [])),
      ];
      for (const p of points) {
        expect(Math.hypot(p.x, p.z)).toBeLessThan(ISLAND_MAP.radius);
        expect(p.y - Math.max(0, getGroundHeight(p.x, p.z))).toBeGreaterThan(300);
      }
    }
  });

  it('M2: 敵機 3 機が 1 機ずつ 20 秒差（0 / 20 / 40 秒）で出る。easy・easy・normal（4-7 / 4-11 の事前修正）', () => {
    const fighters = FIRST_SORTIE_MISSION.spawns.filter((s) => s.kind === 'enemyFighter');
    expect(
      fighters.map((s) => [
        s.count,
        s.difficulty,
        s.trigger.type === 'time' ? s.trigger.seconds : s.trigger.type,
      ]),
    ).toEqual([
      [1, 'easy', 'start'],
      [1, 'easy', 20],
      [1, 'normal', 40],
    ]);
  });

  it('M3: 敵機 4 機（normal）が 2 波で、輸送機を優先して狙う。輸送機の喪失で失敗', () => {
    const fighters = ESCORT_MISSION.spawns.filter((s) => s.kind === 'enemyFighter');
    expect(fighters.map((s) => [s.count, s.difficulty, s.attack])).toEqual([
      [2, 'normal', 'transport'],
      [2, 'normal', 'transport'],
    ]);
    expect(ESCORT_MISSION.failConditions).toContain('escortLost');
  });

  it('M3: 輸送機の経路は島の東岸の沖から西岸までで、真下の地形より 300m 以上高い（地形に当たらない）', () => {
    const { from, to, destination } = ESCORT_ROUTE;
    // 東岸の沖（海の上）から出て、目的地（西岸）は経路の上
    expect(getHeight(from.x, from.z)).toBeLessThan(0);
    expect(from.x).toBeGreaterThan(0);
    expect(destination.x).toBeLessThan(0);
    expect(Math.abs(destination.z - from.z)).toBeLessThan(1);
    let minClearance = Infinity;
    for (let t = 0; t <= 1; t += 0.001) {
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;
      const y = from.y + (to.y - from.y) * t;
      minClearance = Math.min(minClearance, y - getGroundHeight(x, z));
    }
    expect(minClearance).toBeGreaterThan(300);
  });

  it('M4: 地上目標はレーダー・対空砲・格納庫・燃料タンクの 4 つで島の上（陸）。破壊の目標は 4 つ全部', () => {
    const spawns = STRIKE_MISSION.spawns.flatMap((s) => (s.kind === 'groundTarget' ? [s] : []));
    expect(spawns.map((s) => s.targetType)).toEqual(['radar', 'aaa', 'hangar', 'fuelTank']);
    expect(STRIKE_MISSION.spawns.length).toBe(4);
    const positions = spawns.flatMap((s) => s.positions);
    expect(positions.length).toBe(4);
    for (const p of positions) {
      const h = getGroundHeight(p.x, p.z);
      expect(h).toBeGreaterThan(5);
      expect(h).toBeLessThan(300);
    }
    expect(spawns.every((s) => s.group === 'depots')).toBe(true);
    const objective = STRIKE_MISSION.objectives[0];
    expect(objective?.type === 'destroy' && objective.count).toBe(4);
    expect(STRIKE_MISSION.reward.baseCredits).toBe(2000);
  });

  it('M5: 怪獣の出現位置は海の上（海岸線の外）で、撤退の割合は目標と同じ 20%', () => {
    const { position, walkTo } = KAIJU_ROUTE;
    expect(getHeight(position.x, position.z)).toBeLessThan(-20);
    // 出現位置から島の中心までの間に陸がある（島に向かって歩く）
    expect(getGroundHeight(walkTo.x, walkTo.z)).toBeGreaterThan(0);
    const spawn = ENCOUNTER_MISSION.spawns.find((s) => s.kind === 'kaiju');
    const objective = ENCOUNTER_MISSION.objectives.find((o) => o.type === 'kaiju');
    expect(spawn?.kind === 'kaiju' && spawn.retreatDamageRatio).toBe(0.2);
    expect(objective?.type === 'kaiju' && objective.damageRatio).toBe(0.2);
    expect(KAIJU_PLACEHOLDER_CONFIG.height).toBe(150);
  });
});

/** 終わるまで（最大 seconds 秒）、毎ステップ think で操作を決めて進める */
function runUntilEnd(
  play: GamePlay,
  runner: MissionRunner,
  seconds: number,
  think: () => {
    controls: Parameters<GamePlay['step']>[0];
    input: Parameters<GamePlay['step']>[1];
  },
  each?: () => void,
): void {
  for (let i = 0; i < seconds * 60 && runner.running; i++) {
    const { controls, input } = think();
    play.step(controls, input, DT);
    each?.();
  }
}

/** 何もしない（島の上空を回るだけ）で最後まで進める */
function runIdle(def: MissionDef, seed: number): MissionRunner {
  const play = newPlay(seed);
  const runner = play.startMission(def);
  const bot = new LoiterBot(play.session);
  runUntilEnd(play, runner, 700, () => {
    bot.think();
    return bot;
  });
  return runner;
}

describe('初期ミッションの通し（シード固定のボット）', () => {
  it('M2 初陣: 敵機を順に追って 3 機とも落とせば成功', () => {
    const play = newPlay(1);
    const s = play.session;
    const runner = play.startMission(FIRST_SORTIE_MISSION);
    const bot = new PilotBot(s, VETERAN, createRandom(501), undefined, getGroundHeight);
    runUntilEnd(play, runner, 450, () => {
      bot.think(DT);
      return bot;
    });
    expect(runner.status).toBe('success');
    expect(s.destroyedCount('enemyFighter', 'first-sortie-bandits')).toBe(3);
    expect(runner.result?.credits).toBeGreaterThanOrEqual(1500);
  });

  it('M3 護衛: 輸送機に近い敵機から追い払えば、輸送機が西岸に着いて成功。輸送機は地形に当たらない', () => {
    const play = newPlay(1);
    const s = play.session;
    const runner = play.startMission(ESCORT_MISSION);
    const transport = s.props.transports[0];
    if (!transport) throw new Error('輸送機がない');
    const bot = new PilotBot(
      s,
      VETERAN,
      createRandom(501),
      () => nearestActive(transport.position, s.enemies),
      getGroundHeight,
    );
    let minClearance = Infinity;
    runUntilEnd(
      play,
      runner,
      200,
      () => {
        bot.think(DT);
        return bot;
      },
      () => {
        const p = transport.position;
        if (transport.active)
          minClearance = Math.min(minClearance, p.y - getGroundHeight(p.x, p.z));
      },
    );
    expect(runner.status).toBe('success');
    expect(transport.active).toBe(true);
    // 約 7km を 120 m/s
    expect(runner.elapsed).toBeGreaterThan(50);
    expect(runner.elapsed).toBeLessThan(65);
    expect(minClearance).toBeGreaterThan(300);
    expect(TRANSPORT_CONFIG.speed).toBe(120);
  });

  it('M4 爆撃: 地上目標を順に機銃で撃てば、4 つとも壊して成功', () => {
    const play = newPlay(1);
    const s = play.session;
    const runner = play.startMission(STRIKE_MISSION);
    const bot = new StrikeBot(s, () => s.props.groundTargets);
    runUntilEnd(play, runner, 400, () => {
      bot.think(DT);
      return bot;
    });
    expect(runner.status).toBe('success');
    expect(s.destroyedCount('groundTarget', 'depots')).toBe(4);
    expect(s.player.downCount).toBe(0);
    // 対空砲（2-6）は撃ってきたが、旋回し続けるボットにはほとんど当たらない
    expect(s.props.aaa.shotCount).toBeGreaterThan(40);
    expect(s.player.damageTaken).toBeLessThan(s.player.maxHp / 2);
    expect(s.props.groundTargets.filter((g) => g.wrecked).map((g) => g.type)).toEqual([
      'radar',
      'aaa',
      'hangar',
      'fuelTank',
    ]);
  });

  it('M2 初陣（1 機ずつ 20 秒差・easy・easy・normal）の成功率: 8 シードで 熟練者役 6/8・平均的 0/8（4-11 の事前修正。easy・normal・normal では 1/8・0/8。docs/decisions.md の 4-11）', () => {
    const rate = (skill: typeof VETERAN): number => {
      let ok = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const play = newPlay(seed);
        const runner = play.startMission(FIRST_SORTIE_MISSION);
        const bot = new PilotBot(
          play.session,
          skill,
          createRandom(500 + seed),
          undefined,
          getGroundHeight,
        );
        runUntilEnd(play, runner, 450, () => {
          bot.think(DT);
          return bot;
        });
        if (runner.status === 'success') ok++;
      }
      return ok;
    };
    expect([rate(VETERAN), rate(AVERAGE)]).toEqual([6, 0]);
    // 16 回 × 最大 450 秒のシミュレーション（全体の実行中は 5 秒を超えることがある）
  }, 30000);

  it('M5 遭遇: 敵機と戦い、怪獣が出たら怪獣を撃って 20% 削れば、怪獣が海へ引き返して成功', () => {
    const play = newPlay(2);
    const s = play.session;
    const runner = play.startMission(ENCOUNTER_MISSION);
    const kaiju = s.props.kaiju;
    const strike = new StrikeBot(s, () => [kaiju]);
    const pilot = new PilotBot(s, VETERAN, createRandom(502), undefined, getGroundHeight);
    let emergedAt = -1;
    runUntilEnd(play, runner, 450, () => {
      if (emergedAt < 0 && kaiju.visible) emergedAt = runner.elapsed;
      if (kaiju.active) {
        strike.think(DT);
        return strike;
      }
      pilot.think(DT);
      return pilot;
    });
    expect(emergedAt).toBeCloseTo(30, 1);
    expect(runner.status).toBe('success');
    expect(kaiju.damageRatio).toBeGreaterThan(0.2 - 1e-9);
    expect(kaiju.phase).toBe('retreating');
    // 引き返して沈みきると消える
    for (let i = 0; i < KAIJU_PLACEHOLDER_CONFIG.sinkSeconds * 60 + 2; i++)
      play.step(pilot.controls, pilot.input, DT);
    expect(kaiju.phase).toBe('gone');
  });

  it('放置すると失敗: M1 時間切れ / M2 撃墜 / M3 輸送機の喪失 / M4 時間切れ / M5 撃墜', () => {
    const expected: [MissionDef, string][] = [
      [TRAINING_MISSION, 'timeUp'],
      [FIRST_SORTIE_MISSION, 'playerDown'],
      [ESCORT_MISSION, 'escortLost'],
      [STRIKE_MISSION, 'timeUp'],
      [ENCOUNTER_MISSION, 'playerDown'],
    ];
    for (const [def, reason] of expected) {
      const runner = runIdle(def, 1);
      expect([def.id, runner.status, runner.failReason]).toEqual([def.id, 'failed', reason]);
    }
  });
});
