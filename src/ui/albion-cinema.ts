// 10-7b: 白鯨アルビオンの演出（カメラと見た目だけ。判定・時間・リプレイの結果は変えない）: 登場の場面（雲の中から頭が出てくる。
// 下から見上げる。ソロのレイドだけ・タップで飛ばす）・段階が変わるときと撃破の揺れ。場面・揺れは共通の kaiju-cinema.ts
import type { PerspectiveCamera } from 'three';
import { abt } from '../data/albion-text';
import { ALBION_VISUAL } from '../data/albion-visual';
import type { AlbionRaid } from '../missions/albion-raid';
import type { FlightFrame } from '../render/flight-frame';
import { KaijuCinema, type KaijuCinemaSubject } from './kaiju-cinema';

/** 10-7b: レイドの値を演出が読む形で（毎フレーム今の値を読む） */
export class AlbionSubject implements KaijuCinemaSubject {
  raid: AlbionRaid | null = null;
  private readonly fw = { x: 0, z: -1 };
  private get r(): AlbionRaid {
    if (!this.raid) throw new Error('albion cinema: no raid');
    return this.raid;
  }
  get elapsed(): number {
    return this.r.elapsed;
  }
  get phase(): number {
    return this.r.kaiju.phase;
  }
  get dead(): boolean {
    return this.r.dead;
  }
  get position(): Readonly<{ x: number; y: number; z: number }> {
    return this.r.kaiju.body.position;
  }
  get forward(): Readonly<{ x: number; z: number }> {
    const h = this.r.kaiju.body.heading;
    this.fw.x = -Math.sin(h);
    this.fw.z = -Math.cos(h);
    return this.fw;
  }
}

/** 登場の場面を作る（onStart は場面の始め: 体の前を雲の塊で包む） */
export function createAlbionCinema(
  p: {
    readonly frame: FlightFrame;
    readonly camera: PerspectiveCamera;
    readonly shake: (strength: number) => void;
  },
  onStart: () => void,
): { cinema: KaijuCinema; subject: AlbionSubject } {
  const subject = new AlbionSubject();
  const cinema = new KaijuCinema(
    {
      parent: document.body,
      frame: p.frame,
      camera: p.camera,
      shake: p.shake,
      roar: () => undefined,
      name: abt('cinema.name'),
      sub: abt('cinema.sub'),
      skip: abt('cinema.skip'),
      theme: 'albion',
    },
    ALBION_VISUAL.cinema,
    { onStart },
  );
  return { cinema, subject };
}
