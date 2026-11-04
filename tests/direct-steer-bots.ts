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
import { inverseRotateVec3, rotateVec3, type Vec3 } from '../src/flight/math';

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

const LOOP = DIRECT_STEER_CONFIG.loop;
const body: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * 宙返り（9-3）の人の倒し方: 機首が上を向いている（60° より上）か宙返りの途中で、向かう点が機体から見て上（頭の側）に
 * 10° より上・左右のずれが小さいなら、上へ倒し続ける（「上へ倒し続ければ回る」）。宙返りの途中は、向かう点を通る輪の
 * 半径になるよう倒し具合を加減する（端 = 輪の半径 loop.radius、戻すほど大きな輪）。向かう点がはっきり下（-3°）に
 * なったら離す（頂点ならインメルマン）。宙返りの倒し方をしたら true
 */
export function loopStick(
  out: { x: number; y: number },
  state: Readonly<FlightState>,
  point: Readonly<Vec3>,
  looping: boolean,
): boolean {
  rotateVec3(f, state.orientation, LOCAL_FORWARD);
  if (!looping && f.y < Math.sin((60 * Math.PI) / 180)) return false;
  const p = state.position;
  body.x = point.x - p.x;
  body.y = point.y - p.y;
  body.z = point.z - p.z;
  inverseRotateVec3(body, state.orientation, body);
  const up = body.y;
  const ahead = -body.z;
  const pitchTo = Math.atan2(up, ahead);
  const side = Math.atan2(Math.abs(body.x), Math.hypot(up, ahead));
  // 入る前は向かう点が 10° より上、回っている間は 3° より下（はっきり外）になるまで倒し続ける（外れ気味なら大きな輪）
  const below = looping ? -3 : 10;
  if (pitchTo < (below * Math.PI) / 180 || side > (30 * Math.PI) / 180) {
    if (!looping) return false;
    out.x = 0;
    out.y = 0;
    return true;
  }
  out.x = 0;
  if (!looping) {
    out.y = 1;
    return true;
  }
  // 機首の接線で向かう点を通る円の半径 R = (上² + 前²) / (2 上)
  const r = (up * up + ahead * ahead) / (2 * Math.max(1e-3, up));
  const s = Math.min(1, Math.max(0, (LOOP.radius / r - 0.5) / 0.5));
  out.y = LOOP.holdStick + s * (1 - LOOP.holdStick);
  return true;
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
  private readonly approach: Vec3 = { x: 0, y: 0, z: 0 };
  /** 真下向きのリングを飛ばして並ぶ、次のリングの番号（-1 はしていない）と、手前の点を過ぎたか */
  private lineUp = -1;
  private lineUpReached = false;

  constructor(private readonly sim: RaceSim) {
    this.path = coursePath(sim.race.course, sim.race.rings, this.ringIndex);
  }

  /**
   * この方式は真下（-maxElevationDeg より下）へは向けないので、真下向きのリングは飛ばし（+5 秒）、次のリングの手前
   * LINE_UP_DISTANCE m の点へ回り込んでから通る（人がするように）。向かう点（無ければ null）
   */
  private straightDown(): Vec3 | null {
    const race = this.sim.race;
    const ring = race.rings[race.next];
    const follow = race.rings[race.next + 1];
    if (!ring || !follow || ring.normal.y > -Math.sin((85 * Math.PI) / 180)) {
      this.lineUp = -1;
      return null;
    }
    if (this.lineUp !== follow.index) {
      this.lineUp = follow.index;
      this.lineUpReached = false;
    }
    const n = follow.normal;
    const c = follow.position;
    const p = this.sim.play.session.aircraft.state.position;
    // リングの面からの距離（通る向きの手前が負）
    const before = (p.x - c.x) * n.x + (p.y - c.y) * n.y + (p.z - c.z) * n.z;
    const a = this.approach;
    a.x = c.x - n.x * LINE_UP_DISTANCE;
    a.y = c.y - n.y * LINE_UP_DISTANCE;
    a.z = c.z - n.z * LINE_UP_DISTANCE;
    if (Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z) < 200 || before > -LINE_UP_DISTANCE * 0.6)
      this.lineUpReached ||= Math.hypot(p.x - a.x, p.y - a.y, p.z - a.z) < 200;
    return this.lineUpReached ? c : a;
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
    const t =
      this.straightDown() ??
      (missed ? required.position : this.path[Math.min(this.path.length - 1, this.index + ahead)]);
    if (t && !loopStick(this.stick, s, t, this.steer.loop.active)) stickToward(this.stick, s, t);
    const spec = this.sim.play.session.aircraft.flight.spec;
    this.steer.apply(this.controls, s, this.stick.x, this.stick.y, this.sim.map.ground, spec);
    return this.controls;
  }
}

const LINE_UP_DISTANCE = 450;

/** 「方向へ倒す」方式でリングレースをゴール（または時間切れ）まで飛ばす。墜落の回数も返す */
export function runDirectRace(
  course: CourseDef,
  aircraftId?: string,
): {
  result: RaceResult | null;
  crashes: number;
  sim: RaceSim;
} {
  const sim = startRaceSim(course, null, aircraftId);
  const bot = new DirectRaceBot(sim);
  const input = createCombatInput();
  let crashes = 0;
  sim.play.session.onRespawn(() => crashes++);
  const limit = (course.timeLimitSeconds + 10) / DT;
  for (let i = 0; i < limit && sim.race.phase !== 'finished'; i++)
    sim.play.step(bot.think(), input, DT);
  return { result: sim.race.result, crashes, sim };
}
