// 怪獣の音のきっかけ（6-2）: 表示の口（KaijuBodyView）を描画フレームごとに見て、歩数が進んだら足音、攻撃の段階が
// 変わったら咆哮・熱線、部位が壊れたら破壊音、ブレイクが始まったら合図を鳴らす。シングルプレイの本体と
// 協力のクライアントの写しのどちらでも同じように動く。音量は距離で下げる（KAIJU_SOUND.distance）
import { KAIJU_SOUND } from '../data/audio';
import { KAIJU_ATTACK_CONFIG } from '../data/kaiju';
import type { KaijuBodyView } from '../entities/kaiju-display';
import type { KaijuSounds } from './sfx/kaiju-sounds';

export class KaijuSoundWatch {
  private step = -1;
  private attackKey = '';
  private broken: boolean[] = [];
  private breaking: boolean[] = [];
  private seen = false;

  constructor(private readonly sounds: KaijuSounds) {}

  /** 描画フレームごと。body が null・見えていなければ覚えている状態を忘れる */
  update(
    body: KaijuBodyView | null,
    listener: Readonly<{ x: number; y: number; z: number }>,
  ): void {
    if (!body?.visible) {
      this.seen = false;
      return;
    }
    const f = body.feet;
    const d = Math.hypot(f.x - listener.x, f.y + 80 - listener.y, f.z - listener.z);
    const c = KAIJU_SOUND.distance;
    const gain = Math.max(c.minGain, Math.min(1, c.refDistance / Math.max(1, d)));
    const step = Math.floor(body.walkPhase);
    const key = body.attack ? `${body.attack}:${body.attackStep}` : '';
    if (!this.seen) {
      // 初めて見えたフレームは今の状態を覚えるだけ（途中から鳴らさない）
      this.seen = true;
      this.step = step;
      this.attackKey = key;
      this.broken = body.parts.map((p) => p.broken);
      this.breaking = body.parts.map((p) => p.breakTimer > 0);
      return;
    }
    if (step !== this.step) {
      this.step = step;
      if (body.feet.y > -5) this.sounds.footstep(gain);
    }
    if (key !== this.attackKey) {
      this.attackKey = key;
      if (key === 'roar:windup') this.sounds.roar(gain);
      else if (key === 'beam:windup') this.sounds.beamCharge(body.attackDuration, gain);
      else if (key === 'beam:active') this.sounds.beam(KAIJU_ATTACK_CONFIG.beam.active, gain);
    }
    body.parts.forEach((p, i) => {
      if (p.broken && !this.broken[i]) this.sounds.partBreak(gain);
      this.broken[i] = p.broken;
      const br = p.breakTimer > 0;
      if (br && !this.breaking[i]) this.sounds.breakChime();
      this.breaking[i] = br;
    });
  }
}
