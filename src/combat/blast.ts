// 範囲ダメージの式（2-6。ロケット・爆弾・燃料タンクの誘爆）。Three.js 非依存
import type { BlastSpec } from '../data/ground-targets';

/** 爆心から対象の表面までの距離 d（m）に対するダメージ。中心 maxDamage・縁 maxDamage × edgeFraction・外は 0 */
export function blastDamage(spec: BlastSpec, d: number): number {
  if (d >= spec.radius) return 0;
  const k = Math.max(0, d) / spec.radius;
  return spec.maxDamage * (1 - (1 - spec.edgeFraction) * k);
}
