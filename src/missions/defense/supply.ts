// 防衛戦（7-2）の補給の条件（Three.js 非依存）: 波の間に、基地の中心から水平 600m 以内を、地表から 300m 以下・速度 150 以下で通る。
// 燃料タンクを失うと、補給は各武装の満タンの半分（切り上げ）だけ
import { DEFENSE_CONFIG } from '../../data/defense';

export function canResupply(
  position: { readonly x: number; readonly z: number },
  agl: number,
  speed: number,
  center: { readonly x: number; readonly z: number },
): boolean {
  const s = DEFENSE_CONFIG.supply;
  const d = Math.hypot(position.x - center.x, position.z - center.z);
  return d <= s.radius && agl <= s.maxAgl && speed <= s.maxSpeed;
}

/** 補給の量（満タンに対する割合） */
export function supplyFraction(fuelAlive: boolean): number {
  return fuelAlive ? 1 : DEFENSE_CONFIG.supplyWithoutFuel;
}
