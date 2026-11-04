// リプレイ（9-2）: タッチのスティックの方式（方向へ倒す / ピッチ・ロール）・感度のカーブで飛んだ記録は、どの方式で記録しても
// 別の世界で同じ結果に再生できる（記録は組み立てた後の入力なので、再生する側の設定によらない）。ヘッダに操作の設定が残る。
// ゴースト（レース）も同じ
import { describe, expect, it } from 'vitest';
import { applyStickCurve } from '../src/core/analog';
import { dragStick, TiltReader } from '../src/core/tilt';
import { readFlightControls } from '../src/core/flight-input';
import { Input } from '../src/core/input';
import { SteerControl } from '../src/core/steer-control';
import { createCombatInput } from '../src/combat/combat-input';
import { COURSES } from '../src/data/courses';
import { DRAG_CONFIG, type SteerMode, type StickCurve } from '../src/data/steer';
import { createControls } from '../src/entities/aircraft';
import { decodeGhost, GhostSim } from '../src/missions/race/ghost';
import { decodeReplay, encodeReplay, toBase64 } from '../src/replay/codec';
import { ReplayRecorder } from '../src/replay/recorder';
import { applyFrame, captureFrame, simHash, startFromHeader, stepWorld } from '../src/replay/sim';
import {
  replayControls,
  type ReplayControls,
  type ReplayData,
  type ReplayHeader,
  type ReplayStart,
} from '../src/replay/types';
import { stickToward } from './direct-steer-bots';
import { BASE_START, createWorld, replay, ScriptedPilot, type TestWorld } from './replay-helpers';

/** 9-4: 傾き（人が x・y の分だけ端末を傾ける。横向き 90°・40° 寝かせた持ち方が中立）とドラッグ（中央から x・y の所を押さえる） */
const tiltReader = new TiltReader();
let tiltMs = 0;
function tiltOrDrag(
  input: Input,
  mode: 'tilt' | 'drag',
  curve: number,
  x: number,
  y: number,
): void {
  if (mode === 'drag') {
    const v = dragStick(422 + x * 175, 195 - y * 175, 844, 390, DRAG_CONFIG.radiusRatio, {
      x: 0,
      y: 0,
    });
    input.setDirectStick(v.x, v.y);
    return;
  }
  tiltReader.setOptions({ deadzone: 0.12, curve });
  // 横向き 90°: 画面の右 = 端末の −y、画面の上 = 端末の +x
  const b = ((40 - y * 25) * Math.PI) / 180;
  const a = (x * 25 * Math.PI) / 180;
  const sx = -Math.sin(a) * Math.cos(b);
  const sy = Math.cos(a) * Math.cos(b);
  const beta = (Math.asin(-sx) * 180) / Math.PI;
  const gamma = (Math.atan2(-sy, Math.sin(b)) * 180) / Math.PI;
  tiltMs += 1000 / 60;
  tiltReader.read(beta, gamma, 90, tiltMs);
  input.setDirectStick(tiltReader.value.x, tiltReader.value.y);
}

/** タッチのスティック（TouchControls.writeStick と同じ: カーブ → 方式ごとに Input へ） */
function touchStick(input: Input, mode: SteerMode, curve: number, x: number, y: number): void {
  if (mode === 'tilt' || mode === 'drag') {
    tiltOrDrag(input, mode, curve, x, y);
    return;
  }
  const v = applyStickCurve({ x, y }, curve);
  if (mode === 'direct') {
    input.setDirectStick(v.x, v.y);
    return;
  }
  // 画面の下へ倒す = 機首上げ（y は上が正なので反転）
  input.setAnalog('touch', 'rollRight', Math.max(0, v.x));
  input.setAnalog('touch', 'rollLeft', Math.max(0, -v.x));
  input.setAnalog('touch', 'pitchUp', Math.max(0, v.y));
  input.setAnalog('touch', 'pitchDown', Math.max(0, -v.y));
}

interface Recorded {
  readonly data: ReplayData;
  readonly hashes: string[];
  readonly positions: number[];
}

/**
 * 本番の固定ステップと同じ順（入力を読む → 方向へ倒す方式の組み立て → 記録 → 判定）で飛ぶ。
 * stick は毎ステップのスティックの値（右・上が正）
 */
function recordTouch(
  w: TestWorld,
  start: ReplayStart,
  mode: SteerMode,
  curve: StickCurve,
  seconds: number,
  stick: (w: TestWorld, i: number) => { x: number; y: number },
  done: () => boolean = () => false,
): Recorded {
  startFromHeader(w, start);
  const input = new Input();
  input.directMode = mode !== 'classic';
  tiltReader.reset();
  input.stickSensitivity = 1.2;
  const steer = new SteerControl(input, w.play.session.aircraft, w.map.ground);
  const controls = createControls();
  const combat = createCombatInput();
  const rec = new ReplayRecorder();
  const info: ReplayControls = {
    device: 'touch',
    steerMode: mode,
    stickCurve: curve,
    stickPosition: 'floating',
    sensitivity: 1.2,
    deadzone: 0.12,
  };
  rec.begin(start, {
    title: 't',
    pilotName: 'p',
    date: '2026-11-03T00:00:00Z',
    gameVersion: '1.0.2',
    startHash: simHash(w),
    controls: info,
  });
  const hashes: string[] = [];
  const positions: number[] = [];
  for (let i = 0; i < seconds * 60 && !done(); i++) {
    const s = stick(w, i);
    touchStick(input, mode, curve, s.x, s.y);
    input.setThrottleTarget(0.8);
    readFlightControls(input, controls);
    steer.apply(controls);
    combat.trigger = i % 50 < 10;
    const f = captureFrame(rec.frame, controls, combat, w.play.session);
    applyFrame(f, w.controls, combat, w.play.session);
    rec.push(f);
    stepWorld(w.play, w.buildings(), w.controls, combat, 1 / 60);
    hashes.push(simHash(w));
    const p = w.play.session.aircraft.state.position;
    positions.push(p.x, p.y, p.z);
    input.endStep();
  }
  const data = rec.finish(null);
  if (!data) throw new Error('記録がない');
  return { data, hashes, positions };
}

/** なめらかに動くスティック（ScriptedPilot のピッチ・ロールをスティックの値に使う） */
function scripted(seed: number): (w: TestWorld, i: number) => { x: number; y: number } {
  const pilot = new ScriptedPilot(seed);
  return () => {
    pilot.next();
    return { x: pilot.controls.roll, y: pilot.controls.pitch };
  };
}

describe('方式・カーブによらず、記録は同じ結果で再生できる', () => {
  const cases: readonly [SteerMode, StickCurve][] = [
    ['direct', 1.5],
    ['direct', 1],
    ['direct', 2],
    ['classic', 1],
    ['classic', 1.5],
    // 9-4: 傾き・ドラッグも同じ組み立てに入力を渡すだけ
    ['tilt', 1.5],
    ['drag', 1],
  ];
  for (const [mode, curve] of cases) {
    it(`${mode}・カーブ ${curve}: 別の世界で再生すると全ステップの状態ハッシュが一致し、ヘッダに設定が残る`, () => {
      const rec = recordTouch(createWorld(), BASE_START, mode, curve, 20, scripted(11));
      const data = decodeReplay(encodeReplay(rec.data));
      expect(replayControls(data.header)).toEqual({
        device: 'touch',
        steerMode: mode,
        stickCurve: curve,
        stickPosition: 'floating',
        sensitivity: 1.2,
        deadzone: 0.12,
      });
      // 再生する側の世界には方式の設定が無い（記録の入力だけで決まる）
      const played = replay(createWorld(), data);
      expect(played.player.startMatches).toBe(true);
      expect(played.hashes).toEqual(rec.hashes);
    });
  }

  it('方式で飛び方が変わる（同じスティックの動きでも、方向へ倒すとピッチ・ロールで違う記録になる）', () => {
    const a = recordTouch(createWorld(), BASE_START, 'direct', 1.5, 10, scripted(3));
    const b = recordTouch(createWorld(), BASE_START, 'classic', 1.5, 10, scripted(3));
    expect(a.hashes[a.hashes.length - 1]).not.toBe(b.hashes[b.hashes.length - 1]);
  });

  it('操作の設定の無い記録（9-1 まで）・壊れた設定は null', () => {
    const rec = recordTouch(createWorld(), BASE_START, 'direct', 1.5, 1, scripted(1));
    const old: ReplayHeader = { ...rec.data.header, controls: undefined };
    expect(replayControls(old)).toBeNull();
    const broken: unknown = { ...old, controls: { device: 'mouse' } };
    expect(replayControls(broken as ReplayHeader)).toBeNull();
  });
});

describe('ゴースト（レース）も方式によらず同じ', () => {
  it('方向へ倒す方式で走ったレースは、ゴーストで全ステップ同じ位置', () => {
    const course = COURSES[0];
    if (!course) throw new Error('コースがない');
    const w = createWorld();
    const start: ReplayStart = {
      ...BASE_START,
      mode: 'race',
      mapId: course.mapId,
      courseId: course.id,
      upgrades: { engine: 0, airframe: 0, weapons: 0, avionics: 0 },
    };
    const v = { x: 0, y: 0 };
    let ring = 0;
    const run = recordTouch(
      w,
      start,
      'direct',
      1.5,
      course.timeLimitSeconds + 10,
      (world) => {
        const race = world.play.race;
        const next = race?.rings[race.windowEnd] ?? race?.rings[ring];
        if (race) ring = race.windowEnd;
        return next ? stickToward(v, world.play.session.aircraft.state, next.position) : v;
      },
      () => w.play.race?.phase === 'finished',
    );
    expect(w.play.race?.result?.outcome).toBe('finished');
    const w2 = createWorld();
    w2.map.use(run.data.header.mapId);
    const ghost = new GhostSim(w2.map.ground, () => w2.map.buildings);
    const data = decodeGhost(toBase64(encodeReplay(run.data)), course.id);
    expect(data).not.toBeNull();
    ghost.start(data);
    let worst = 0;
    for (let i = 0; i < run.data.header.steps; i++) {
      ghost.step();
      const p = ghost.play.session.aircraft.state.position;
      worst = Math.max(
        worst,
        Math.abs(p.x - (run.positions[i * 3] ?? 0)),
        Math.abs(p.y - (run.positions[i * 3 + 1] ?? 0)),
        Math.abs(p.z - (run.positions[i * 3 + 2] ?? 0)),
      );
    }
    expect(worst).toBe(0);
  }, 60_000);
});
