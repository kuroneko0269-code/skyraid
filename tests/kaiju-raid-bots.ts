// レイドの所要時間を測るボット（6-1 / 6-2）。怪獣は本番の Kaiju + KaijuAi（地形も本番）、機体は運動学の簡易モデル
// （230 m/s・旋回 30°/秒・上昇下降 60 m/s まで）。武装は Kestrel Lv0 の数値（機銃 15 発/秒・熱・ダメージ、ミサイル 4 発）。
// 「平均的な命中率」: 機銃は射程内で機首が 5° 以内のとき撃ち、1 発 30% で狙った部位に当たる。ミサイルはロック（1.2 秒）
// してから 75% で当たる（狙った部位に中心のダメージ）。ロケット・爆弾は使わない（控えめに見積もる）。
// 機体は狙う部位を走るたびに選び（脚を少し多め）、近づいて撃ち、350m で離脱して 1.2〜1.8km 先から入り直す。
// 予兆を見て避ける: 熱線が自分に向いたら横へ、咆哮の範囲なら半分の確率でフレア（なければ上昇）、薙ぎ払いは離れる
import { KaijuAi, type KaijuTarget } from '../src/ai/kaiju-ai';
import { GunHeat } from '../src/combat/heat';
import { createRandom } from '../src/core/random';
import { findAircraftModel } from '../src/data/aircraft';
import { GUN_CONFIG, MISSILE_CONFIG, TARGETING_CONFIG } from '../src/data/weapons';
import { RAID_CONFIG, KAIJU_PARTS, type KaijuPartId } from '../src/data/kaiju';
import { Kaiju } from '../src/entities/kaiju';
import { resolveLoadout } from '../src/progression/loadout';
import { getGroundHeight } from '../src/render/terrain-height';

const DT = 1 / 60;
const DEG = Math.PI / 180;

export interface RaidBotOptions {
  readonly players: number;
  readonly seed: number;
  /** 機銃の命中率（平均的 0.3） */
  readonly hitRate?: number;
  /** 打ち切り（秒） */
  readonly maxSeconds?: number;
}

export interface RaidBotResult {
  readonly seconds: number;
  readonly killed: boolean;
  readonly cityReached: boolean;
  readonly downs: number;
  readonly breaks: number;
  readonly partsBroken: number;
  readonly playerDowns: number;
  /** 最終フェーズに入った時刻（入らなければ null） */
  readonly finalAt: number | null;
  readonly attacks: Readonly<Record<string, number>>;
}

class Bot implements KaijuTarget {
  readonly position = { x: 0, y: 0, z: 0 };
  heading = 0;
  speed = 230;
  hp: number;
  active = true;
  respawn = 0;
  flareAge = Infinity;
  flares: number;
  missiles: number;
  stun = 0;
  readonly hitRadius = 6;
  mode: 'in' | 'out' = 'in';
  part: KaijuPartId = 'crystal';
  readonly way = { x: 0, y: 500, z: 0 };
  outTimer = 0;
  lock = 0;
  missileCooldown = 0;
  dodge = 0;
  dodgeSide = 1;
  readonly heat = new GunHeat(GUN_CONFIG.heat);
  shotTimer = 0;
  reacted = false;

  constructor(
    readonly id: number,
    readonly maxHp: number,
    readonly maxMissiles: number,
    readonly maxFlares: number,
  ) {
    this.hp = maxHp;
    this.missiles = maxMissiles;
    this.flares = maxFlares;
  }

  spawn(i: number): void {
    const s = RAID_CONFIG.start;
    this.position.x = s.x + (i - 1.5) * 150;
    this.position.y = s.y;
    this.position.z = s.z;
    this.heading = s.headingDeg * DEG;
    this.hp = this.maxHp;
    this.missiles = this.maxMissiles;
    this.flares = this.maxFlares;
    this.active = true;
    this.mode = 'in';
    this.stun = 0;
  }
}

export function runRaidBots(o: RaidBotOptions): RaidBotResult {
  const rng = createRandom(o.seed);
  const hitRate = o.hitRate ?? 0.3;
  const model = findAircraftModel('kestrel');
  if (!model) throw new Error('kestrel');
  const load = resolveLoadout(model, { engine: 0, airframe: 0, weapons: 0, avionics: 0 });
  const floor = (x: number, z: number): number => Math.max(0, getGroundHeight(x, z));
  const kaiju = new Kaiju(getGroundHeight);
  const bots: Bot[] = [];
  let playerDowns = 0;
  const ai = new KaijuAi(kaiju, {
    damage: (id, amount) => {
      const b = bots[id];
      if (!b?.active) return;
      b.hp -= amount;
      if (b.hp <= 0) {
        b.active = false;
        b.respawn = 3;
        playerDowns++;
      }
    },
    stun: (id, s) => {
      const b = bots[id];
      if (b) b.stun = Math.max(b.stun, s);
    },
  });
  for (let i = 0; i < o.players; i++) {
    const b = new Bot(i, load.flight.hull.maxHp, load.missiles, load.flares);
    b.spawn(i);
    bots.push(b);
  }
  const f = RAID_CONFIG.kaijuFrom;
  kaiju.emerge(f.x, f.z, RAID_CONFIG.cityCenter.x, RAID_CONFIG.cityCenter.z, {
    players: o.players,
  });
  ai.configure({ goal: RAID_CONFIG.cityCenter });
  let downs = 0;
  let breaks = 0;
  let partsBroken = 0;
  const attacks: Record<string, number> = {};
  let finalAt: number | null = null;
  let t = 0;
  kaiju.onEvent((e) => {
    if (e.kind === 'phase' && e.phase === 3) finalAt = t;
    if (e.kind === 'down') downs++;
    if (e.kind === 'break') breaks++;
    if (e.kind === 'partBroken') partsBroken++;
  });
  ai.onEvent((e) => {
    if (e.kind === 'windup') attacks[e.attack] = (attacks[e.attack] ?? 0) + 1;
  });
  const max = o.maxSeconds ?? 900;
  while (t < max && !kaiju.isDestroyed && !kaiju.cityReached) {
    for (const b of bots) stepBot(b, kaiju, ai, rng, hitRate, floor);
    ai.step(bots, DT);
    t += DT;
  }
  return {
    seconds: t,
    killed: kaiju.isDestroyed,
    cityReached: kaiju.cityReached,
    downs,
    breaks,
    partsBroken,
    playerDowns,
    finalAt,
    attacks,
  };
}

function pickPart(rng: () => number, kaiju: Kaiju): KaijuPartId {
  // 脚を少し多め（ダウンを狙う）。壊れた部位も撃つ（全体 HP は減る）が、壊れていない部位を優先
  const weights: Record<KaijuPartId, number> = {
    head: 1,
    crystal: 1.2,
    leftLeg: 1.3,
    rightLeg: 1.3,
    tail: 0.8,
  };
  let sum = 0;
  for (const id of KAIJU_PARTS) sum += weights[id] * (kaiju.part(id).broken ? 0.4 : 1);
  let r = rng() * sum;
  for (const id of KAIJU_PARTS) {
    r -= weights[id] * (kaiju.part(id).broken ? 0.4 : 1);
    if (r <= 0) return id;
  }
  return 'crystal';
}

function stepBot(
  b: Bot,
  kaiju: Kaiju,
  ai: KaijuAi,
  rng: () => number,
  hitRate: number,
  floor: (x: number, z: number) => number,
): void {
  b.flareAge += DT;
  b.heat.step(DT);
  if (!b.active) {
    b.respawn -= DT;
    if (b.respawn <= 0) b.spawn(b.id);
    return;
  }
  const p = b.position;
  const part = kaiju.part(b.part);
  const k = kaiju.feet;
  // 予兆への反応
  const atk = kaiju.attack;
  // 熱線・投擲が自分に向いたら、怪獣への視線と直角の向きへ逃げる（反応は 0.3〜0.8 秒遅れる）
  if (atk && kaiju.attackStep === 'windup' && ai.targetId === b.id && b.dodge <= 0) {
    if ((atk === 'beam' || atk === 'throw') && kaiju.attackTime > 0.3 + b.id * 0.15) {
      b.dodge = atk === 'beam' ? kaiju.attackDuration - kaiju.attackTime + 3.2 : 2.5;
      b.dodgeSide = rng() < 0.5 ? -1 : 1;
    }
  }
  // 咆哮: 予兆の終わり 0.5 秒で、範囲にいれば半分の確率でフレア（1 回の咆哮に 1 度だけ考える）
  if (atk !== 'roar') b.reacted = false;
  else if (
    !b.reacted &&
    kaiju.attackStep === 'windup' &&
    kaiju.attackDuration - kaiju.attackTime < 0.5
  ) {
    b.reacted = true;
    const d = Math.hypot(p.x - k.x, p.z - k.z);
    if (d < 900 && p.y < 650 && b.flares > 0 && rng() < 0.5) {
      b.flares--;
      b.flareAge = 0;
    }
  }
  if (atk === 'sweep' && kaiju.attackStep === 'windup') {
    const d = Math.hypot(p.x - k.x, p.z - k.z);
    if (d < 400 && b.mode === 'in') beginOut(b, kaiju, rng);
  }
  // 行き先
  let tx: number;
  let ty: number;
  let tz: number;
  if (b.mode === 'in') {
    tx = part.position.x;
    ty = part.position.y + 60;
    tz = part.position.z;
  } else {
    tx = b.way.x;
    ty = b.way.y;
    tz = b.way.z;
  }
  const dx = tx - p.x;
  const dz = tz - p.z;
  let want = Math.atan2(dx, -dz);
  if (b.dodge > 0) {
    b.dodge -= DT;
    want = Math.atan2(k.x - p.x, -(k.z - p.z)) + b.dodgeSide * 90 * DEG;
  }
  if (b.stun > 0) b.stun -= DT;
  else {
    let diff = want - b.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const turn = (b.dodge > 0 ? 45 : 30) * DEG * DT;
    b.heading += Math.max(-turn, Math.min(turn, diff));
  }
  const minY = floor(p.x, p.z) + 120;
  const climb = Math.max(-60, Math.min(60, (Math.max(ty, minY) - p.y) * 0.8));
  p.x += Math.sin(b.heading) * b.speed * DT;
  p.z += -Math.cos(b.heading) * b.speed * DT;
  p.y += climb * DT;
  // 撃つ
  const ex = part.position.x - p.x;
  const ey = part.position.y - p.y;
  const ez = part.position.z - p.z;
  const dist = Math.hypot(ex, ey, ez);
  const fx = Math.sin(b.heading);
  const fz = -Math.cos(b.heading);
  const hd = Math.hypot(ex, ez) || 1;
  const cosH = (ex * fx + ez * fz) / hd;
  if (b.mode === 'in' && b.stun <= 0 && b.dodge <= 0 && kaiju.targetable) {
    const nose = cosH > Math.cos(6 * DEG);
    if (nose && dist < GUN_CONFIG.range * 0.75 && dist > 200 && b.heat.canFire) {
      b.shotTimer -= DT;
      while (b.shotTimer <= 0) {
        b.shotTimer += 1 / GUN_CONFIG.fireRate;
        b.heat.addShot();
        if (rng() < hitRate) part.damageBy(GUN_CONFIG.damage, b.id);
      }
    }
    const inLock =
      cosH > Math.cos(TARGETING_CONFIG.lockConeDeg * DEG) && dist < TARGETING_CONFIG.lockRange;
    b.lock = inLock ? b.lock + DT : 0;
    b.missileCooldown -= DT;
    if (
      b.lock >= TARGETING_CONFIG.lockSeconds &&
      b.missiles > 0 &&
      b.missileCooldown <= 0 &&
      dist > 500
    ) {
      b.missiles--;
      b.missileCooldown = 2;
      if (rng() < 0.75) part.damageBy(MISSILE_CONFIG.maxDamage, b.id);
    }
    if (Math.hypot(part.position.x - p.x, part.position.z - p.z) < 350) beginOut(b, kaiju, rng);
  } else if (b.mode === 'out') {
    b.outTimer -= DT;
    if (b.outTimer <= 0 || Math.hypot(b.way.x - p.x, b.way.z - p.z) < 300) {
      b.mode = 'in';
      b.part = pickPart(rng, kaiju);
    }
  }
}

function beginOut(b: Bot, kaiju: Kaiju, rng: () => number): void {
  b.mode = 'out';
  const a = rng() * Math.PI * 2;
  const r = 1200 + rng() * 600;
  b.way.x = kaiju.feet.x + Math.sin(a) * r;
  b.way.z = kaiju.feet.z - Math.cos(a) * r;
  b.way.y = 250 + rng() * 450;
  b.outTimer = 12;
}
