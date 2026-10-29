// フリーフライトの射撃（2-1）: 機銃・的・撃墜数・ヒットマーカーを固定ステップで進める（Three.js 非依存）
import { HUD_CONFIG } from '../data/hud';
import { GUN_CONFIG, type GunSpec } from '../data/weapons';
import { TargetField, type TargetBalloon } from '../entities/target-balloon';
import { Gun, type GroundHeightFn, type GunHit, type Rng, type Shooter } from './gun';

export type ImpactListener = (x: number, y: number, z: number, onTarget: boolean) => void;
export type DestroyedListener = (target: TargetBalloon) => void;

export class CombatSystem {
  readonly gun: Gun<TargetBalloon>;
  /** 撃墜数 */
  kills = 0;
  /** ヒットマーカーの残り表示時間（秒） */
  hitMarkerTimer = 0;
  private readonly impactListeners: ImpactListener[] = [];
  private readonly destroyedListeners: DestroyedListener[] = [];

  constructor(
    readonly targets: TargetField,
    groundHeight: GroundHeightFn | null = null,
    rng: Rng = Math.random,
    spec: GunSpec = GUN_CONFIG,
    private readonly hitMarkerSeconds: number = HUD_CONFIG.hitMarkerSeconds,
  ) {
    this.gun = new Gun<TargetBalloon>(spec, this.handleHit, groundHeight, rng);
  }

  /** 命中（的・地面）ごとに呼ばれる。火花の演出用 */
  onImpact(fn: ImpactListener): void {
    this.impactListeners.push(fn);
  }

  /** 的が撃墜されたときに呼ばれる。破片の演出用 */
  onDestroyed(fn: DestroyedListener): void {
    this.destroyedListeners.push(fn);
  }

  step(trigger: boolean, shooter: Shooter, dt: number): void {
    this.hitMarkerTimer = Math.max(0, this.hitMarkerTimer - dt);
    this.targets.step(dt);
    this.gun.step(trigger, shooter, this.targets.balloons, dt);
  }

  reset(): void {
    this.kills = 0;
    this.hitMarkerTimer = 0;
    this.gun.reset();
    this.targets.reset();
  }

  private readonly handleHit = (hit: Readonly<GunHit<TargetBalloon>>): void => {
    const target = hit.target;
    for (const fn of this.impactListeners) fn(hit.x, hit.y, hit.z, target !== null);
    if (!target) return;
    this.hitMarkerTimer = this.hitMarkerSeconds;
    if (target.applyDamage(this.gun.spec.damage)) {
      this.kills++;
      for (const fn of this.destroyedListeners) fn(target);
    }
  };
}
