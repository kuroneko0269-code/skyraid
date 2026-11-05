// 9-7: ネフィルガの本体を作った直後の値に戻す（Three.js 非依存）。続けて飛ぶ（もう一度・別のレイド・M8）と、降り方の途中の値・姿勢・
// 雷球の経過・止まり木の場所などが前の飛行のまま残り、ページを開き直した飛行と違う動きになっていた（リプレイが合わない）。
// 新しい本体を 1 つ作り、その値を今の本体へ写す（入れ物はそのまま使う。関数・地面・乱数・戦域の中心は写さない）
import { SkyKaiju } from './sky-kaiju';

/** 写さないもの: 地面の関数・乱数（出すときに種を入れ直す）・戦域の中心（出すときに決める） */
const KEEP = new Set(['ground', 'random', 'center']);

function copyInto(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    if (KEEP.has(key)) continue;
    const v = source[key];
    if (typeof v === 'function') continue;
    const t = target[key];
    if (Array.isArray(v) && Array.isArray(t) && t.length === v.length && v.length > 0) {
      // 同じ数の入れ物（雷球）: 要素の中へ写す（要素への参照を持つ描画・写しがそのまま使える）
      v.forEach((item: unknown, i) => {
        const cur: unknown = t[i];
        if (item !== null && typeof item === 'object' && cur !== null && typeof cur === 'object')
          copyInto(cur as Record<string, unknown>, item as Record<string, unknown>);
        else t[i] = item;
      });
    } else if (Array.isArray(v) && Array.isArray(t)) {
      t.length = 0;
      for (const item of v as unknown[]) {
        if (item !== null && typeof item === 'object') {
          const copy: Record<string, unknown> = {};
          copyInto(copy, item as Record<string, unknown>);
          t.push(copy);
        } else t.push(item);
      }
    } else if (v !== null && typeof v === 'object' && t !== null && typeof t === 'object')
      copyInto(t as Record<string, unknown>, v as Record<string, unknown>);
    else target[key] = v;
  }
}

/** 本体のすべての値を作った直後に戻す（Kaiju2Raid.reset の始めに呼ぶ） */
export function clearSkyKaiju(k: SkyKaiju): void {
  copyInto(
    k as unknown as Record<string, unknown>,
    new SkyKaiju(k.ground) as unknown as Record<string, unknown>,
  );
}
