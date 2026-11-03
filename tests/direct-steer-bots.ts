// 「方向へ倒す」方式（9-2）のテスト・診断用: 向かいたい点を、この方式のスティックの値（右・上が正、合成の大きさ 1 まで）にする。
// 人は「機首から見て右へ何度・上へ何度」（地平線が基準）を見て倒す。端まで倒すのは DIRECT_STEER_CONFIG.fullDeg 度より外
import { createCombatInput } from '../src/combat/combat-input';
import { DIRECT_STEER_CONFIG } from '../src/data/steer';
import type { AircraftControls } from '../src/entities/aircraft';
import { DirectSteer } from '../src/flight/direct-steer';
import type { RaceResult } from '../src/missions/race/runner';
import type { CourseDef } from '../src/missions/race/types';
import { coursePath, DT, startRaceSim, type RaceSim } from './race-bots';
import { LOCAL_FORWARD, LOCAL_UP, type FlightState } from '../src/flight/flight-model';
import { rotateVec3, type Vec3 } from '../src/flight/math';

const f: Vec3 = { x: 0, y: 0, z: 0 };
const u: Vec3 = { x: 0, y: 0, z: 0 };

function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

/** point へ向かうスティックの値を out に書く（後ろなら近い側の端へ倒し切る） */
export function stickToward(
  out: { x: number; y: number },
  state: Readonly<FlightState>,
  point: Readonly<Vec3>,
): { x: number; y: number } {
  const p = state.position;
  rotateVec3(f, state.orientation, LOCAL_FORWARD);
  rotateVec3(u, state.orientation, LOCAL_UP);
  // 方位は DirectSteer と同じ取り方（機首の水平成分 + 機体の上下の向きの水平成分）
  const heading = Math.atan2(f.x - u.x * f.y, -(f.z - u.z * f.y));
  const dx = point.x - p.x;
  const dz = point.z - p.z;
  const ax = wrapPi(Math.atan2(dx, -dz) - heading);
  const ay =
    Math.atan2(point.y - p.y, Math.hypot(dx, dz)) - Math.asin(Math.max(-1, Math.min(1, f.y)));
  const full = (DIRECT_STEER_CONFIG.fullDeg * Math.PI) / 180;
  let x = ax / full;
  let y = ay / full;
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  out.x = x;
  out.y = y;
  return out;
}

/**
 * リングレースを「方向へ倒す」方式で飛ぶボット（9-2）: RaceBot（tests/race-bots.ts）と同じ道筋の先読みの点へスティックを倒し、
 * 本番と同じ DirectSteer で組み立てる。地面の回避は自分ではしない（低空の安全だけ）
 */
export class DirectRaceBot {
  readonly controls: AircraftControls = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: 0,
    afterburner: false,
    throttleTarget: 1,
  };
  private readonly path: Vec3[];
  private readonly ringIndex: number[] = [];
  private index = 0;
  private readonly steer = new DirectSteer();
  private readonly stick = { x: 0, y: 0 };

  constructor(private readonly sim: RaceSim) {
    this.path = coursePath(sim.race.course, sim.race.rings, this.ringIndex);
  }

  think(): AircraftControls {
    const s = this.sim.play.session.aircraft.state;
    const p = s.position;
    let best = Infinity;
    const from = this.index;
    for (let i = Math.max(0, from - 5); i < Math.min(this.path.length, from + 80); i++) {
      const q = this.path[i];
      if (!q) continue;
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2;
      if (d < best) {
        best = d;
        this.index = i;
      }
    }
    if (Math.sqrt(best) > 400) {
      this.path.forEach((q, i) => {
        const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2;
        if (d < best) {
          best = d;
          this.index = i;
        }
      });
    }
    const race = this.sim.race;
    const required = race.rings[race.windowEnd];
    const missed =
      required !== undefined && this.index > (this.ringIndex[required.index] ?? Infinity) + 20;
    const ahead = Math.round((s.speed * 0.7) / 10);
    const t = missed
      ? required.position
      : this.path[Math.min(this.path.length - 1, this.index + ahead)];
    if (t) stickToward(this.stick, s, t);
    this.steer.apply(this.controls, s, this.stick.x, this.stick.y, this.sim.map.ground);
    return this.controls;
  }
}

/** 「方向へ倒す」方式でリングレースをゴール（または時間切れ）まで飛ばす。墜落の回数も返す */
export function runDirectRace(course: CourseDef): {
  result: RaceResult | null;
  crashes: number;
  sim: RaceSim;
} {
  const sim = startRaceSim(course);
  const bot = new DirectRaceBot(sim);
  const input = createCombatInput();
  let crashes = 0;
  sim.play.session.onRespawn(() => crashes++);
  const limit = (course.timeLimitSeconds + 10) / DT;
  for (let i = 0; i < limit && sim.race.phase !== 'finished'; i++)
    sim.play.step(bot.think(), input, DT);
  return { result: sim.race.result, crashes, sim };
}
