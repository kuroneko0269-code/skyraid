// フリーフライトの戦闘まわりの描画をまとめる（的・弾・ミサイル・ドローン・敵機・ミッションの出現物（2-5）・
// 地上目標とロケット・爆弾（2-6）・爆発や煙などのエフェクト（4-4））。main.ts は update / reset を呼ぶだけ
import type { Object3D, Scene } from 'three';
import type { Vec3 } from '../flight/math';
import type { AircraftDetail } from '../data/aircraft-model';
import type { KaijuBodyView, KaijuEffectsView } from '../entities/kaiju-display';
import type { FlightSession } from '../missions/flight-session';
import { CombatView } from './combat-view';
import { AAA_CONFIG } from '../data/ground-targets';
import { DroneView } from './drone-view';
import { FxLink } from './fx/fx-link';
import type { FxEvents } from './fx/fx-events';
import { EnemyView } from './enemy-view';
import { GroundTargetView } from './ground-target-view';
import { MissileView } from './missile-view';
import { MissionPropsView } from './mission-props-view';
import { OrdnanceView } from './ordnance-view';

export class FlightViews {
  private readonly combat: CombatView;
  private readonly missiles: MissileView;
  private readonly drones: DroneView;
  private readonly enemies: EnemyView;
  private readonly props: MissionPropsView;
  private readonly groundTargets: GroundTargetView;
  private readonly ordnance: OrdnanceView;
  private readonly fx: FxLink;
  /** フォトモード（7-A）の表示の切替: 敵・怪獣（敵機・ドローン・輸送機・怪獣・地上目標）とエフェクト（弾・ミサイル・爆発・煙） */
  readonly photoGroups: { readonly enemies: Object3D[]; readonly effects: Object3D[] } = {
    enemies: [],
    effects: [],
  };

  constructor(
    scene: Scene,
    aircraftMesh: Object3D,
    ff: FlightSession,
    private readonly events: FxEvents,
    /** カメラの位置（爆発の揺れを距離で減らす） */
    camera: Readonly<Vec3>,
    /** カメラを揺らす（被弾・近くの爆発。4-4） */
    shake: (strength: number) => void,
  ) {
    // 作るたびにシーンに足された物を、フォトモードの表示の切替の組に入れる
    const g = this.photoGroups;
    const added = <T>(group: Object3D[], make: () => T): T => {
      const before = scene.children.length;
      const v = make();
      group.push(...scene.children.slice(before));
      return v;
    };
    this.combat = added(g.effects, () => new CombatView(scene, aircraftMesh, ff.combat));
    this.missiles = added(g.effects, () => new MissileView(scene, ff.combat));
    this.drones = added(g.enemies, () => new DroneView(scene, ff.combat.drones));
    this.enemies = added(
      g.enemies,
      () =>
        new EnemyView(scene, ff.enemies, ff.squadron.bulletPools, [
          { pool: ff.props.aaa.shells, color: AAA_CONFIG.tracerColor },
        ]),
    );
    this.props = added(g.enemies, () => new MissionPropsView(scene, ff.props));
    this.groundTargets = added(
      g.enemies,
      () => new GroundTargetView(scene, ff.props.allGroundTargets),
    );
    this.ordnance = added(g.effects, () => new OrdnanceView(scene, ff.combat));
    this.fx = added(g.effects, () => new FxLink(scene, events, ff.enemies, camera, shake));
  }

  /** 描画フレームごとに呼ぶ。frameSeconds は演出を進める時間（飛行中以外は 0） */
  update(alpha: number, frameSeconds: number, camera: Readonly<Vec3>): void {
    this.combat.update(alpha, frameSeconds, camera);
    this.missiles.update(alpha, frameSeconds, camera);
    this.drones.update(alpha);
    this.enemies.update(alpha, camera);
    this.props.update(alpha);
    this.groundTargets.update(frameSeconds);
    this.ordnance.update(alpha);
    if (frameSeconds > 0) this.events.frame();
    this.fx.update(frameSeconds);
  }

  /** 敵機・輸送機のモデルの細かさ（画質。4-3） */
  setAircraftDetail(detail: AircraftDetail): void {
    this.enemies.setDetail(detail);
    this.props.setDetail(detail);
  }

  /** 怪獣の表示元を差し替える（協力のクライアント。6-2。null でミッションの怪獣） */
  setKaijuSource(body: KaijuBodyView | null, fx: KaijuEffectsView | null = null): void {
    this.props.setKaijuSource(body, fx);
  }

  /** 演出を全部消す（フリーフライトのやり直し） */
  reset(): void {
    this.combat.reset();
    this.missiles.reset();
    this.groundTargets.reset();
    this.fx.reset();
    this.events.sync();
  }
}
