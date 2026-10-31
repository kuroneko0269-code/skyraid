// 怪獣が建物を壊す（6-4。Three.js 非依存）: 歩く足元と尾の下・薙ぎ払いの尾の届く範囲・熱線の通り道。
// 怪獣の表示の口（KaijuBodyView / KaijuEffectsView）を読むので、シングル・ホスト（本体）も協力のクライアント（写し）も同じ式
import { CITY_CONFIG } from '../data/city';
import { KAIJU_ATTACK_CONFIG } from '../data/kaiju';
import type { KaijuBodyView, KaijuEffectsView } from '../entities/kaiju-display';
import type { BuildingField } from './buildings';

/** 尾の下の円（足元から後ろへ）の距離と半径 */
const TAIL_BACK = 110;
const TAIL_RADIUS = 30;

/** 固定ステップごと。怪獣が出ていなければ何もしない */
export function applyKaijuToCity(
  field: BuildingField,
  body: KaijuBodyView,
  fx: KaijuEffectsView | null,
): void {
  if (!body.visible) return;
  const f = body.feet;
  const k = CITY_CONFIG.kaiju;
  field.hitCircle(f.x, f.z, k.footRadius, 'kaiju');
  // 尾は後ろ（前方 −Z を heading で回した逆）
  const bx = Math.sin(body.heading) * TAIL_BACK;
  const bz = Math.cos(body.heading) * TAIL_BACK;
  field.hitCircle(f.x + bx, f.z + bz, TAIL_RADIUS, 'kaiju');
  if (body.attack === 'sweep' && body.attackStep === 'active') {
    field.hitCircle(f.x, f.z, k.sweepRadius, 'kaiju');
  }
  const beam = fx?.beam;
  if (beam?.on) {
    field.hitBeam(
      beam.origin,
      beam.direction,
      beam.length,
      KAIJU_ATTACK_CONFIG.beam.width / 2,
      'kaiju',
    );
  }
}
