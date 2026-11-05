// 9-6d: ネフィルガの「当てにくさ」と押し流しの時計（kaiju2-ai.ts から分けた。Three.js 非依存）:
// 狙われたら避ける（巡航の間だけ。射線から横へ・上か下へ）・部位を壊されて怯む・突風の押し流しの残り
import { KAIJU2_CONFIG as C } from '../data/kaiju2';
import type { Vec3 } from '../flight/math';
import type { SkyKaiju } from '../entities/kaiju2/sky-kaiju';

/** 押し流し・狙われて避ける・怯むの時計（固定ステップの初めに 1 回） */
export function stepKaiju2Timers(k: SkyKaiju, dt: number): void {
  const e = C.evade;
  k.pushLeft = Math.max(0, k.pushLeft - dt);
  k.flinch = Math.max(0, k.flinch - dt);
  k.evadeLeft = Math.max(0, k.evadeLeft - dt);
  k.evadeCooldown = Math.max(0, k.evadeCooldown - dt);
  if (k.aimed && k.state === 'cruise') k.aimTime += dt;
  else k.aimTime = Math.max(0, k.aimTime - dt * 2);
  if (
    k.state === 'cruise' &&
    k.aimTime >= e.afterSeconds &&
    k.evadeLeft <= 0 &&
    k.evadeCooldown <= 0 &&
    k.flinch <= 0
  ) {
    k.evadeLeft = e.seconds;
    k.evadeCooldown = e.seconds + e.cooldown;
    k.evadeSide = k.random.next() < 0.5 ? -1 : 1;
    // 上か下: 巡航の高さより上なら下へ、下なら上へ（地面・天井から離れる向き）
    const agl = k.position.y - k.floorAt(k.position.x, k.position.z);
    k.evadeUp = agl > C.cruise.altitude ? -1 : 1;
    k.aimTime = 0;
  }
  if (k.state !== 'cruise') k.evadeLeft = 0;
}

const scale = { turn: 1, speed: 1 };

/**
 * 周回の向き want を、避けている間は射線から横へ・上か下へ、怯んでいる間は少し下へ書き換える。
 * 旋回と速さに掛ける倍率を返す（使い回しの入れ物）
 */
export function evadeSteer(k: SkyKaiju, want: Vec3): { turn: number; speed: number } {
  scale.turn = 1;
  scale.speed = 1;
  if (k.evadeLeft > 0) {
    // 狙っている人の射線に直角の水平の向きへ
    const lx = k.position.x - k.aimFrom.x;
    const lz = k.position.z - k.aimFrom.z;
    const ll = Math.hypot(lx, lz) || 1;
    const len = Math.hypot(want.x, want.y, want.z) || 1;
    const e = C.evade;
    want.x = want.x * 0.25 + (-lz / ll) * k.evadeSide * len;
    want.z = want.z * 0.25 + (lx / ll) * k.evadeSide * len;
    want.y = k.evadeUp * e.climb * len;
    scale.turn = e.turnScale;
    scale.speed = e.speedScale;
  } else if (k.flinch > 0) {
    // 怯む: 遅く、少し下がる
    const len = Math.hypot(want.x, want.z) || 1;
    want.y = (-C.flinch.sink / Math.max(1, k.speed)) * len;
    scale.speed = C.flinch.speedScale;
  }
  return scale;
}
