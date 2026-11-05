// 9-2 / 9-8: リングレースを「方向へ倒す」方式で飛ぶボット（tests/direct-steer-bots.ts が 300 行を超えたので分けた。9-8）
import type { Hands } from '../scripts/replay-analysis/hands';
import { createCombatInput } from '../src/combat/combat-input';
import type { AircraftControls } from '../src/entities/aircraft';
import { DirectSteer } from '../src/flight/direct-steer';
import { LOCAL_FORWARD, type FlightState } from '../src/flight/flight-model';
import { inverseRotateVec3, rotateVec3, type Vec3 } from '../src/flight/math';
import type { RaceRing } from '../src/missions/race/course';
import { ringCues, type RingCue } from '../src/missions/race/guide';
import type { RaceResult } from '../src/missions/race/runner';
import type { CourseDef } from '../src/missions/race/types';
import { loopStick, stickToward } from './direct-steer-bots';
import { coursePath, DT, startRaceSim, type RaceSim } from './race-bots';

const f: Vec3 = { x: 0, y: 0, z: 0 };

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
  private readonly racing: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly approach: Vec3 = { x: 0, y: 0, z: 0 };
  private backing = false;
  /** 同じリングで離れて向かい直した回数（9-8） */
  private retries = 0;
  /** 引き起こしで上へ倒す量（引きの角速度を見て加減する） */
  private pullStick = 0.6;
  private stuckRing = -1;
  private stuckSteps = 0;
  private extendSteps = 0;

  /** 9-8: 道案内の印（普通に飛ぶと通れないリング） */
  private readonly cues: (RingCue | null)[];

  /** 9-8: 人の手（反応の遅れ・指のぶれ・デッドゾーン・カーブ。null は手なし = 出したい値のまま） */
  private readonly intent: AircraftControls = { ...this.controls };
  private readonly finger: AircraftControls = { ...this.controls };

  constructor(
    private readonly sim: RaceSim,
    private readonly hands: Hands | null = null,
  ) {
    this.path = coursePath(sim.race.course, sim.race.rings, this.ringIndex);
    this.cues = ringCues(sim.race.course, sim.race.rings);
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
      this.retries = 0;
    }
    this.stuckSteps++;
    if (this.extendSteps > 0) {
      this.extendSteps--;
      this.stick.x = 0;
      // 低い所では少し上がりながら（9-8: 地表からの高さで見る。渓谷で 700m まで登って戻れなくならないように）
      const agl = s.position.y - this.sim.map.ground(s.position.x, s.position.z);
      this.stick.y = agl < EXTEND_CLIMB_AGL ? 0.4 : 0;
      return true;
    }
    if (this.stuckSteps > STUCK_SECONDS / DT) {
      this.stuckSteps = 0;
      this.extendSteps = Math.round(EXTEND_SECONDS / DT);
      // 9-8: 離れた後は、飛ばせないリング（チェックポイント・ゴール）の手前へ回り込んでから向かう（backTo。
      // 飛ばせるリングは飛ばして +5 秒。人が道案内の「戻るか、先へ」を見て先へ進むように）
      this.retries++;
      this.backing = false;
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
    // 9-8: 人の手（反応の遅れ）があるときは、遅れの分だけ先を見る（遅れたまま近い点を追うと左右に振れる）
    const lead = 0.7 + (this.hands ? this.hands.spec.delay * HANDS_LEAD : 0);
    const ahead = Math.round((s.speed * lead) / 10);
    rotateVec3(f, s.orientation, LOCAL_FORWARD);
    const down = this.downRing();
    const nextRing = race.rings[race.next];
    if (!down && nextRing && this.pullOut(s, nextRing.position)) return this.finish(s);
    if (this.extend(s)) return this.finish(s);
    const t =
      down ??
      (missed
        ? this.backTo(s, required)
        : this.retries > 0 && required && (this.cues[race.next] ?? null) === null
          ? this.backTo(s, required)
          : this.path[Math.min(this.path.length - 1, this.index + ahead)]);
    // 9-8: 宙返りの倒し方は、次かその次のリングに「上へ」「宙返り」の印があるときだけ（人が印を見て宙返りに入るように。
    // 渓谷の登りで低空の安全に引き上げられて機首が 60° を超えても、宙返りに入らない）
    const loopAhead = [race.next, race.next + 1].some((k) => {
      const c = this.cues[k];
      return c === 'up' || c === 'loop';
    });
    const looping = this.steer.loop.active;
    if (t && !((loopAhead || looping) && loopStick(this.stick, s, t, looping))) {
      stickToward(this.stick, s, t);
      // 9-8: 上下はリングの高さへ（次から 3 個に印（宙返り・真下など）があれば、入り方を変えないよう道筋のまま）
      const k0 = nextRing?.index ?? -3;
      const plain =
        [k0, k0 + 1, k0 + 2].every((k) => (this.cues[k] ?? null) === null) &&
        Math.abs(nextRing?.normal.y ?? 1) < Math.sin((25 * Math.PI) / 180);
      // 真下向きのリングの後（引き起こし・上下のスラローム）は 9-4 の倒し方のまま
      if (!down && !missed && nextRing && plain && !this.afterDive(AFTER_DIVE_RINGS))
        this.aimRingHeight(s, nextRing);
    }
    return this.finish(s);
  }

  /**
   * 9-8: 飛ばせないリングを通り損ねて戻るとき（人が道案内の「戻って通る」を見て回り込むように）: リングの手前
   * （法線の逆へ BACK_APPROACH m・地表から 80m 以上）へ向かい、リングの正面の 35° 内に入ったらリングへ
   */
  private backTo(s: Readonly<FlightState>, ring: RaceRing): Readonly<Vec3> {
    const p = s.position;
    const n = ring.normal;
    const dx = ring.position.x - p.x;
    const dy = ring.position.y - p.y;
    const dz = ring.position.z - p.z;
    const d = Math.hypot(dx, dy, dz);
    const front = d > 1e-6 ? (dx * n.x + dy * n.y + dz * n.z) / d : 0;
    // リングの面の先へ抜けた（通り損ねた）ら、もう一度手前へ回り込む
    if (front < 0) this.backing = false;
    if (front > Math.cos((BACK_CONE_DEG * Math.PI) / 180) || d < 250) {
      this.backing = false;
      return ring.position;
    }
    const o = this.approach;
    o.x = ring.position.x - n.x * BACK_APPROACH;
    o.y = ring.position.y - n.y * BACK_APPROACH;
    o.z = ring.position.z - n.z * BACK_APPROACH;
    o.y = Math.max(o.y, this.sim.map.ground(o.x, o.z) + 80);
    if (Math.hypot(o.x - p.x, o.y - p.y, o.z - p.z) < 300) this.backing = true;
    return this.backing ? ring.position : o;
  }

  /**
   * 9-8: リングの狙う点（人の通り道の取り方）: 中心から、その次のリングの側へ通過半径の RACING_LINE 倍ずらした点
   * （その次へ曲がりながら抜ける。上下のスラロームで先に下り始める）。その次がなければ中心
   */
  private aimPoint(ring: RaceRing): Readonly<Vec3> {
    const after = this.sim.race.rings[ring.index + 1];
    if (!after) return ring.position;
    const n = ring.normal;
    const d = this.local;
    d.x = after.position.x - ring.position.x;
    d.y = after.position.y - ring.position.y;
    d.z = after.position.z - ring.position.z;
    const k = d.x * n.x + d.y * n.y + d.z * n.z;
    d.x -= k * n.x;
    d.y -= k * n.y;
    d.z -= k * n.z;
    const len = Math.hypot(d.x, d.y, d.z);
    const o = this.racing;
    const m = len > 1e-6 ? (ring.passRadius * RACING_LINE) / len : 0;
    o.x = ring.position.x + d.x * m;
    o.y = ring.position.y + d.y * m;
    o.z = ring.position.z + d.z * m;
    return o;
  }

  /**
   * 9-8: 次のリングが近い（AIM_RING_SECONDS 秒以内・前方）なら、上下はリングの中心へ倒す（人がリングを見て高さを合わせるように。
   * 道筋の先読みだけだと、上り・下りのリングで上下に 40〜130m 外れていた）。左右は道筋のまま
   */
  private aimRingHeight(s: Readonly<FlightState>, ring: RaceRing): void {
    const p = s.position;
    const d = Math.hypot(ring.position.x - p.x, ring.position.y - p.y, ring.position.z - p.z);
    if (d > s.speed * AIM_RING_SECONDS || d < 40) return;
    rotateVec3(f, s.orientation, LOCAL_FORWARD);
    const ahead =
      (f.x * (ring.position.x - p.x) +
        f.y * (ring.position.y - p.y) +
        f.z * (ring.position.z - p.z)) /
      d;
    if (ahead < AIM_RING_CONE) return;
    const at = stickToward(aim, s, this.aimPoint(ring));
    this.stick.y = at.y;
    // 上下を優先（左右は残りの分だけ。下へ深く倒し続けると背面で引いて早く下りる: DirectSteer の diveRoll）
    const room = Math.sqrt(Math.max(0, 1 - this.stick.y * this.stick.y));
    this.stick.x = Math.max(-room, Math.min(room, this.stick.x));
  }

  private finish(s: Readonly<FlightState>): AircraftControls {
    // 真下向きのリングと、その次（引き起こした先）へは、スロットルを絞る（引き起こしの輪を小さく）
    this.controls.throttleTarget = this.downRing() || this.afterDive(1) ? DIVE_THROTTLE : 1;
    const spec = this.sim.play.session.aircraft.flight.spec;
    let sx = this.stick.x;
    let sy = this.stick.y;
    if (this.hands) {
      // 9-8: 出したいスティックの値を人の手に通す（scripts/replay-analysis/direct.ts と同じ: 上 = pitch・右 = roll）
      this.intent.pitch = sy;
      this.intent.roll = sx;
      this.hands.apply(this.intent, this.finger);
      sx = this.finger.roll;
      sy = this.finger.pitch;
    }
    this.steer.apply(this.controls, s, sx, sy, this.sim.map.ground, spec);
    return this.controls;
  }
}

function isDownRing(ring: { readonly normal: Readonly<Vec3> }): boolean {
  return ring.normal.y < -Math.sin((85 * Math.PI) / 180);
}

const DIVE_THROTTLE = 0.4;
/** 9-8: 次のリングまでこの秒数より近く・機首から 45° 内なら、上下はリングの狙う点へ倒す */
const AIM_RING_SECONDS = 1.6;
const AIM_RING_CONE = Math.cos((45 * Math.PI) / 180);
/** 9-8: リングの狙う点を、その次のリングの側へ通過半径のこの倍だけずらす */
const RACING_LINE = 0.5;
/** 9-8: 通り損ねた飛ばせないリングへ戻るとき、リングの手前のこの距離（m）へ回り込む */
const BACK_APPROACH = 700;
/** 9-8: 戻るとき、リングの正面のこの角度（度）内に入ったらリングへ向かう */
const BACK_CONE_DEG = 35;
const HANDS_LEAD = 2;
/** 9-8: 離れる間、地表からこの高さ（m）より低ければ少し上がる（9-4 は高度 700m より低ければ） */
const EXTEND_CLIMB_AGL = 150;
const aim = { x: 0, y: 0 };
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
  hands: Hands | null = null,
): {
  result: RaceResult | null;
  crashes: number;
  sim: RaceSim;
} {
  const sim = startRaceSim(course, null, aircraftId);
  const bot = new DirectRaceBot(sim, hands);
  const input = createCombatInput();
  let crashes = 0;
  sim.play.session.onRespawn(() => crashes++);
  const limit = (course.timeLimitSeconds + 10) / DT;
  for (let i = 0; i < limit && sim.race.phase !== 'finished'; i++)
    sim.play.step(bot.think(), input, DT);
  return { result: sim.race.result, crashes, sim };
}
