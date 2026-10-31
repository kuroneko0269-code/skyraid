// リングレース（7-1）のシミュレーション用のボット: 本番と同じ FlightSession + GamePlay（レース）を、
// リングをつなぐ道筋を先読みで追ってスロットル全開で飛ばす（ブーストリングのアフターバーナーだけ。自分では点けない）
import { steerToward } from '../src/ai/steering';
import { createCombatInput } from '../src/combat/combat-system';
import { createRandom } from '../src/core/random';
import { STARTER_AIRCRAFT, findAircraftModel } from '../src/data/aircraft';
import type { AircraftControls } from '../src/entities/aircraft';
import { LOCAL_FORWARD } from '../src/flight/flight-model';
import { rotateVec3, type Vec3 } from '../src/flight/math';
import { ActiveMap } from '../src/missions/active-map';
import { FlightSession } from '../src/missions/flight-session';
import { GamePlay } from '../src/missions/game-play';
import type { RaceRing } from '../src/missions/race/course';
import type { RaceReference, RaceResult, RaceRunner } from '../src/missions/race/runner';
import type { CourseDef } from '../src/missions/race/types';
import { resolveLoadout } from '../src/progression/loadout';
import { initialUpgrades } from '../src/progression/save';

export const DT = 1 / 60;

export interface RaceSim {
  readonly play: GamePlay;
  readonly race: RaceRunner;
  readonly map: ActiveMap;
}

/** コースのマップで、オートレベルなし（ボットがロールを操る）・未強化の Kestrel でレースを始める */
export function startRaceSim(
  course: CourseDef,
  reference: RaceReference | null = null,
  aircraftId = STARTER_AIRCRAFT.id,
): RaceSim {
  const map = new ActiveMap();
  map.use(course.mapId);
  const session = new FlightSession({
    rng: createRandom(1),
    groundHeight: map.ground,
    buildings: () => map.buildings,
    flightOptions: { autoLevel: false },
  });
  const model = findAircraftModel(aircraftId);
  if (model) session.applyLoadout(resolveLoadout(model, initialUpgrades()));
  const play = new GamePlay(session);
  const race = play.startRace(course, reference);
  return { play, race, map };
}

const nose = { x: 0, y: 0, z: 0 };
const SAMPLE = 10;

/**
 * コースの道筋: 開始位置 → 各リングの中心を、リングの向きを接線にした 3 次エルミート曲線でつなぎ、SAMPLE m ごとの点にする
 */
export function coursePath(
  course: CourseDef,
  rings: readonly RaceRing[],
  ringIndex: number[] = [],
): Vec3[] {
  const s = course.start;
  const h = (s.headingDeg * Math.PI) / 180;
  const nodes = [
    { p: { x: s.x, y: s.y, z: s.z }, n: { x: Math.sin(h), y: 0, z: -Math.cos(h) } },
    ...rings.map((r) => ({ p: r.position, n: r.normal })),
  ];
  const out: Vec3[] = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    if (!a || !b) continue;
    const len = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y, b.p.z - a.p.z);
    const n = Math.max(1, Math.ceil(len / SAMPLE));
    if (i > 0) ringIndex[i - 1] = out.length;
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
      const h10 = t ** 3 - 2 * t ** 2 + t;
      const h01 = -2 * t ** 3 + 3 * t ** 2;
      const h11 = t ** 3 - t ** 2;
      const at = (k2: 'x' | 'y' | 'z'): number =>
        h00 * a.p[k2] + h10 * a.n[k2] * len + h01 * b.p[k2] + h11 * b.n[k2] * len;
      out.push({ x: at('x'), y: at('y'), z: at('z') });
    }
  }
  const last = nodes[nodes.length - 1];
  if (last) {
    ringIndex[nodes.length - 2] = out.length;
    out.push({ ...last.p });
    // ゴールの先へまっすぐ伸ばす（先読みの点が尽きないように）
    for (let k = 1; k <= 60; k++)
      out.push({
        x: last.p.x + last.n.x * k * SAMPLE,
        y: last.p.y + last.n.y * k * SAMPLE,
        z: last.p.z + last.n.z * k * SAMPLE,
      });
  }
  return out;
}

/**
 * 道筋を追うボット（先読み追従）: 道筋の上で自機に最も近い点（前に進むだけ）から、速度 × 0.7 秒先の点へ機首を向ける。
 * スロットルは全開（ブーストリングのアフターバーナーだけ）。機首と狙いが 20° 以上ずれていたら 0.6 に絞る。
 * 今の降下率のまま 0.8 秒後に地表から 35m（建物の屋根から 12m）を切るなら引き起こす
 */
export class RaceBot {
  readonly controls: AircraftControls = {
    pitch: 0,
    roll: 0,
    yaw: 0,
    throttle: 0,
    afterburner: false,
    throttleTarget: 1,
  };
  private readonly path: Vec3[];
  /** リングごとの道筋の点の番号 */
  private readonly ringIndex: number[] = [];
  private index = 0;

  constructor(private readonly sim: RaceSim) {
    this.path = coursePath(sim.race.course, sim.race.rings, this.ringIndex);
  }

  think(): AircraftControls {
    const out = this.controls;
    const sim = this.sim;
    const s = sim.play.session.aircraft.state;
    const p = s.position;
    // 撃墜から戻ったら、近い点を探し直す
    const from = this.index;
    let best = Infinity;
    const window = from + 80;
    for (let i = Math.max(0, from - 5); i < Math.min(this.path.length, window); i++) {
      const q = this.path[i];
      if (!q) continue;
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2;
      if (d < best) {
        best = d;
        this.index = i;
      }
    }
    if (Math.sqrt(best) > 400) this.relocate(p);
    const ahead = Math.round((s.speed * 0.7) / SAMPLE);
    // 飛ばせないリング（チェックポイント・ゴール）を通り損ねて道筋の先へ進んでしまったら、そのリングへ直接戻る
    const race = sim.race;
    const required = race.rings[race.windowEnd];
    const missedRequired =
      required !== undefined && this.index > (this.ringIndex[required.index] ?? Infinity) + 20;
    const t = missedRequired
      ? required.position
      : this.path[Math.min(this.path.length - 1, this.index + ahead)];
    out.throttle = 0;
    out.throttleTarget = 1;
    out.afterburner = false;
    if (!t) return out;
    const dir = { x: t.x - p.x, y: t.y - p.y, z: t.z - p.z };
    rotateVec3(nose, s.orientation, LOCAL_FORWARD);
    const len = Math.hypot(dir.x, dir.y, dir.z);
    const cos = (nose.x * dir.x + nose.y * dir.y + nose.z * dir.z) / Math.max(1e-6, len);
    if (cos < Math.cos((20 * Math.PI) / 180)) out.throttleTarget = 0.6;
    const sink = nose.y * s.speed * 0.8;
    const roof = sim.map.buildings?.topAt(p.x, p.z) ?? -Infinity;
    if (p.y - sim.map.ground(p.x, p.z) + sink < 35 || p.y - roof + sink < 12)
      dir.y = Math.max(dir.y, len);
    steerToward(out, s.orientation, s.angularRate, dir, 1);
    return out;
  }

  /** 道筋全体から近い点を探し直す（墜落から最後のリングへ戻ったとき） */
  private relocate(p: Readonly<Vec3>): void {
    let best = Infinity;
    this.path.forEach((q, i) => {
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 + (q.z - p.z) ** 2;
      if (d < best) {
        best = d;
        this.index = i;
      }
    });
  }
}

/** ゴール（または時間切れ）まで飛ばす。墜落の回数も返す */
export function runRaceBot(
  course: CourseDef,
  reference: RaceReference | null = null,
): { result: RaceResult; crashes: number; sim: RaceSim } {
  const sim = startRaceSim(course, reference);
  const bot = new RaceBot(sim);
  const input = createCombatInput();
  let crashes = 0;
  sim.play.session.onRespawn(() => crashes++);
  const limit = (course.timeLimitSeconds + 10) / DT;
  for (let i = 0; i < limit && sim.race.phase !== 'finished'; i++) {
    sim.play.step(bot.think(), input, DT);
  }
  if (!sim.race.result) throw new Error('レースが終わらなかった');
  return { result: sim.race.result, crashes, sim };
}
