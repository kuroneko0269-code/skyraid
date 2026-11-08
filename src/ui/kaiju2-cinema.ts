// 10-7a: ネフィルガの演出（カメラと見た目だけ。判定・時間・リプレイの結果は変えない。時間を遅くするものは入れない）:
// 登場のとき短い場面（3.6 秒。カメラが遠くから寄って下から見上げる。画面のどこかをタップ / キーで飛ばせる）、
// 段階が変わるときの画面の揺れ、撃破のときの揺れと、雨の空なら晴れ間へ（天候は見た目と HUD の目印の距離だけ。倒した後）。
// 10-7b: 場面・揺れは共通の kaiju-cinema.ts。ここはネフィルガの値と晴れ間だけ
import type { PerspectiveCamera } from 'three';
import { KAIJU2_VISUAL } from '../data/kaiju2-visual';
import { k2t } from '../data/kaiju2-text';
import { FINALE_WEATHER } from '../data/weather';
import type { Kaiju2Raid } from '../missions/kaiju2-raid';
import type { FlightFrame } from '../render/flight-frame';
import { KaijuCinema, type KaijuCinemaSubject } from './kaiju-cinema';

export interface Kaiju2CinemaParts {
  readonly parent: HTMLElement;
  readonly frame: FlightFrame;
  readonly camera: PerspectiveCamera;
  readonly shake: (strength: number) => void;
  readonly roar: () => void;
  readonly setWeather: (id: string) => void;
  /** 今の天候の雨（0〜1） */
  readonly rain: () => number;
}

/** レイドの値を演出が読む形で（毎フレーム今の値を読む） */
class Kaiju2Subject implements KaijuCinemaSubject {
  raid: Kaiju2Raid | null = null;
  private get r(): Kaiju2Raid {
    if (!this.raid) throw new Error('kaiju2 cinema: no raid');
    return this.raid;
  }
  get elapsed(): number {
    return this.r.elapsed;
  }
  get phase(): number {
    return this.r.body.phase;
  }
  get dead(): boolean {
    return this.r.dead;
  }
  get position(): Readonly<{ x: number; y: number; z: number }> {
    return this.r.body.position;
  }
  get forward(): Readonly<{ x: number; z: number }> {
    return this.r.body.forward;
  }
}

export class Kaiju2Cinema {
  private readonly cinema: KaijuCinema;
  private readonly subject = new Kaiju2Subject();

  constructor(p: Kaiju2CinemaParts) {
    this.cinema = new KaijuCinema(
      {
        parent: p.parent,
        frame: p.frame,
        camera: p.camera,
        shake: p.shake,
        roar: p.roar,
        name: k2t('cinema.name'),
        sub: k2t('cinema.sub'),
        skip: k2t('cinema.skip'),
        theme: 'nephirga',
      },
      KAIJU2_VISUAL.cinema,
      {
        onDefeat: () => {
          const raid = this.subject.raid;
          if (raid && !raid.campaign && p.rain() > 0.3) p.setWeather(FINALE_WEATHER.cleared);
        },
      },
    );
  }

  /** 登場の場面を出している */
  get active(): boolean {
    return this.cinema.active;
  }

  /**
   * 描画フレームごと。raid はソロのレイドを飛んでいるとき（それ以外は null）。flying は飛行中（ポーズ・結果では止める）。
   * campaign の天候の移り変わりは kaiju2-finale.ts
   */
  update(raid: Kaiju2Raid | null, flying: boolean, dt: number): void {
    this.subject.raid = raid;
    this.cinema.update(raid ? this.subject : null, flying, dt);
  }
}
