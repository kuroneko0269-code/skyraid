// クライアントの他機の表示（5-1 の client-game.ts から 5-4 で分けた）: 他機ごとの状態の並び（SnapshotBuffer）と
// ホストの時刻の推定（HostClock）。ホストの時刻で 100ms 遅らせて前後の状態を補間し、途切れたら外挿する。Three.js 非依存
import { NET_CONFIG } from '../data/net';
import { copyQuat, copyVec3 } from '../flight/math';
import { createRemoteSample, type RemoteSample } from './net-game';
import type { PlayerInfo } from './protocol';
import { HostClock, SnapshotBuffer, createSampledPose, type SampledPose } from './sync';

interface ClientRemote {
  readonly buffer: SnapshotBuffer;
  readonly sample: RemoteSample;
}

export class RemoteInterpolation {
  readonly clock = new HostClock();
  private readonly remotes = new Map<number, ClientRemote>();
  private readonly list: RemoteSample[] = [];
  private readonly pose: SampledPose = createSampledPose();
  private lastRenderTime: number | null = null;
  private lastHostNow: number | null = null;
  /** 外挿している他機の数 */
  extrapolating = 0;
  /** 他機の最新の状態の時刻 − 表示時刻（ms。他機のうち最小） */
  marginMs = 0;

  /** 名簿にいない機体を消し、新しい機体の入れ物を作る */
  syncRoster(players: readonly PlayerInfo[], localId: number): void {
    const ids = new Set<number>();
    for (const p of players) {
      if (p.id === localId) continue;
      ids.add(p.id);
      if (!this.remotes.has(p.id)) {
        this.remotes.set(p.id, {
          buffer: new SnapshotBuffer(),
          sample: createRemoteSample(p.id, p.aircraftId),
        });
      }
    }
    for (const id of [...this.remotes.keys()]) if (!ids.has(id)) this.remotes.delete(id);
  }

  bufferOf(id: number): SnapshotBuffer | null {
    return this.remotes.get(id)?.buffer ?? null;
  }

  /** 直前の samples() で他機を表示した時刻（ホストの秒） */
  get renderTime(): number | null {
    return this.lastRenderTime;
  }

  /** 他機の表示の遅れ（ms。推定したホストの今 − 表示している時刻） */
  get delayMs(): number {
    return this.lastHostNow !== null && this.lastRenderTime !== null
      ? (this.lastHostNow - this.lastRenderTime) * 1000
      : 0;
  }

  samples(nowMs: number): readonly RemoteSample[] {
    const list = this.list;
    list.length = 0;
    const hostNow = this.clock.hostNow(nowMs / 1000);
    this.lastHostNow = hostNow;
    if (hostNow === null) return list;
    const t = hostNow - NET_CONFIG.sync.interpolationDelaySeconds;
    this.lastRenderTime = t;
    let extrapolating = 0;
    let margin = Infinity;
    for (const r of this.remotes.values()) {
      const mode = r.buffer.sample(t, this.pose);
      const latest = this.pose.latest;
      if (mode === 'empty' || !latest) continue;
      if (mode !== 'interpolated') extrapolating++;
      margin = Math.min(margin, latest.time - t);
      const out = r.sample;
      copyVec3(out.position, this.pose.position);
      copyQuat(out.orientation, this.pose.orientation);
      out.alive = latest.alive;
      out.afterburner = latest.afterburner;
      out.throttle = latest.throttle;
      copyVec3(out.velocity, latest.velocity);
      out.speed = Math.hypot(latest.velocity.x, latest.velocity.y, latest.velocity.z);
      out.hp = latest.hp;
      out.invulnerable = latest.invulnerable;
      list.push(out);
    }
    this.extrapolating = extrapolating;
    this.marginMs = Number.isFinite(margin) ? margin * 1000 : 0;
    return list;
  }
}
