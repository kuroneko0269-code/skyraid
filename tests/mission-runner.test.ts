import { describe, expect, it } from 'vitest';
import { MissionRunner } from '../src/missions/runner';
import { DT, FakeWorld, missionDef, record, run } from './mission-helpers';

describe('目標の進み具合と達成', () => {
  it('撃墜数: 始まってからの撃墜だけ数え、届いたら達成。進み具合をイベントで知らせる', () => {
    const w = new FakeWorld();
    w.kill('enemyFighter', 'a'); // 始まる前の撃墜は数えない
    const r = new MissionRunner(
      missionDef({
        objectives: [
          {
            id: 'k',
            type: 'kill',
            required: true,
            start: 'withPrevious',
            target: 'enemyFighter',
            group: 'a',
            count: 2,
          },
        ],
      }),
      w,
    );
    const log = record(r);
    r.start();
    expect(log).toEqual(['objective:activate k', 'progress k:0']);
    w.kill('enemyFighter', 'b'); // 別のグループは数えない
    r.step(DT);
    expect(r.objectives[0]?.current).toBe(0);
    w.kill('enemyFighter', 'a');
    r.step(DT);
    expect(r.objectives[0]?.current).toBe(1);
    expect(r.status).toBe('running');
    w.kill('enemyFighter', 'a');
    r.step(DT);
    expect(r.objectives[0]?.status).toBe('complete');
    expect(r.status).toBe('success');
    expect(log.slice(2)).toEqual([
      'progress k:1',
      'progress k:2',
      'objective:complete k',
      'mission:end success',
      'mission:reward',
    ]);
  });

  it('生存時間: 秒を数え、撃墜されている間は数えない', () => {
    const w = new FakeWorld();
    const r = new MissionRunner(
      missionDef({
        failConditions: [],
        objectives: [
          { id: 's', type: 'survive', required: true, start: 'withPrevious', seconds: 5 },
        ],
      }),
      w,
    );
    run((dt) => {
      r.step(dt);
    }, 2);
    expect(r.objectives[0]?.current).toBe(2);
    w.playerActive = false;
    run((dt) => {
      r.step(dt);
    }, 10);
    expect(r.objectives[0]?.current).toBe(2);
    w.playerActive = true;
    run((dt) => {
      r.step(dt);
    }, 2.9);
    expect(r.status).toBe('running');
    run((dt) => {
      r.step(dt);
    }, 0.2);
    expect(r.status).toBe('success');
  });

  it('リング通過: 次のリングだけを順に数える（先のリングを通っても数えない）', () => {
    const w = new FakeWorld();
    const r = new MissionRunner(
      missionDef({
        objectives: [
          {
            id: 'r',
            type: 'rings',
            required: true,
            start: 'withPrevious',
            rings: [
              { x: 0, y: 500, z: -100, headingDeg: 0 },
              { x: 0, y: 500, z: -300, headingDeg: 0 },
            ],
          },
        ],
      }),
      w,
    );
    r.start();
    // 2 個目を先にくぐる
    w.moveTo(0, 500, -290);
    w.moveTo(0, 500, -310);
    r.step(DT);
    expect(r.objectives[0]?.current).toBe(0);
    // 1 個目をくぐる（輪の外ならだめ）
    w.moveTo(0, 600, -90);
    w.moveTo(0, 600, -110);
    r.step(DT);
    expect(r.objectives[0]?.current).toBe(0);
    w.moveTo(10, 510, -95);
    w.moveTo(10, 510, -105);
    r.step(DT);
    expect(r.objectives[0]?.current).toBe(1);
    expect(r.activeRings?.next?.position.z).toBe(-300);
    w.moveTo(0, 500, -295);
    w.moveTo(0, 500, -305);
    r.step(DT);
    expect(r.status).toBe('success');
    expect(r.activeRings).toBeNull();
  });

  it('順番: afterPrevious の目標は前の必須目標の達成で始まり、その出現物もそこで出る', () => {
    const w = new FakeWorld();
    const r = new MissionRunner(
      missionDef({
        failConditions: [],
        spawns: [
          { kind: 'targets', count: 3, trigger: { type: 'start' } },
          { kind: 'drones', count: 1, trigger: { type: 'objectiveActive', objective: 'k' } },
          { kind: 'drones', count: 2, trigger: { type: 'objectiveComplete', objective: 's' } },
          { kind: 'targets', count: 1, trigger: { type: 'time', seconds: 1.5 } },
        ],
        objectives: [
          { id: 's', type: 'survive', required: true, start: 'withPrevious', seconds: 1 },
          { id: 'opt', type: 'survive', required: false, start: 'withPrevious', seconds: 100 },
          {
            id: 'k',
            type: 'kill',
            required: true,
            start: 'afterPrevious',
            target: 'drone',
            count: 1,
          },
        ],
      }),
      w,
    );
    const log = record(r);
    r.start();
    expect(w.spawned.map((s) => s.kind)).toEqual(['targets']);
    expect(r.objectives.map((o) => o.status)).toEqual(['active', 'active', 'pending']);
    w.kill('drone'); // 始まる前の撃墜は数えない
    run((dt) => {
      r.step(dt);
    }, 1.01);
    // 任意の目標（opt）は待たずに次が始まる
    expect(r.objectives.map((o) => o.status)).toEqual(['complete', 'active', 'active']);
    expect(w.spawned.length).toBe(3);
    expect(log).toContain('objective:activate k');
    expect(r.objectives[2]?.current).toBe(0);
    run((dt) => {
      r.step(dt);
    }, 0.5);
    expect(w.spawned.length).toBe(4);
    w.kill('drone');
    r.step(DT);
    // 任意の目標が残っていても、必須がそろえば成功
    expect(r.status).toBe('success');
    expect(r.result?.objectives.map((o) => o.status)).toEqual(['complete', 'active', 'complete']);
  });

  it('護衛: 輸送機が目的地の円に入れば達成。進み具合は経路の %（着くまでは 99 で止める）', () => {
    const w = new FakeWorld();
    const r = new MissionRunner(
      missionDef({
        failConditions: ['escortLost'],
        objectives: [
          {
            id: 'e',
            type: 'escort',
            required: true,
            start: 'withPrevious',
            group: 'g',
            destination: { x: -3000, z: 0, radius: 300 },
          },
        ],
      }),
      w,
    );
    const escort = { position: { x: 0, y: 800, z: 0 }, progress: 0.5, active: true };
    w.escorts.set('g', escort);
    r.step(DT);
    expect(r.objectives[0]?.current).toBe(50);
    escort.position = { x: -2600, y: 800, z: 0 };
    escort.progress = 1;
    r.step(DT);
    expect(r.objectives[0]?.current).toBe(99);
    expect(r.status).toBe('running');
    escort.position = { x: -2750, y: 800, z: 0 };
    r.step(DT);
    expect(r.status).toBe('success');
  });

  it('護衛: 輸送機を失うと「護衛対象を失った」で失敗', () => {
    const w = new FakeWorld();
    const r = new MissionRunner(
      missionDef({
        failConditions: ['escortLost'],
        objectives: [
          {
            id: 'e',
            type: 'escort',
            required: true,
            start: 'withPrevious',
            group: 'g',
            destination: { x: 0, z: 0, radius: 100 },
          },
        ],
      }),
      w,
    );
    r.step(DT);
    w.escortLost = true;
    r.step(DT);
    expect(r.status).toBe('failed');
    expect(r.failReason).toBe('escortLost');
  });

  it('破壊: グループの地上目標を数え、count に届けば達成（始まる前の破壊は数えない）', () => {
    const w = new FakeWorld();
    w.kill('groundTarget', 'g');
    const r = new MissionRunner(
      missionDef({
        objectives: [
          { id: 'd', type: 'destroy', required: true, start: 'withPrevious', group: 'g', count: 2 },
        ],
      }),
      w,
    );
    r.step(DT);
    w.kill('groundTarget', 'other');
    w.kill('groundTarget', 'g');
    r.step(DT);
    expect(r.objectives[0]?.current).toBe(1);
    w.kill('groundTarget', 'g');
    r.step(DT);
    expect(r.status).toBe('success');
  });

  it('怪獣: 削った割合（%）を数え、damageRatio に届けば達成', () => {
    const w = new FakeWorld();
    const r = new MissionRunner(
      missionDef({
        objectives: [
          { id: 'm', type: 'kaiju', required: true, start: 'withPrevious', damageRatio: 0.2 },
        ],
      }),
      w,
    );
    expect(r.objectives[0]?.target).toBe(20);
    w.kaijuDamageRatio = 0.125;
    r.step(DT);
    expect(r.objectives[0]?.current).toBe(12);
    w.kaijuDamageRatio = 0.1999;
    r.step(DT);
    expect(r.objectives[0]?.current).toBe(19);
    expect(r.status).toBe('running');
    w.kaijuDamageRatio = 0.2;
    r.step(DT);
    expect(r.status).toBe('success');
  });
});
