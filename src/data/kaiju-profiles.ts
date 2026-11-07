// 9-10d: レイドの怪獣選びの画面（src/ui/raid-select.ts）に並べる怪獣の紹介。10-2 から紹介のデータは登録簿
// （src/data/raid-kaiju.ts の RAID_KAIJU）に 1 か所でまとめ、ここはその読み口と画像の書き出しの設定だけ。
// 文は表の raidSelect.kaiju.<id>（tagline・size・motion・parts・opening・normal・hard・attacks.<攻撃>.name / note）に、
// 画像は public/kaiju-art/<id>.webp に置く（作り方は README の「怪獣の画像」。npm run render-kaiju-art）。Three.js・DOM 非依存
import { RAID_KAIJU, type KaijuArtScene, type RaidKaijuDef, type RaidKaijuId } from './raid-kaiju';

export type { KaijuArtScene } from './raid-kaiju';

export type KaijuProfile = RaidKaijuDef & { readonly id: RaidKaijuId };

export const KAIJU_ART = {
  /** 書き出す大きさ（正方形）と webp の画質 */
  size: 960,
  quality: 0.9,
} as const;

/** 登録された全部の怪獣（未公開を含む。画面に出すのは raid-select.ts の availableKaiju） */
export const KAIJU_PROFILES: readonly KaijuProfile[] = RAID_KAIJU;

export function findKaijuProfile(id: string): KaijuProfile | null {
  return KAIJU_PROFILES.find((p) => p.id === id) ?? null;
}

/** 画像の場面（無い id は null） */
export function kaijuArtScene(id: string): KaijuArtScene | null {
  return findKaijuProfile(id)?.scene ?? null;
}
