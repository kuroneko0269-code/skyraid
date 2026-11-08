// 10-7e: ヴォルガスの演出（カメラと見た目だけ。判定・時間・リプレイの結果は変えない）: 登場の場面（海から上陸するのを水面の近くから
// 見上げる。ソロのレイドだけ・タップで飛ばす）・段階が変わるときと撃破の揺れ。場面・揺れは共通の kaiju-cinema.ts
import type { PerspectiveCamera } from 'three';
import { getLocale, t } from '../core/i18n';
import { VORGAS_VISUAL } from '../data/vorgas-visual';
import en from '../data/i18n/vorgas/en.json';
import ja from '../data/i18n/vorgas/ja.json';
import type { Kaiju } from '../entities/kaiju';
import type { FlightFrame } from '../render/flight-frame';
import { KaijuCinema, type KaijuCinemaSubject } from './kaiju-cinema';

/** 場面の文（表は src/data/i18n/vorgas/。遅延チャンクだけが読む。名前は起動時の表の kaiju.name） */
const TEXT = { ja, en } as const;

/** レイドの値を演出が読む形で（毎フレーム今の値を読む）。基準点は足元の床（上陸の間も水面の高さ） */
export class VorgasSubject implements KaijuCinemaSubject {
  kaiju: Kaiju | null = null;
  private readonly fw = { x: 0, z: -1 };
  private readonly at = { x: 0, y: 0, z: 0 };
  private get k(): Kaiju {
    if (!this.kaiju) throw new Error('vorgas cinema: no kaiju');
    return this.kaiju;
  }
  get elapsed(): number {
    return this.k.time;
  }
  get phase(): number {
    return this.k.phase;
  }
  get dead(): boolean {
    return this.k.stage === 'dead';
  }
  get position(): Readonly<{ x: number; y: number; z: number }> {
    const f = this.k.feet;
    this.at.x = f.x;
    this.at.y = this.k.floorAt(f.x, f.z);
    this.at.z = f.z;
    return this.at;
  }
  get forward(): Readonly<{ x: number; z: number }> {
    const h = this.k.heading;
    this.fw.x = -Math.sin(h);
    this.fw.z = -Math.cos(h);
    return this.fw;
  }
}

/** 登場の場面を作る */
export function createVorgasCinema(p: {
  readonly frame: FlightFrame;
  readonly camera: PerspectiveCamera;
  readonly shake: (strength: number) => void;
  readonly roar: () => void;
}): { cinema: KaijuCinema; subject: VorgasSubject } {
  const subject = new VorgasSubject();
  const text = getLocale() === 'en' ? TEXT.en : TEXT.ja;
  const cinema = new KaijuCinema(
    {
      parent: document.body,
      frame: p.frame,
      camera: p.camera,
      shake: p.shake,
      roar: p.roar,
      name: t('kaiju.name'),
      sub: text['cinema.sub'],
      skip: text['cinema.skip'],
      theme: 'vorgas',
    },
    VORGAS_VISUAL.cinema,
  );
  return { cinema, subject };
}
