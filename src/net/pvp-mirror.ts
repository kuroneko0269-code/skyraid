// PvP の戦闘の表示（5-3。ホスト・クライアント共通）: ホストの判定の結果（event・ミサイルの状態・HP）を、自機の
// FlightSession（session.combat・session.player・session.rivals）に映す。これで HUD・エフェクト・3D の音は
// シングルプレイと同じものが動く。判定はしない（自機の機銃の弾は見た目だけで、他機に当たらない）。
// 自機の索敵とロックはここで計算し、ロック完了と対象を入力に入れる（ホストは信頼せず見直す）。
// 他機の機銃は発射の event から見た目の弾だけ出す。
// 5-4: チーム戦の味方は索敵しない（レーダー・名札は味方の色）。初心者保護つきの復帰で最大 HP とミサイルを増やす。
// 撃墜した相手（撃墜の画面）を覚える。
// 6-2: レイドの怪獣の部位も索敵・ロックの対象（入力の targetId は KAIJU_ID_BASE + 部位の番号）、咆哮のスタンを覚える。Three.js 非依存
import { createCombatInput, type CombatInput } from '../combat/combat-input';
import { MISSILE_CONFIG } from '../data/weapons';
import { AIRCRAFT_COMBAT } from '../data/aircraft';
import { HUD_CONFIG } from '../data/hud';
import { PVP_CONFIG } from '../data/pvp';
import type { Bullet } from '../combat/gun';
import type { Pool } from '../combat/pool';
import { TEAM_ENEMY, TEAM_PLAYER, type CombatTarget } from '../combat/target';
import { DEFENSE_ID_BASE, KAIJU_ID_BASE, NOBODY, RESPAWN_BOOST } from '../combat/pvp-arena';
import type { Vec3 } from '../flight/math';
import type { FlightSession } from '../missions/flight-session';
import { RivalProxy } from './rival-proxy';
import { createLocalCombat, type LocalCombat, type NetGame, type RemoteSample } from './net-game';
import { NO_TARGET, type EventMsg, type PlayerInfo } from './protocol';
import { MissileMirror } from './missile-mirror';

/** 撃墜のフィードの 1 件（killer が null なら墜落） */
export interface FeedItem {
  readonly killer: number | null;
  readonly victim: number;
  /** 出した時刻（このクラスの秒） */
  readonly time: number;
}

const NO_TARGETS: readonly CombatTarget[] = [];

/** ロックできる怪獣の部位（6-2。本体の KaijuPart と写しの MirrorPart） */
export interface KaijuLockable extends CombatTarget {
  readonly kaijuIndex: number;
}

function isKaijuLockable(t: CombatTarget): t is KaijuLockable {
  return 'kaijuIndex' in t;
}

export class PvpMirror {
  readonly rivals = new Map<number, RivalProxy>();
  readonly local: LocalCombat = createLocalCombat();
  /** 撃った人ごとの、届いた命中の event の数（ホストの判定と同じ数になる） */
  readonly hitsBy = new Map<number, number>();
  readonly feed: FeedItem[] = [];
  /** 自機の復帰後の無敵の残り秒数（半透明） */
  ownInvulnerable = 0;
  /** 経過秒数（フィードの時刻） */
  time = 0;
  /** 自機を最後に撃墜した人（null は墜落）と時刻（撃墜の画面。5-4。undefined はまだ撃墜されていない） */
  downedBy: number | null | undefined = undefined;
  downedAt = 0;
  /** 今の命が初心者保護つきか（5-4） */
  ownBoosted = false;
  private readonly rivalList: RivalProxy[] = [];
  /** 索敵の対象（チーム戦の味方を除く。レイドは怪獣の部位も） */
  private readonly targetList: CombatTarget[] = [];
  private kaijuTargets: readonly KaijuLockable[] = [];
  /** 防衛戦（7-2）の敵（索敵の対象。入力の targetId は DEFENSE_ID_BASE + 添字） */
  private defenseTargets: readonly CombatTarget[] = [];
  private readonly defenseIndex = new Map<CombatTarget, number>();
  /** 自機のスタンの残り秒数（6-2。操作を使わない・HUD のノイズ） */
  ownStun = 0;
  private readonly baseMaxHp: number;
  private readonly baseMissiles: number;
  private readonly missileView: MissileMirror;
  private missileVersion = -1;
  private readonly noInput = createCombatInput();
  private readonly pools: Pool<Bullet>[] = [];

  constructor(
    private readonly session: FlightSession,
    readonly localId: number,
    /** 他プレイヤーの機銃の発射音（位置付き） */
    private readonly onOtherGun: (x: number, y: number, z: number) => void = () => undefined,
  ) {
    this.missileView = new MissileMirror(session, localId, this.rivals);
    this.baseMaxHp = session.player.maxHp;
    this.baseMissiles = session.combat.missileAmmo.capacity;
  }

  /** 名簿に合わせて他プレイヤーを作る・消す。team はチーム戦のときの自分のチーム（個人戦は undefined） */
  syncRoster(players: readonly PlayerInfo[], team?: number): void {
    const ids = new Set<number>();
    for (const p of players) {
      if (p.id === this.localId) continue;
      ids.add(p.id);
      let r = this.rivals.get(p.id);
      if (!r) {
        r = new RivalProxy(p.id, p.aircraftId, p.maxHp);
        this.rivals.set(p.id, r);
      }
      r.team = team !== undefined && p.team === team ? TEAM_PLAYER : TEAM_ENEMY;
    }
    for (const id of [...this.rivals.keys()]) if (!ids.has(id)) this.rivals.delete(id);
    this.rivalList.length = 0;
    this.targetList.length = 0;
    for (const r of this.rivals.values()) {
      this.rivalList.push(r);
      if (!r.ally) this.targetList.push(r);
    }
    this.targetList.push(...this.kaijuTargets, ...this.defenseTargets);
    const list = this.session.rivals;
    list.length = 0;
    list.push(...this.rivalList);
  }

  /** レイドの怪獣の部位を索敵の対象にする（6-2。ホストは本体の部位、クライアントは写しの部位） */
  setKaijuTargets(parts: readonly KaijuLockable[]): void {
    this.kaijuTargets = parts;
    this.targetList.length = 0;
    for (const r of this.rivalList) if (!r.ally) this.targetList.push(r);
    this.targetList.push(...parts, ...this.defenseTargets);
  }

  /** 防衛戦の敵を索敵の対象にする（7-2。ホストと同じ通し番号の順） */
  setDefenseTargets(list: readonly CombatTarget[]): void {
    this.defenseTargets = list;
    this.defenseIndex.clear();
    list.forEach((t, i) => this.defenseIndex.set(t, i));
    this.targetList.length = 0;
    for (const r of this.rivalList) if (!r.ally) this.targetList.push(r);
    this.targetList.push(...this.kaijuTargets, ...list);
  }

  /** 他プレイヤーの見た目の機銃の弾（描画） */
  rivalGuns(): readonly Pool<Bullet>[] {
    const out = this.pools;
    out.length = 0;
    for (const r of this.rivalList) out.push(r.gun.bullets);
    return out;
  }

  /** 表示の後始末（PvP の終わり）: シングルプレイの判定に他プレイヤーを残さない */
  detach(): void {
    this.session.rivals.length = 0;
    this.session.combat.missiles.reset();
    this.session.combat.targeting.reset();
  }

  /**
   * 固定ステップ 1 回分（net.step の前）: 自機の索敵・ロック・弾数・見た目の機銃の弾・フレア。
   * 送る戦闘の操作（this.local）を返す
   */
  stepLocal(input: Readonly<CombatInput>, dt: number): LocalCombat {
    const s = this.session;
    const c = s.combat;
    const own = s.aircraft.state;
    const alive = s.player.active;
    const i = alive ? input : this.noInput;
    this.time += dt;
    c.hitMarkerTimer = Math.max(0, c.hitMarkerTimer - dt);
    c.targeting.step(own, this.targetList, i.targetNext, dt);
    c.updateLead(own);
    c.missileAmmo.step(dt);
    const l = this.local;
    l.fire = i.trigger;
    l.missile = i.missile && c.missileAmmo.tryUse();
    l.flare = i.flare && c.flares.magazine.tryUse();
    if (l.flare) c.flares.release(own, TEAM_PLAYER);
    l.targetNext = i.targetNext;
    l.locked = c.targeting.locked;
    const sel = c.targeting.selected;
    l.targetId =
      sel instanceof RivalProxy
        ? sel.id
        : sel && isKaijuLockable(sel)
          ? KAIJU_ID_BASE + sel.kaijuIndex
          : sel && this.defenseIndex.has(sel)
            ? DEFENSE_ID_BASE + (this.defenseIndex.get(sel) ?? 0)
            : NO_TARGET;
    c.gun.step(l.fire, own, NO_TARGETS, dt);
    return l;
  }

  /** 固定ステップ 1 回分（net.step の後）: ミサイル・フレア・他機の見た目の弾・自機の HP */
  stepWorld(net: NetGame, dt: number): void {
    const s = this.session;
    if (net.missileVersion !== this.missileVersion) {
      this.missileVersion = net.missileVersion;
      this.missileView.sync(net.missiles, dt, this.time);
    } else this.missileView.advance(dt);
    s.combat.flares.step(dt);
    for (const r of this.rivalList) {
      const shots = r.gun.shotCount;
      r.gun.step(r.firing && r.active, r, NO_TARGETS, dt);
      if (r.gun.shotCount > shots) this.onOtherGun(r.position.x, r.position.y, r.position.z);
    }
    s.player.step(dt);
    this.ownInvulnerable = Math.max(0, this.ownInvulnerable - dt);
    this.ownStun = s.player.active ? Math.max(0, this.ownStun - dt) : 0;
    // HP はホストの値に合わせる（減った分を被弾にする: 赤い光・ダメージの記録）。0 は撃墜の event で
    const hp = Math.max(1, net.ownHp);
    if (s.player.active && hp < s.player.hp) s.player.applyDamage(s.player.hp - hp);
  }

  /** 描画フレームごと: 他プレイヤーの表示上の位置（索敵・レーダー・名札） */
  updateRivals(samples: readonly RemoteSample[]): void {
    for (const r of this.rivalList) r.active = false;
    for (const smp of samples) {
      const r = this.rivals.get(smp.id);
      if (!r) continue;
      copy(r.position, smp.position);
      copy(r.prevPosition, smp.position);
      copy(r.velocity, smp.velocity);
      const q = smp.orientation;
      r.orientation.x = q.x;
      r.orientation.y = q.y;
      r.orientation.z = q.z;
      r.orientation.w = q.w;
      r.speed = smp.speed;
      r.active = smp.alive;
      r.hp = smp.hp;
      r.invulnerable = smp.invulnerable;
    }
  }

  /** フィードの今出す分（古いものから。5 秒・4 件） */
  activeFeed(): readonly FeedItem[] {
    const f = PVP_CONFIG.feed;
    while (this.feed.length > 0 && (this.feed[0]?.time ?? 0) < this.time - f.seconds)
      this.feed.shift();
    while (this.feed.length > f.maxItems) this.feed.shift();
    return this.feed;
  }

  handleEvent(e: Readonly<EventMsg>): void {
    const s = this.session;
    const c = s.combat;
    switch (e.kind) {
      case 'fire': {
        const r = this.rivals.get(e.a);
        if (r) r.firing = e.b === 1;
        break;
      }
      case 'hit': {
        this.hitsBy.set(e.a, (this.hitsBy.get(e.a) ?? 0) + 1);
        // 火花はここで表示している機体の上に（ホストの位置は表示より新しい）
        const p = e.b === this.localId ? s.aircraft.state.position : this.rivals.get(e.b)?.position;
        c.reportImpact(p?.x ?? e.x, p?.y ?? e.y, p?.z ?? e.z, true);
        if (e.a === this.localId) {
          c.hitMarkerTimer = HUD_CONFIG.hitMarkerSeconds;
          c.gun.hitCount++;
        }
        if (e.b === this.localId) s.player.flashTimer = AIRCRAFT_COMBAT.playerHitFlashSeconds;
        break;
      }
      case 'explode':
        this.missileView.explode(e.n, this.time);
        c.reportExplosion(e.x, e.y, e.z, e.b !== NOBODY, MISSILE_CONFIG.blastRadius);
        break;
      case 'kill': {
        if (e.b === this.localId) {
          s.markDown();
          this.downedBy = e.a === NOBODY ? null : e.a;
          this.downedAt = this.time;
        } else {
          const r = this.rivals.get(e.b);
          if (r) {
            r.active = false;
            r.firing = false;
            c.notifyDestroyed(r);
          }
        }
        if (e.a === this.localId && e.b !== this.localId) c.kills++;
        this.feed.push({ killer: e.a === NOBODY ? null : e.a, victim: e.b, time: this.time });
        break;
      }
      case 'flare': {
        const r = this.rivals.get(e.a);
        if (r && e.a !== this.localId) c.flares.release(r, TEAM_ENEMY);
        break;
      }
      case 'stun':
        if (e.a === this.localId) this.ownStun = Math.max(this.ownStun, e.n / 100);
        break;
      case 'respawn':
        if (e.a === this.localId) {
          // 初心者保護（5-4）: 最大 HP とミサイルの数をこの命の間だけ増やす（revived で満タンにする）
          const boost = (e.b & RESPAWN_BOOST) !== 0;
          const r = PVP_CONFIG.rookie;
          this.ownBoosted = boost;
          s.player.setMaxHp(Math.round(this.baseMaxHp * (boost ? r.hpScale : 1)));
          s.combat.missileAmmo.setCapacity(this.baseMissiles + (boost ? r.extraMissiles : 0));
          s.revived();
          this.ownInvulnerable = PVP_CONFIG.invulnerableSeconds;
        }
        break;
      default:
        break;
    }
  }
}

function copy(out: Vec3, v: Readonly<Vec3>): void {
  out.x = v.x;
  out.y = v.y;
  out.z = v.z;
}
