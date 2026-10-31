// ミッションの出現物のうち、敵機・的・ドローン以外（2-5）: 輸送機（護衛対象）・怪獣（6-1 / 6-2。本体と AI）・地上目標（2-6）と対空砲の射撃。
// FlightSession が持ち、出現（spawn）・固定ステップ・ミッションの開始時の片付けをここにまとめる（Three.js 非依存）
import { AntiAirFire, type AaaHit, type AaaTarget } from '../combat/aaa';
import type { GroundHeightFn, Rng } from '../combat/gun';
import type { CombatTarget } from '../combat/target';
import { GROUND_TARGET_CONFIG } from '../data/ground-targets';
import { TRANSPORT_CONFIG } from '../data/mission-props';
import { GroundTarget } from '../entities/ground-target';
import { KaijuAi, type KaijuHitHandler, type KaijuTarget } from '../ai/kaiju-ai';
import { Kaiju } from '../entities/kaiju';
import { Transport } from '../entities/transport';
import type { GroundTargetSpawn, KaijuSpawn, TransportSpawn } from './types';
import { EnemyBombs } from '../combat/enemy-bombs';
import { BOMBER_CONFIG, CRUISE_CONFIG, FACILITY_KINDS } from '../data/defense';
import { Bomber } from '../entities/bomber';
import { CruiseMissile } from '../entities/cruise-missile';

/** 護衛対象の今の様子（MissionWorld.escort） */
export interface EscortState {
  readonly position: Readonly<{ x: number; y: number; z: number }>;
  /** 経路の進み具合（0〜1） */
  readonly progress: number;
  readonly active: boolean;
}

export class MissionProps {
  readonly transports: Transport[];
  readonly kaiju: Kaiju;
  /** 怪獣の行動（6-2）。当たりは onKaijuHit */
  readonly kaijuAi: KaijuAi;
  /** 怪獣の攻撃が当たったとき（FlightSession がダメージ・スタンを与える） */
  onKaijuHit: KaijuHitHandler = { damage: () => undefined, stun: () => undefined };
  /** 遊ぶ人数（怪獣の HP の人数スケール。シングルプレイは 1） */
  players = 1;
  readonly groundTargets: GroundTarget[];
  /** 対空砲の射撃（弾・警告）。当たったら onAaaHit */
  readonly aaa: AntiAirFire;
  /** 対空砲の弾が自機に当たったとき（FlightSession がダメージを与える） */
  onAaaHit: (hit: Readonly<AaaHit>) => void = () => undefined;
  /** プレイヤーの敵側で、撃てる・ロックできるもの（怪獣の部位・地上目標・爆撃機・巡航ミサイル）。CombatSystem.allTargets に入れる */
  readonly hostileTargets: readonly CombatTarget[];
  /** 防衛戦（7-2）の基地の施設（FACILITY_KINDS の順。陣営は味方なので hostileTargets に入れない） */
  readonly baseTargets: GroundTarget[];
  /** 防衛戦の爆撃機・巡航ミサイル・爆撃機の爆弾 */
  readonly bombers: Bomber[];
  readonly cruiseMissiles: CruiseMissile[];
  readonly enemyBombs: EnemyBombs;
  /** 爆撃機の爆弾が着いたとき（防衛戦のランナーがダメージを入れる。協力のクライアントは見た目だけ） */
  onEnemyBomb: (x: number, y: number, z: number) => void = () => undefined;
  /** 味方の対空砲（7-2。基地の対空砲が敵を撃つ）。当たったら onFriendlyAaaHit */
  readonly friendlyAaa: AntiAirFire;
  onFriendlyAaaHit: (hit: Readonly<AaaHit>, target: AaaTarget) => void = () => undefined;
  /** 壊れた地上目標と基地（描画は 1 つにまとめる） */
  readonly allGroundTargets: readonly GroundTarget[];

  constructor(groundHeight: GroundHeightFn = () => 0, rng: Rng = Math.random) {
    this.transports = Array.from({ length: TRANSPORT_CONFIG.maxCount }, () => new Transport());
    this.kaiju = new Kaiju(groundHeight);
    this.kaijuAi = new KaijuAi(this.kaiju, {
      damage: (id, amount, attack) => {
        this.onKaijuHit.damage(id, amount, attack);
      },
      stun: (id, seconds) => {
        this.onKaijuHit.stun(id, seconds);
      },
    });
    this.groundTargets = Array.from(
      { length: GROUND_TARGET_CONFIG.maxCount },
      () => new GroundTarget(groundHeight),
    );
    this.aaa = new AntiAirFire(
      (hit) => {
        this.onAaaHit(hit);
      },
      groundHeight,
      rng,
    );
    this.baseTargets = FACILITY_KINDS.map(() => new GroundTarget(groundHeight));
    this.bombers = Array.from({ length: BOMBER_CONFIG.maxCount }, () => new Bomber());
    this.cruiseMissiles = Array.from({ length: CRUISE_CONFIG.maxCount }, () => new CruiseMissile());
    this.enemyBombs = new EnemyBombs(groundHeight, (x, y, z) => {
      this.onEnemyBomb(x, y, z);
    });
    this.friendlyAaa = new AntiAirFire(
      (hit, target) => {
        this.onFriendlyAaaHit(hit, target);
      },
      groundHeight,
      rng,
    );
    this.hostileTargets = [
      ...this.kaiju.parts,
      ...this.groundTargets,
      ...this.bombers,
      ...this.cruiseMissiles,
    ];
    this.allGroundTargets = [...this.groundTargets, ...this.baseTargets];
  }

  /** 全部引っ込める（フリーフライト・ミッションの開始） */
  reset(): void {
    for (const t of this.transports) t.withdraw();
    this.kaiju.withdraw();
    this.kaijuAi.reset();
    for (const g of this.groundTargets) g.withdraw();
    this.aaa.reset();
    for (const g of this.baseTargets) g.withdraw();
    for (const b of this.bombers) b.withdraw();
    for (const c of this.cruiseMissiles) c.withdraw();
    this.enemyBombs.reset();
    this.friendlyAaa.reset();
  }

  /** player は対空砲が狙う自機（撃墜されている間は active が false）、kaijuTargets は怪獣が狙う機体 */
  step(
    dt: number,
    player: AaaTarget | null = null,
    kaijuTargets: readonly KaijuTarget[] = [],
  ): void {
    for (const t of this.transports) t.step(dt);
    this.kaijuAi.step(kaijuTargets, dt);
    for (const g of this.groundTargets) g.step(dt);
    for (const g of this.baseTargets) g.step(dt);
    this.aaa.step(this.groundTargets, player, dt);
  }

  spawnTransport(def: TransportSpawn): void {
    const t = this.transports.find((x) => !x.deployed);
    t?.deploy(def.group, def.from, def.to);
  }

  spawnKaiju(def: KaijuSpawn): void {
    const { position: p, walkTo: w } = def;
    this.kaiju.emerge(p.x, p.z, w.x, w.z, {
      players: this.players,
      retreatRatio: def.retreatDamageRatio,
      finalTimer: def.finalTimer ?? def.retreatDamageRatio >= 1,
      hard: def.hard ?? false,
    });
    this.kaijuAi.configure({
      goal: w,
      stopRadius: def.stopRadius,
      attacks: def.attacks,
      arrivalFails: def.arrivalFails,
    });
  }

  spawnGroundTargets(def: GroundTargetSpawn): void {
    for (const p of def.positions) {
      const g = this.groundTargets.find((x) => !x.deployed);
      if (!g) break;
      g.deploy(def.group, def.targetType, p.x, p.z, def.difficulty);
    }
  }

  /** 出ている輸送機のどれかが撃墜されたか */
  get escortLost(): boolean {
    return this.transports.some((t) => t.deployed && t.isDestroyed);
  }

  /** group の輸送機（出ていなければ null） */
  escort(group: string): EscortState | null {
    return this.transports.find((t) => t.deployed && t.group === group) ?? null;
  }

  /** 怪獣に与えたダメージの割合（出ていなければ 0） */
  get kaijuDamageRatio(): number {
    return this.kaiju.stage === 'hidden' ? 0 : this.kaiju.damageRatio;
  }

  /** 怪獣が最終フェーズの時間切れで街に着いたか */
  get kaijuReachedCity(): boolean {
    return this.kaiju.visible && this.kaiju.cityReached;
  }

  /** 地上目標なら、そのグループ（撃墜数の数え上げ用）。地上目標でなければ undefined */
  groundTargetGroup(target: CombatTarget): string | undefined {
    return target instanceof GroundTarget ? target.group : undefined;
  }
}
