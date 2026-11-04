// 9-6b: ネフィルガの音のきっかけ（?dev=kaiju2 の遅延チャンク）: 描画フレームごとに本体を見て、攻撃の段階が変わったら予兆・攻撃の音、
// 羽ばたきの打ち下ろし・部位の破壊・段階の変化・撃破で鳴らす（ヴォルガスの kaiju-watch.ts と同じ考え）。音量は距離で下げる
import { KAIJU2_CONFIG } from '../data/kaiju2';
import { KAIJU2_SOUND } from '../data/kaiju2-audio';
import type { Kaiju2Raid } from '../missions/kaiju2-raid';
import type { KaijuSounds } from './sfx/kaiju-sounds';
import type { Kaiju2Sounds } from './sfx/kaiju2-sounds';

export class Kaiju2SoundWatch {
  private seen = false;
  private key = '';
  private flap = 0;
  private broken = 0;
  private phase = 1;
  private dead = false;

  constructor(
    private readonly sounds: Kaiju2Sounds,
    private readonly shared: KaijuSounds,
  ) {}

  /** raid が null・見えていなければ覚えている状態を忘れる（次に見えたときは今の状態を覚えるだけ） */
  update(raid: Kaiju2Raid | null, listener: Readonly<{ x: number; y: number; z: number }>): void {
    const k = raid?.body;
    if (!raid || !k?.visible) {
      this.seen = false;
      return;
    }
    const p = k.position;
    const d = Math.hypot(p.x - listener.x, p.y - listener.y, p.z - listener.z);
    const c = KAIJU2_SOUND.distance;
    const gain = Math.max(c.minGain, Math.min(1, c.refDistance / Math.max(1, d)));
    const key = k.attack ? `${k.attack}:${k.state}` : k.state;
    const flap = Math.floor(k.pose.flapPhase);
    if (!this.seen) {
      this.seen = true;
      this.key = key;
      this.flap = flap;
      this.broken = raid.brokenCount;
      this.phase = k.phase;
      this.dead = raid.dead;
      return;
    }
    if (key !== this.key) {
      this.key = key;
      const a = KAIJU2_CONFIG.attacks;
      const s = this.sounds;
      if (key === 'orbs:windup') s.orbCharge(a.orbs.windup * k.windupScale, gain);
      else if (key === 'orbs:attack') s.orbLaunch(gain);
      else if (key === 'gust:windup') s.gustCharge(a.gust.windup * k.windupScale, gain);
      else if (key === 'gust:attack') s.gust(gain);
      else if (key === 'dive:attack') s.scream('dive', gain);
      else if (key === 'tail:attack') s.tail(gain);
    }
    if (flap !== this.flap) {
      this.flap = flap;
      if (k.pose.flapAmount > 0.4 && d < KAIJU2_SOUND.flap.maxDistance) this.sounds.flap(gain);
    }
    if (raid.brokenCount > this.broken) this.shared.partBreak(gain);
    this.broken = raid.brokenCount;
    if (k.phase > this.phase) this.sounds.scream('shout', gain);
    this.phase = k.phase;
    if (raid.dead && !this.dead) {
      this.sounds.scream('shout', gain);
      this.shared.partBreak(gain);
    }
    this.dead = raid.dead;
  }
}
