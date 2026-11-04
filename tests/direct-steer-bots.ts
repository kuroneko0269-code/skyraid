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
  private readonly local: Vec3 = { x: 0, y: 0, z: 0 };
  /** 引き起こしで上へ倒す量（引きの角速度を見て加減する） */
  private pullStick = 0.6;
  private stuckRing = -1;
  private stuckSteps = 0;
  private extendSteps = 0;

  constructor(private readonly sim: RaceSim) {
    this.path = coursePath(sim.race.course, sim.race.rings, this.ringIndex);
  }

  /**
   * 9-4: 真下向きのリング（アクロバットの 11 番）は、その上にいる間はリングの中心へ倒す（人が見て向かうように）。
   * 深く下へ倒すと背面へ回して引くので、スプリット S の形で通る。向かう点（真下向きのリングでなければ null）
   */
  private downRing(): Vec3 | null {
    const race = this.sim.race;
    const ring = race.rings[race.next];
    if (!ring || !isDownRing(ring)) return null;
    // 通り損ねて下へ抜けたら、道筋に戻ってもう一度
    return this.sim.play.session.aircraft.state.position.y > ring.position.y - 60
      ? ring.position
      : null;
  }

  /** 真下向きのリングの後 n 個のうちか（引き起こしからの上下のスラローム） */
  private afterDive(n: number): boolean {
    const race = this.sim.race;
    for (let k = 1; k <= n; k++) {
      const prev = race.rings[race.next - k];
      if (prev && isDownRing(prev)) return true;
    }
    return false;
  }

  /**
   * 真下向きのリングの後（引き起こし・スラローム）: 機首の接線で次のリングを通る輪の半径から要る引きの角速度を出し、
   * 実際の角速度との差で上へ倒す量を加減する（人が「引き過ぎ・足りない」を見て加減するように）。していなければ false
   */
  private pullOut(s: Readonly<FlightState>, point: Readonly<Vec3>): boolean {
    if (!this.afterDive(AFTER_DIVE_RINGS) || f.y > -0.2) {
      this.pullStick = 0.6;
      return false;
    }
    const b = this.local;
    b.x = point.x - s.position.x;
    b.y = point.y - s.position.y;
    b.z = point.z - s.position.z;
    inverseRotateVec3(b, s.orientation, b);
    const up = b.y;
    const ahead = -b.z;
    // 向かう点が前・頭の側（引けば向く面の中）にあるときだけ
    if (up <= 0 || ahead <= 0 || Math.abs(b.x) > up) return false;
    const r = (up * up + ahead * ahead) / (2 * up);
    const want = s.speed / r;
    this.pullStick = Math.max(
      0,
      Math.min(1, this.pullStick + (want - s.angularRate.x) * PULL_GAIN),
    );
    // 左右は向かう点へ（地平線が基準）、上下は引きの加減
    stickToward(this.stick, s, point);
    this.stick.y = this.pullStick;
    return true;
  }

  /** 同じリングの周りを回り続けたら（旋回の輪の内側）、まっすぐ離れてから向かい直す。離れている間は true */
  private extend(s: Readonly<FlightState>): boolean {
    const next = this.sim.race.next;
    if (next !== this.stuckRing) {
      this.stuckRing = next;
      this.stuckSteps = 0;
      this.extendSteps = 0;
    }
    this.stuckSteps++;
    if (this.extendSteps > 0) {
      this.extendSteps--;
      this.stick.x = 0;
      // 低い所では少し上がりながら
      this.stick.y = s.position.y < 700 ? 0.4 : 0;
      return true;
    }
    if (this.stuckSteps > STUCK_SECONDS / DT) {
      this.stuckSteps = 0;
      this.extendSteps = Math.round(EXTEND_SECONDS / DT);
    }
    return false;
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
    rotateVec3(f, s.orientation, LOCAL_FORWARD);
    const down = this.downRing();
    const nextRing = race.rings[race.next];
    if (!down && nextRing && this.pullOut(s, nextRing.position)) return this.finish(s);
    if (this.extend(s)) return this.finish(s);
    const t =
      down ??
      (missed ? required.position : this.path[Math.min(this.path.length - 1, this.index + ahead)]);
    if (t && !loopStick(this.stick, s, t, this.steer.loop.active)) stickToward(this.stick, s, t);
    return this.finish(s);
  }

  private finish(s: Readonly<FlightState>): AircraftControls {
    // 真下向きのリングと、その次（引き起こした先）へは、スロットルを絞る（引き起こしの輪を小さく）
    this.controls.throttleTarget = this.downRing() || this.afterDive(1) ? DIVE_THROTTLE : 1;
    const spec = this.sim.play.session.aircraft.flight.spec;
    this.steer.apply(this.controls, s, this.stick.x, this.stick.y, this.sim.map.ground, spec);
    return this.controls;
  }
}

function isDownRing(ring: { readonly normal: Readonly<Vec3> }): boolean {
  return ring.normal.y < -Math.sin((85 * Math.PI) / 180);
}

const DIVE_THROTTLE = 0.4;
/** 引き起こしで加減するのは、真下向きのリングの後この個数まで */
const AFTER_DIVE_RINGS = 3;
const PULL_GAIN = 0.15;
/** 同じリングをこの秒数通れなければ、EXTEND_SECONDS 秒まっすぐ離れる */
const STUCK_SECONDS = 9;
const EXTEND_SECONDS = 4;

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
