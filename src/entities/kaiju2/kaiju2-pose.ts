// 9-6a: ネフィルガの見た目の姿勢の値（羽ばたき・たたむ・掲げる・喉の光・尾・首・脚）を固定ステップで進める。
// 描画（src/render/kaiju2-model/skeleton.ts）はこの値で骨を回すだけ。Three.js 非依存
import { KAIJU2_CONFIG as C } from '../../data/kaiju2';
import type { SkyKaiju } from './sky-kaiju';

const A = C.attacks;

/** 見た目の姿勢の値（固定ステップで滑らかに） */
export function updateKaiju2Pose(k: SkyKaiju, dt: number): void {
  const p = k.pose;
  const a = k.attack;
  const s = k.state;
  const toward = (v: number, goal: number, rate: number): number =>
    v + (goal - v) * Math.min(1, dt * rate);
  const diving =
    a === 'dive' &&
    (s === 'attack' || (s === 'windup' && k.stateTime > A.dive.windup * k.windupScale - 0.8));
  // 9-6d: 翼をたたむのは着地してから（降りる途中は旋回で滑空し、低くなったら羽ばたいて脚を出す）。
  // 降りる途中の段は床からの高さで決める（協力の写しも同じ: 位置は届いた値）
  const perched = s === 'perched';
  const flaring =
    s === 'landing' && k.position.y - k.floorAt(k.position.x, k.position.z) < C.perch.flareAgl;
  const lifting = s === 'takeoff' && k.stateTime < C.perch.liftSeconds;
  p.wingFold = toward(p.wingFold, diving ? 0.85 : perched ? 1 : 0, perched ? 2 : 3);
  p.legsDown = toward(p.legsDown, perched || flaring || s === 'takeoff' ? 1 : 0, 2);
  p.wingRaise = toward(
    p.wingRaise,
    a === 'gust' && s === 'windup' ? 1 : 0,
    a === 'gust' && s === 'attack' ? 12 : 3,
  );
  p.throatGlow = toward(
    p.throatGlow,
    a === 'orbs' && s === 'windup' ? 1 : 0,
    s === 'windup' ? 1.5 : 6,
  );
  p.tailCurl = toward(p.tailCurl, a === 'tail' && s === 'windup' ? 1 : 0, 4);
  p.tailSwing =
    a === 'tail' && s === 'attack'
      ? Math.sin((k.stateTime / A.tail.active) * Math.PI * 2) * 1
      : toward(p.tailSwing, 0, 4);
  // 9-6d: 怯む（部位を壊された）: 首を下げ、羽ばたきを弱める
  const flinch = k.flinch > 0;
  p.neckPitch = toward(
    p.neckPitch,
    diving ? -0.6 : flinch ? -0.45 : a === 'orbs' && s === 'windup' ? 0.4 : 0,
    3,
  );
  // 羽ばたき: 上昇・ホバリング（予兆）で速く、急降下・止まり木では止める。巡航は数回ごとに滑空
  let rate: number = C.flap.cruise;
  let amount = 1;
  if ((s === 'windup' && (a === 'orbs' || a === 'gust')) || flaring || lifting) rate = C.flap.hover;
  else if (k.forward.y > 0.2 || s === 'takeoff' || s === 'recover') rate = C.flap.climb;
  if (diving || perched) amount = 0;
  else if (flinch) amount = 0.25;
  else if (s === 'landing' && !flaring) amount = 0.35;
  else if (s === 'cruise' && Math.sin(k.time * 0.21) > 0.55) amount = 0.15;
  p.flapAmount = toward(p.flapAmount, amount, 2);
  p.flapPhase += rate * dt * (0.3 + 0.7 * p.flapAmount);
}
