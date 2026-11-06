// 9-10d: レイドの怪獣選びの画面（src/ui/raid-select.ts）に並べる怪獣の紹介。怪獣を足すときはここに 1 件足し、文を表の
// raidSelect.kaiju.<id>（tagline・size・motion・parts・opening・hard・attacks.<攻撃>.name / note）に、画像を
// public/kaiju-art/<id>.webp に置く（作り方は README の「怪獣の画像」。npm run render-kaiju-art）。
// 画面に出すのは、ヴォルガスと、レイドの別の怪獣として登録されたもの（src/missions/raid-variants.ts）だけ。Three.js・DOM 非依存
import type { RaidKaijuId } from './raid-kaiju';

export interface KaijuProfile {
  readonly id: RaidKaijuId;
  /** 画像（public/ からの相対パス。正方形 960 × 960 の webp。怪獣を真ん中に置く） */
  readonly art: string;
  /** 画像の下の帯の英字の名前 */
  readonly latinName: string;
  /** 攻撃の並び（文は raidSelect.kaiju.<id>.attacks.<攻撃>） */
  readonly attacks: readonly string[];
  /** 狭い枠に切り取るときの中心（CSS の object-position） */
  readonly focus: string;
  /** 画像を作るときの場面（scripts/render-kaiju-art.js・src/ui/kaiju-art.ts） */
  readonly scene: KaijuArtScene;
}

/** 画像の場面: 天候とカメラ（怪獣の基準点からの相対。m） */
export interface KaijuArtScene {
  readonly weather: string;
  /** カメラの位置（怪獣の向きの前 = +forward、右 = +right、上 = +up。怪獣の基準点から） */
  readonly camera: { readonly forward: number; readonly right: number; readonly up: number };
  /** 見る点（同じく怪獣の基準点から） */
  readonly look: { readonly forward: number; readonly right: number; readonly up: number };
  /** 縦の画角（度） */
  readonly fov: number;
  /** 出撃してから撮るまでの秒数（上陸・飛び立ちを待つ） */
  readonly waitSeconds: number;
}

export const KAIJU_ART = {
  /** 書き出す大きさ（正方形）と webp の画質 */
  size: 960,
  quality: 0.9,
} as const;

export const KAIJU_PROFILES: readonly KaijuProfile[] = [
  {
    id: 'vorgas',
    art: 'kaiju-art/vorgas.webp',
    latinName: 'VORGAS',
    attacks: ['sweep', 'roar', 'beam', 'throw'],
    focus: '50% 45%',
    // 夕方の湾: 海面すれすれの低い所から、上陸して街へ歩く姿を斜め前から見上げる
    scene: {
      weather: 'evening-clear',
      camera: { forward: 200, right: -115, up: 6 },
      look: { forward: 0, right: 0, up: 84 },
      fov: 56,
      waitSeconds: 26,
    },
  },
  {
    id: 'nephirga',
    art: 'kaiju-art/nephirga.webp',
    latinName: 'NEPHIRGA',
    attacks: ['orb', 'gust', 'dive', 'tail'],
    focus: '50% 50%',
    // 嵐の空: 翼を広げて飛ぶ姿を斜め下から見上げる
    scene: {
      weather: 'day-rain',
      camera: { forward: 310, right: -240, up: -95 },
      look: { forward: 0, right: 0, up: 0 },
      fov: 52,
      waitSeconds: 14,
    },
  },
];

export function findKaijuProfile(id: string): KaijuProfile | null {
  return KAIJU_PROFILES.find((p) => p.id === id) ?? null;
}
