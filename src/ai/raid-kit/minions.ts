// 10-2: 子分を生む仕組み（レイドの怪獣の共通の部品。白鯨の腹の巣から出る小さな飛ぶ怪獣を想定）。
// - 巣（体に付いた点）ごとに一定時間ごとに数匹ずつ出す。巣の部位が壊れたら、その巣からは出ない
// - 同時に飛べる数の上限（プールの大きさ）。上限なら出さずに待つ（数え直しは次の間隔）
// - 動き: 出てすぐは巣から下へ散る → 狙う人へ曲がり（1 秒あたりの曲がる角度の上限）・近づくと周りを回る。狙う人が
//   いなければ体の周りを回る。寿命で消える（撃墜には数えない）
// - 撃墜の数え: 攻撃した人ごと（勲章・成績）。決まった計算（乱数は渡された種の列だけ）。Three.js・DOM 非依存
import { vec3, type Vec3 } from '../../flight/math';
import { bodyPoint, type BodyFrame, type BodyOffset } from './frame';

export interface NestSpec {
  readonly offset: BodyOffset;
  /** この巣の部位（PartSet の番号。壊れたら止まる。-1 は部位なし） */
  readonly part: number;
}

export interface MinionSpec {
  /** 同時に飛べる数（全部の巣の合計） */
  readonly cap: number;
  /** 最初に出すまでの秒数と、出す間隔（秒） */
  readonly firstDelay: number;
  readonly interval: number;
  /** 1 回に 1 つの巣から出す数 */
  readonly perNest: number;
  readonly hp: number;
  /** 速さ（m/s）・曲がる速さ（度/秒）・寿命（秒） */
  readonly speed: number;
  readonly turnDeg: number;
  readonly life: number;
  /** 狙う人の周りを回る半径（m）と、体の周りを回る半径（m） */
  readonly orbit: number;
  readonly homeOrbit: number;
  /** 出てすぐ下へ散る秒数 */
  readonly dropSeconds: number;
}

export interface Minion {
  active: boolean;
  /** 出た順の番号（協力の写しの突き合わせ。0〜65535 で回る） */
  id: number;
  nest: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  hp: number;
  age: number;
  /** 回る向き（1 / -1。出たときの乱数） */
  spin: number;
}

/** 狙う人の位置（いなければ null） */
export type MinionTarget = (minion: Readonly<Minion>) => Readonly<Vec3> | null;

/**
 * 10-3c: 子分の飛び方を怪獣ごとに差し替える（index はプールの番号）。速度を書き換えて true を返すと、いつもの曲がり方をせず
 * その速度で進む（寿命・位置の進め方は同じ）
 */
export type MinionOverride = (minion: Minion, index: number, dt: number) => boolean;

const ATTACKERS = 8;
const DEG = Math.PI / 180;
const at = vec3();

export class MinionSwarm {
  readonly minions: Minion[];
  timer: number;
  nextId = 0;
  /** 出した数・寿命で消えた数・攻撃した人ごとの撃墜数 */
  spawned = 0;
  expired = 0;
  readonly killsBy: number[] = Array.from({ length: ATTACKERS }, () => 0);
  /** 10-3b: 同時に飛べる数（プールの大きさ spec.cap 以下。協力の人数で変える） */
  limit: number;

  constructor(
    readonly spec: MinionSpec,
    readonly nests: readonly NestSpec[],
  ) {
    this.timer = spec.firstDelay;
    this.limit = spec.cap;
    this.minions = Array.from({ length: spec.cap }, () => ({
      active: false,
      id: 0,
      nest: 0,
      position: vec3(),
      velocity: vec3(),
      hp: 0,
      age: 0,
      spin: 1,
    }));
  }

  get activeCount(): number {
    let n = 0;
    for (const m of this.minions) if (m.active) n++;
    return n;
  }

  get kills(): number {
    return this.killsBy.reduce((s, v) => s + v, 0);
  }

  /** 1 ステップ: 出す・動かす・寿命。nestBroken は巣の部位が壊れたか、spawning は今出してよいか（攻撃の間など） */
  step(
    dt: number,
    body: BodyFrame,
    nestBroken: (part: number) => boolean,
    target: MinionTarget,
    rnd: () => number,
    spawning = true,
    override?: MinionOverride,
  ): void {
    if (spawning) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer += this.spec.interval;
        this.spawnWave(body, nestBroken, rnd);
      }
    }
    for (let i = 0; i < this.minions.length; i++) {
      const m = this.minions[i];
      if (m?.active) this.fly(m, i, dt, body, target, override);
    }
  }

  private spawnWave(
    body: BodyFrame,
    nestBroken: (part: number) => boolean,
    rnd: () => number,
  ): void {
    for (let n = 0; n < this.nests.length; n++) {
      const nest = this.nests[n];
      if (!nest || (nest.part >= 0 && nestBroken(nest.part))) continue;
      for (let k = 0; k < this.spec.perNest; k++) {
        if (this.activeCount >= this.limit) return;
        const m = this.minions.find((x) => !x.active);
        if (!m) return;
        bodyPoint(m.position, body, nest.offset);
        // 下へ、少し横に散る
        const a = rnd() * Math.PI * 2;
        const side = 0.35 + rnd() * 0.3;
        m.velocity.x = Math.cos(a) * side * this.spec.speed;
        m.velocity.y = -this.spec.speed * 0.8;
        m.velocity.z = Math.sin(a) * side * this.spec.speed;
        m.active = true;
        m.id = this.nextId;
        this.nextId = (this.nextId + 1) & 0xffff;
        m.nest = n;
        m.hp = this.spec.hp;
        m.age = 0;
        m.spin = rnd() < 0.5 ? -1 : 1;
        this.spawned++;
      }
    }
  }

  private fly(
    m: Minion,
    index: number,
    dt: number,
    body: BodyFrame,
    target: MinionTarget,
    override: MinionOverride | undefined,
  ): void {
    const s = this.spec;
    m.age += dt;
    if (m.age >= s.life) {
      m.active = false;
      this.expired++;
      return;
    }
    if (m.age > s.dropSeconds && override?.(m, index, dt)) {
      // 差し替えた速度で進む
    } else if (m.age > s.dropSeconds) {
      const t = target(m);
      const center = t ?? body.position;
      const radius = t ? s.orbit : s.homeOrbit;
      // 回る点: 中心の周りの、今の位置から接線の向きへ少し進んだ所（近づくと周りを回る）
      const dx = m.position.x - center.x;
      const dz = m.position.z - center.z;
      const d = Math.hypot(dx, dz) || 1;
      const tx = (-dz / d) * m.spin;
      const tz = (dx / d) * m.spin;
      const pull = Math.min(1, d / (radius * 2));
      at.x = center.x + (dx / d) * radius + tx * radius * (1 - pull) - m.position.x;
      at.y = center.y - m.position.y;
      at.z = center.z + (dz / d) * radius + tz * radius * (1 - pull) - m.position.z;
      steer(m.velocity, at, s.speed, s.turnDeg * DEG * dt);
    }
    m.position.x += m.velocity.x * dt;
    m.position.y += m.velocity.y * dt;
    m.position.z += m.velocity.z * dt;
  }

  /** 子分に当てる。落ちたら true（攻撃した人の撃墜に数える） */
  hit(index: number, amount: number, attacker: number): boolean {
    const m = this.minions[index];
    if (!m?.active || amount <= 0) return false;
    m.hp -= amount;
    if (m.hp > 0) return false;
    m.active = false;
    const who = Math.min(ATTACKERS - 1, Math.max(0, Math.floor(attacker)));
    this.killsBy[who] = (this.killsBy[who] ?? 0) + 1;
    return true;
  }

  /** 全部消す（怪獣を倒したとき。撃墜には数えない） */
  clear(): void {
    for (const m of this.minions) m.active = false;
  }
}

/** 速度 v（大きさ speed）を、向き want へ最大 maxTurn ラジアンだけ曲げる */
export function steer(v: Vec3, want: Readonly<Vec3>, speed: number, maxTurn: number): void {
  const vl = Math.hypot(v.x, v.y, v.z) || 1;
  const wl = Math.hypot(want.x, want.y, want.z);
  if (wl === 0) return;
  const cx = v.x / vl;
  const cy = v.y / vl;
  const cz = v.z / vl;
  const wx = want.x / wl;
  const wy = want.y / wl;
  const wz = want.z / wl;
  const dot = Math.max(-1, Math.min(1, cx * wx + cy * wy + cz * wz));
  const angle = Math.acos(dot);
  const t = angle <= maxTurn || angle === 0 ? 1 : maxTurn / angle;
  let nx = cx + (wx - cx) * t;
  let ny = cy + (wy - cy) * t;
  let nz = cz + (wz - cz) * t;
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  v.x = nx * speed;
  v.y = ny * speed;
  v.z = nz * speed;
}
