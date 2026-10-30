// フリーフライトの戦闘まわりの描画をまとめる（的・弾・ミサイル・ドローン・敵機・ミッションの出現物（2-5））。main.ts は update / reset を呼ぶだけ
import type { Object3D, Scene } from 'three';
import type { Vec3 } from '../flight/math';
import type { FlightSession } from '../missions/flight-session';
import { CombatView } from './combat-view';
import { DroneView } from './drone-view';
import { EnemyView } from './enemy-view';
import { MissileView } from './missile-view';
import { MissionPropsView } from './mission-props-view';

export class FlightViews {
  private readonly combat: CombatView;
  private readonly missiles: MissileView;
  private readonly drones: DroneView;
  private readonly enemies: EnemyView;
  private readonly props: MissionPropsView;

  constructor(scene: Scene, aircraftMesh: Object3D, ff: FlightSession) {
    this.combat = new CombatView(scene, aircraftMesh, ff.combat);
    this.missiles = new MissileView(scene, ff.combat);
    this.drones = new DroneView(scene, ff.combat.drones);
    this.enemies = new EnemyView(scene, ff.enemies, ff.squadron.bulletPools);
    this.props = new MissionPropsView(scene, ff.props);
  }

  /** 描画フレームごとに呼ぶ。frameSeconds は演出を進める時間（飛行中以外は 0） */
  update(alpha: number, frameSeconds: number, camera: Readonly<Vec3>): void {
    this.combat.update(alpha, frameSeconds, camera);
    this.missiles.update(alpha, frameSeconds, camera);
    this.drones.update(alpha);
    this.enemies.update(alpha, camera);
    this.props.update(alpha);
  }

  /** 演出を全部消す（フリーフライトのやり直し） */
  reset(): void {
    this.combat.reset();
    this.missiles.reset();
  }
}
