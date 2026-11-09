// 9-6a: 確かめる場（?dev=kaiju2）の判定の側（Three.js・DOM 非依存）: フリーフライトに空の怪獣ネフィルガだけを出す。
// GamePlay の差し込み口（free-extra.ts）に付け、飛行の始めのシードから怪獣の種を作るので、リプレイでも同じに動く。
// 9-6b: ソロのレイド（ミッション raidNephirga）も引き受ける（体力・部位・段階・制限時間は kaiju2-raid.ts）。
// 部位は CombatSystem の撃てる対象の末尾に足すので、機銃・ミサイル・ロケット・爆弾で減らせる（フリーフライトでは倒れない）
import { Kaiju2Hull } from '../ai/kaiju-hull/kaiju2-hull';
import { RamGrace, ramDamage } from '../combat/kaiju-ram';
import { TEAM_ENEMY } from '../combat/target';
import { KAIJU2_CONFIG, KAIJU2_DEV_CONFIG, KAIJU2_PARTS, type Kaiju2Part } from '../data/kaiju2';
import { KAIJU2_RAID_CONFIG } from '../data/kaiju2-raid';
import type { MapDef } from '../data/maps';
import type { Kaiju2Ai, Kaiju2Target } from '../ai/kaiju2-ai';
import type { SkyKaiju } from '../entities/kaiju2/sky-kaiju';
import { LOCAL_FORWARD } from '../flight/flight-model';
import { rotateVec3, vec3, type Vec3 } from '../flight/math';
import { attachFreeExtra, type FreeExtra } from './free-extra';
import type { GamePlay } from './game-play';
import { NEPHIRGA_ID } from './kaiju2-mission';
import { Kaiju2Raid } from './kaiju2-raid';
import type { MissionDef } from './types';
import type { MissionWorld } from './world';

/** URL で決める始めの状態（?k2hp=<0〜100>・?k2break=wingL,tail）。再生でも同じ URL なら同じになる */
export interface Kaiju2DevOptions {
  readonly hpPercent: number;
  readonly broken: readonly Kaiju2Part[];
}

export function parseKaiju2Options(search: string): Kaiju2DevOptions {
  const params = new URLSearchParams(search);
  const hp = Number(params.get('k2hp') ?? '100');
  const broken = (params.get('k2break') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Kaiju2Part => (KAIJU2_PARTS as readonly string[]).includes(s));
  return {
    hpPercent: Number.isFinite(hp) ? Math.max(1, Math.min(100, hp)) : 100,
    broken: [...new Set(broken)],
  };
}

/** 今のマップ（戦域の中心）と、怪獣が避ける高さ（地表と建物の屋根） */
export interface Kaiju2DevEnv {
  readonly ground: (x: number, z: number) => number;
  readonly map: () => Pick<MapDef, 'center'>;
  /** 9-6c: フリーフライトにも出す（?dev=kaiju2 の確かめる場だけ。省略は true） */
  readonly freeFlight?: boolean;
}

/** 動かしている場面: 止めている / フリーフライト（確かめる場）/ ソロのレイド */
export type Kaiju2Mode = 'off' | 'free' | 'raid';

export class Kaiju2Dev implements FreeExtra {
  readonly raid: Kaiju2Raid;
  private readonly target: Kaiju2Target & { position: { x: number; y: number; z: number } };
  private seed = 1;
  mode: Kaiju2Mode = 'off';
  /** 飛行の途中から出した（読み込みが遅れた。リプレイの記録と合わない） */
  lateStart = false;
  /** 自機の速度（前のステップの位置との差から） */
  private readonly velocity = vec3();
  /** 10-6: 体への衝突（ほかの怪獣と同じ共通の扱い: 最大 HP の約 8 割・跳ねない・続けて当たらない間。キャンペーンの M8 は通り抜ける） */
  readonly hull = new Kaiju2Hull();
  readonly ram = new RamGrace();
  /** ぶつかった回数（値の表示・ボット） */
  ramHits = 0;
  private readonly nose = vec3();
  /** 走査の根（怪獣の本体・体力・部位。AI の hooks は関数なので値は入らない） */
  get stateRoot(): object {
    return this.raid;
  }

  /** 9-6c: 動かしているか（止めている間は状態の走査に入れない: 読み込んだ後のほかのモードのリプレイが今までと同じ） */
  get active(): boolean {
    return this.mode !== 'off';
  }

  constructor(
    private readonly play: GamePlay,
    private readonly options: Kaiju2DevOptions,
    private readonly env: Kaiju2DevEnv,
  ) {
    const session = play.session;
    this.raid = new Kaiju2Raid(env.ground, {
      hit: (_a, damage, stun) => {
        if (!session.player.active) return;
        session.combat.dealDamage(session.player, damage, TEAM_ENEMY);
        if (stun > 0) session.kaijuExposure.applyStun(stun);
      },
    });
    const a = session.aircraft;
    const velocity = this.velocity;
    const nose = this.nose;
    this.target = {
      position: a.state.position,
      velocity,
      get active() {
        return session.player.active;
      },
      // 9-6d: 機首の向き（狙われたら避ける）
      get forward() {
        return rotateVec3(nose, a.state.orientation, LOCAL_FORWARD);
      },
    };
  }

  get body(): SkyKaiju {
    return this.raid.body;
  }

  get ai(): Kaiju2Ai {
    return this.raid.ai;
  }

  /** フリーフライトで出ている */
  get freeFlying(): boolean {
    return this.mode === 'free' && this.play.runner === null;
  }

  /** レイドで出ている（終わった後の結果の画面まで） */
  get raiding(): boolean {
    return this.mode === 'raid';
  }

  /** 自機の位置（値の表示） */
  get playerPosition(): Readonly<Vec3> {
    return this.target.position;
  }

  stop(): void {
    this.mode = 'off';
    // 部位は撃てる対象に残るので、止めている間は撃てない・見えない
    this.body.visible = false;
  }

  reseed(seed: number): void {
    this.seed = (seed ^ KAIJU2_DEV_CONFIG.seedSalt) >>> 0;
  }

  /** フリーフライトの始め: 開始位置の前方に出す（戦域はそのマップ）。体力・壊れた部位は URL から */
  start(): void {
    // 9-6c: 一般のフリーフライトには出さない（レイドのために読んだ後も）
    if (this.env.freeFlight === false) {
      this.stop();
      return;
    }
    this.mode = 'free';
    this.lateStart = false;
    this.raid.reset(false, 'normal');
    this.raid.setStart(this.options.hpPercent / 100, this.options.broken);
    this.spawnAhead(KAIJU2_DEV_CONFIG.spawnAhead, KAIJU2_DEV_CONFIG.spawnAltitude);
  }

  /** 9-6b: ネフィルガのレイドなら引き受ける（体力・難易度・出す位置）。ランナーが読む世界を返す */
  startMission(def: MissionDef): MissionWorld | null {
    // 9-7: キャンペーン版（M8）。高い所から降りてくる（登場の演出）・数値は KAIJU2_RAID_CONFIG.campaign
    if (def.skyKaiju === NEPHIRGA_ID) {
      const c = KAIJU2_RAID_CONFIG.campaign;
      this.mode = 'raid';
      this.lateStart = false;
      this.raid.reset(true, 'normal', 1, true);
      this.spawnAhead(c.spawnAhead, c.spawnAltitude);
      this.body.attackCooldown = c.firstAttackDelay;
      return raidWorld(this.play, this.raid);
    }
    const r = def.reward.raid;
    if (r?.kaiju !== NEPHIRGA_ID) return null;
    this.mode = 'raid';
    this.lateStart = false;
    this.raid.reset(true, r.difficulty);
    this.spawnAhead(KAIJU2_RAID_CONFIG.spawnAhead, KAIJU2_RAID_CONFIG.spawnAltitude);
    this.body.attackCooldown = KAIJU2_RAID_CONFIG.firstAttackDelay;
    return raidWorld(this.play, this.raid);
  }

  private spawnAhead(ahead: number, altitude: number): void {
    const s = this.play.session;
    this.ram.clear();
    this.ramHits = 0;
    s.combat.addTargets(this.raid.targets);
    const k = this.body;
    const map = this.env.map();
    k.center.x = map.center.x;
    k.center.z = map.center.z;
    const p = s.aircraft.state.position;
    // 自機の水平の向き（前方 −Z を回した向き）の先に、自機の方を向けて出す
    const q = s.aircraft.state.orientation;
    const fx = -2 * (q.x * q.z + q.w * q.y);
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const h = Math.hypot(fx, fz) || 1;
    let x = p.x + (fx / h) * ahead;
    let z = p.z + (fz / h) * ahead;
    const r = Math.hypot(x - map.center.x, z - map.center.z);
    const lim = KAIJU2_CONFIG.arena.soft;
    if (r > lim) {
      x = map.center.x + ((x - map.center.x) / r) * lim;
      z = map.center.z + ((z - map.center.z) / r) * lim;
    }
    const heading = Math.atan2(p.x - x, -(p.z - z));
    this.ai.spawn(x, altitude, z, heading, this.seed);
    this.raid.placeTargets();
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.velocity.z = 0;
  }

  /** 飛行の途中から出す（遅延チャンクの読み込みが飛行の始めに間に合わなかったとき） */
  startLate(): void {
    this.start();
    this.lateStart = true;
  }

  step(dt: number): void {
    if (this.mode === 'off') return;
    // 終わったレイドの後（結果の画面へ進むまで）も落ちる様子は続ける
    const a = this.play.session.aircraft;
    if (dt > 0) {
      this.velocity.x = (a.state.position.x - a.prevPosition.x) / dt;
      this.velocity.y = (a.state.position.y - a.prevPosition.y) / dt;
      this.velocity.z = (a.state.position.z - a.prevPosition.z) / dt;
    }
    this.raid.step(dt, this.target, this.play.session.combat.flares.flares);
    // 9-6d: 突風の押し流し（水平。弱まりながら）
    const k = this.body;
    if (k.pushLeft > 0 && this.play.session.player.active) {
      const g = KAIJU2_CONFIG.attacks.gust;
      const v = g.push * (k.pushLeft / g.pushSeconds) * dt;
      a.state.position.x += k.pushX * v;
      a.state.position.z += k.pushZ * v;
    }
    this.collide(dt);
  }

  /** 10-6: 体への衝突（このステップの自機の動きが体にめり込んだら）。倒した後・撃墜されている間・キャンペーン（M8）は無し */
  private collide(dt: number): void {
    this.ram.tick(dt);
    const s = this.play.session;
    const k = this.body;
    if (!s.player.active || this.raid.dead || !k.visible || this.raid.campaign) return;
    this.hull.pose(k.pose, k.broken);
    const a = s.aircraft;
    if (!this.hull.contact(k, a.prevPosition, a.state.position)) return;
    if (!this.ram.hit(0)) return;
    this.ramHits++;
    const p = a.state.position;
    s.combat.ramListeners.report(p.x, p.y, p.z);
    s.combat.dealDamage(s.player, ramDamage(s.player.maxHp), TEAM_ENEMY);
  }
}

/** ランナーが読む世界: 自機・戦域は飛行の世界のまま、怪獣の体力と「街に着いた」（嵐の制限時間）をネフィルガから */
function raidWorld(play: GamePlay, raid: Kaiju2Raid): MissionWorld {
  const s = play.session;
  return {
    get playerPosition() {
      return s.playerPosition;
    },
    get playerPrevPosition() {
      return s.playerPrevPosition;
    },
    get playerSpeed() {
      return s.playerSpeed;
    },
    get playerActive() {
      return s.playerActive;
    },
    get playerDowns() {
      return s.playerDowns;
    },
    get playerDamageTaken() {
      return s.playerDamageTaken;
    },
    get playerMaxHp() {
      return s.playerMaxHp;
    },
    spawn: (def) => {
      s.spawn(def);
    },
    destroyedCount: (kind, group) => s.destroyedCount(kind, group),
    get escortLost() {
      return s.escortLost;
    },
    escort: (group) => s.escort(group),
    get kaijuDamageRatio() {
      return raid.damageRatio;
    },
    get kaijuReachedCity() {
      return false;
    },
    get kaijuStormTimeUp() {
      return raid.timeUp === 'storm';
    },
    get kaijuTotalTimeUp() {
      return raid.timeUp === 'total';
    },
    // 空の怪獣は建物を壊さないので、守れた建物は出さない
    protectedBuildings: null,
  };
}

/** GamePlay に付ける（ネフィルガの遅延チャンクから） */
export function attachKaiju2Dev(
  play: GamePlay,
  options: Kaiju2DevOptions,
  env: Kaiju2DevEnv,
): Kaiju2Dev {
  const dev = new Kaiju2Dev(play, options, env);
  attachFreeExtra(play, dev);
  return dev;
}
