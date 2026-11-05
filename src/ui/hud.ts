import './hud.css';
import { HUD_ASSIST_CONFIG } from '../data/assist';
import { HUD_CONFIG } from '../data/hud';
import { applyCssVariables, el, gauge } from './hud-dom';
import type { HudFrame } from './hud-frame';
import { HudOrdnance } from './hud-ordnance';
import { HudAssist } from './hud-assist';
import { HudRadar } from './hud-radar';
import { HudWarnings } from './hud-warnings';
import { HudWeapons } from './hud-weapons';
import {
  attitudeFromQuat,
  changed,
  formatAltitude,
  formatSpeed,
  ladderRungs,
  ladderTransform,
  type Attitude,
  type LadderTransform,
} from './hud-math';

export type { HudFrame } from './hud-frame';

/**
 * 戦闘機風の HUD（DOM + CSS）。update() は毎フレーム呼んでよいが、
 * DOM は表示が変わったときだけ書き換える（テキストは文字列、位置・角度は epsilon 以上の変化）
 */
export class Hud {
  readonly root: HTMLDivElement;
  private shown = true;
  private compact = false;
  private readonly ladder: HTMLDivElement;
  private readonly fpm: HTMLDivElement;
  private readonly speedText: HTMLSpanElement;
  private readonly altText: HTMLSpanElement;
  private readonly throttleFill: HTMLDivElement;
  private readonly abFill: HTMLDivElement;
  private readonly heatFill: HTMLDivElement;
  private readonly killsText: HTMLSpanElement;
  private readonly hpFill: HTMLDivElement;
  private readonly radar: HudRadar;
  private readonly assist: HudAssist;
  private readonly weapons: HudWeapons;
  private readonly ordnance: HudOrdnance;
  private readonly notice: HTMLDivElement;
  private readonly warnings: HudWarnings;
  /** 機首の位置に合わせて動かす中央の印（9-5b） */
  private readonly noseAnchored: HTMLElement[];
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly attitude: Attitude = { pitch: 0, roll: 0, heading: 0 };
  private readonly ladderXf: LadderTransform = { rotateDeg: 0, offsetPx: 0 };
  // 前回書いた値。NaN / '' は「未表示」で、次の update() で必ず書く
  private last = {
    speed: '',
    alt: '',
    throttle: NaN,
    ab: NaN,
    abState: '',
    autoThr: false,
    gunOnly: false,
    pitch: NaN,
    roll: NaN,
    fpmX: NaN,
    fpmY: NaN,
    fpmShown: true,
    noseX: NaN,
    noseY: NaN,
    heat: NaN,
    hp: NaN,
    lowHp: false,
    missile: false,
    overheat: false,
    hit: false,
    kills: '',
  };

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'hud';
    applyCssVariables(root);
    this.root = root;

    // 中央: ピッチラダー（楕円の窓で切り抜き、中身を回す）と進行方向マーカー
    const window_ = el('div', 'hud-ladder-window', root);
    this.ladder = el('div', 'hud-ladder', window_);
    for (const deg of ladderRungs(HUD_CONFIG.ladder.stepDeg)) {
      const kind = deg === 0 ? 'is-horizon' : deg > 0 ? 'is-up' : 'is-down';
      const rung = el('div', `hud-rung ${kind}`, this.ladder);
      rung.style.setProperty('--deg', String(deg));
      const label = deg === 0 ? '' : String(Math.abs(deg));
      el('span', 'hud-rung-label', rung, label);
      el('span', 'hud-rung-line hud-rung-left', rung);
      el('span', 'hud-rung-gap', rung);
      el('span', 'hud-rung-line hud-rung-right', rung);
      el('span', 'hud-rung-label', rung, label);
    }
    this.fpm = el('div', 'hud-fpm', root);
    el('div', 'hud-hitmarker', root);
    el('div', 'hud-warn hud-stall', root, 'STALL');
    // 9-3: 宙返りに入るには速さが足りない（失速と同じ位置）
    el('div', 'hud-warn hud-loop-speed', root, 'NEED SPEED');
    this.warnings = new HudWarnings(root);
    el('div', 'hud-warn hud-missile', root, 'MISSILE');
    // お知らせ（自動ダウングレードなど）。画面上端の中央に数秒だけ出す
    this.notice = el('div', 'hud-notice', root);
    this.notice.hidden = true;

    // 左: スロットル・AB ゲージと速度
    const left = el('div', 'hud-side hud-left', root);
    const gauges = el('div', 'hud-gauges', left);
    // HP（2-3。残りが少ないと赤く点滅）
    this.hpFill = gauge(gauges, 'HP', 'hud-hp');
    this.throttleFill = gauge(gauges, 'THR', 'hud-thr');
    this.abFill = gauge(gauges, 'AB');
    // 機銃の熱ゲージ（オーバーヒートで赤く点滅）
    this.heatFill = gauge(gauges, 'GUN', 'hud-heat');
    // 索敵マーカー（中央のレイヤー）と残弾（ゲージ列の右）
    this.weapons = new HudWeapons(root, gauges);
    this.ordnance = new HudOrdnance(root, this.weapons.ammo, this.weapons.mslRow);
    const speedBox = el('div', 'hud-box', left);
    el('div', 'hud-box-label', speedBox, 'SPD');
    this.speedText = el('span', 'hud-box-value', speedBox);
    el('div', 'hud-box-unit', speedBox, 'm/s');

    // 右: 高度（海面基準）と地面接近警告
    const right = el('div', 'hud-side hud-right', root);
    const altBox = el('div', 'hud-box', right);
    el('div', 'hud-box-label', altBox, 'ALT');
    this.altText = el('span', 'hud-box-value', altBox);
    el('div', 'hud-box-unit', altBox, 'm');
    el('div', 'hud-warn hud-ground', right, 'PULL UP');
    const kills = el('div', 'hud-kills', right);
    el('span', 'hud-kills-label', kills, 'KILL');
    this.killsText = el('span', 'hud-kills-value', kills);

    // 下: レーダー（機首方向が上）。島の中心・敵機・自機を追うミサイル
    this.radar = new HudRadar(root);
    // 角度差の矢印・接近 / 離脱の色・BEHIND（4-12）
    this.assist = new HudAssist(root, this.weapons.distText);

    this.noseAnchored = Array.from(
      root.querySelectorAll<HTMLElement>(
        '.hud-ladder-window, .hud-assist-ring, .hud-hitmarker, .hud-range-warn',
      ),
    );
    parent.appendChild(root);

    const l = HUD_CONFIG;
    // 9-9b: 画面の大きさは測った body の大きさ（viewport-fit.ts の --app-width / --app-height）で見る。CSS の @container app と
    // 同じ基準（iOS で向きを変えた後に初期包含ブロック（@media の基準）が古い値のまま残っても、配置がずれない）
    const refreshCompact = (): void => {
      const w = document.body.clientWidth;
      const h = document.body.clientHeight;
      const compact = w > 0 && h > 0 && (w <= l.compactMaxWidth || h <= l.compactMaxHeight);
      if (compact === this.compact) return;
      this.compact = compact;
      root.classList.toggle('hud-compact', this.compact);
      // 1 度あたりの px が変わるので、ラダーを書き直す
      this.last.pitch = NaN;
    };
    refreshCompact();
    if (typeof ResizeObserver === 'function')
      new ResizeObserver(refreshCompact).observe(document.body);
    else window.addEventListener('resize', refreshCompact);
  }

  get visible(): boolean {
    return this.shown;
  }

  /** 武器関連の表示（GUN の熱・残弾・KILL・対象のマーカー・着弾予測点）を隠す（7-2 の事前修正: レース中） */
  setNoWeapons(on: boolean): void {
    this.root.classList.toggle('is-no-weapons', on);
  }

  setVisible(visible: boolean): void {
    this.shown = visible;
    this.root.hidden = !visible;
    // 隠している間は書き換えないので、再表示したら全部書き直す
    if (visible) this.invalidate();
  }

  toggle(): void {
    this.setVisible(!this.shown);
  }

  /** 9-5d: 機首の印のずれ（画面の中央から px）と狭い画面か。照準の近くに出す一言（hud-tip.ts）が使う */
  get nose(): { readonly x: number; readonly y: number; readonly compact: boolean } {
    const { noseX, noseY } = this.last;
    return { x: noseX || 0, y: noseY || 0, compact: this.compact };
  }

  /** 画面上端にお知らせを seconds 秒間出す（HUD を隠していると見えない） */
  showNotice(text: string, seconds: number): void {
    this.notice.textContent = text;
    this.notice.hidden = false;
    if (this.noticeTimer !== null) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.notice.hidden = true;
      this.noticeTimer = null;
    }, seconds * 1000);
  }

  update(f: Readonly<HudFrame>): void {
    if (!this.shown) return;
    const last = this.last;
    const eps = HUD_CONFIG.epsilon;

    const speed = formatSpeed(f.speed);
    if (speed !== last.speed) this.speedText.textContent = last.speed = speed;
    const alt = formatAltitude(f.y);
    if (alt !== last.alt) this.altText.textContent = last.alt = alt;

    if (changed(last.throttle, f.throttle, eps.gauge)) {
      last.throttle = f.throttle;
      this.throttleFill.style.transform = `scaleY(${f.throttle.toFixed(3)})`;
    }
    if (changed(last.ab, f.afterburnerGauge, eps.gauge)) {
      last.ab = f.afterburnerGauge;
      this.abFill.style.transform = `scaleY(${f.afterburnerGauge.toFixed(3)})`;
    }
    const abState = f.afterburnerLocked ? 'is-locked' : f.afterburnerActive ? 'is-active' : '';
    if (abState !== last.abState) {
      this.abFill.classList.remove('is-locked', 'is-active');
      if (abState) this.abFill.classList.add(abState);
      last.abState = abState;
    }

    // 9-5b: 速度合わせでスロットルを下げている間は THR を AUTO（橙）に
    if (f.speedMatching !== last.autoThr) {
      last.autoThr = f.speedMatching;
      this.root.classList.toggle('is-auto-thr', f.speedMatching);
    }

    if (f.gunOnly !== last.gunOnly) {
      last.gunOnly = f.gunOnly;
      this.root.classList.toggle('is-gun-only', f.gunOnly);
    }

    this.updateCombat(f);

    this.warnings.update(f);

    const att = attitudeFromQuat(this.attitude, f.orientation);
    if (
      changed(last.pitch, att.pitch, eps.angleDeg) ||
      changed(last.roll, att.roll, eps.angleDeg)
    ) {
      last.pitch = att.pitch;
      last.roll = att.roll;
      const ppd = this.compact ? HUD_CONFIG.ladder.compactPxPerDeg : HUD_CONFIG.ladder.pxPerDeg;
      const xf = ladderTransform(this.ladderXf, att.pitch, att.roll, ppd);
      this.ladder.style.transform = `rotate(${xf.rotateDeg.toFixed(2)}deg) translateY(${xf.offsetPx.toFixed(1)}px)`;
    }

    this.updateFlightPath(f.flightPath);
    this.updateNoseAnchor(f);
    this.radar.update(f.x, f.z, att.heading, f.radar);
  }

  private updateCombat(f: Readonly<HudFrame>): void {
    const last = this.last;
    if (changed(last.heat, f.gunHeat, HUD_CONFIG.epsilon.gauge)) {
      last.heat = f.gunHeat;
      this.heatFill.style.transform = `scaleY(${f.gunHeat.toFixed(3)})`;
    }
    if (f.gunOverheated !== last.overheat) {
      last.overheat = f.gunOverheated;
      this.root.classList.toggle('is-overheat', f.gunOverheated);
    }
    if (f.hitMarker !== last.hit) {
      last.hit = f.hitMarker;
      this.root.classList.toggle('is-hit', f.hitMarker);
    }
    const kills = String(f.kills);
    if (kills !== last.kills) this.killsText.textContent = last.kills = kills;
    const hp = f.maxHp > 0 ? f.hp / f.maxHp : 0;
    if (changed(last.hp, hp, HUD_CONFIG.epsilon.gauge)) {
      last.hp = hp;
      this.hpFill.style.transform = `scaleY(${hp.toFixed(3)})`;
    }
    const lowHp = hp < HUD_CONFIG.damage.lowHpRatio;
    if (lowHp !== last.lowHp) {
      last.lowHp = lowHp;
      this.root.classList.toggle('is-low-hp', lowHp);
    }
    if (f.missileWarning !== last.missile) {
      last.missile = f.missileWarning;
      this.root.classList.toggle('is-missile', f.missileWarning);
    }
    this.weapons.update(f.weapons);
    this.ordnance.update(f.ordnance);
    this.assist.update(f.assist, f.weapons.selected === 'screen');
  }

  private updateFlightPath(pos: { x: number; y: number } | null): void {
    const last = this.last;
    const shown = pos !== null;
    if (shown !== last.fpmShown) {
      last.fpmShown = shown;
      this.fpm.hidden = !shown;
    }
    if (!pos) return;
    const eps = HUD_CONFIG.epsilon.px;
    if (changed(last.fpmX, pos.x, eps) || changed(last.fpmY, pos.y, eps)) {
      last.fpmX = pos.x;
      last.fpmY = pos.y;
      this.fpm.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px)`;
    }
  }

  /**
   * 9-5b: 中央の印を機首（進行方向マーカー）の位置へ。カメラ（旋回の遅れ・ターゲットカメラの寄せ）が機首からずれても、補助の円と
   * ピッチラダーが機首を囲む。画面の端からはみ出さないよう、補助の円が収まる範囲までにする
   */
  private updateNoseAnchor(f: Readonly<HudFrame>): void {
    const last = this.last;
    let dx = 0;
    let dy = 0;
    const p = f.flightPath;
    if (p && f.viewWidth > 0 && f.viewHeight > 0) {
      const c = HUD_ASSIST_CONFIG;
      const margin =
        (this.compact ? c.compactRingRadius : c.ringRadius) + HUD_CONFIG.noseAnchorMargin;
      const hx = Math.max(0, f.viewWidth / 2 - margin);
      const hy = Math.max(0, f.viewHeight / 2 - margin);
      dx = Math.max(-hx, Math.min(hx, p.x - f.viewWidth / 2));
      dy = Math.max(-hy, Math.min(hy, p.y - f.viewHeight / 2));
    }
    const eps = HUD_CONFIG.epsilon.px;
    if (!changed(last.noseX, dx, eps) && !changed(last.noseY, dy, eps)) return;
    last.noseX = dx;
    last.noseY = dy;
    const t = `${dx.toFixed(1)}px ${dy.toFixed(1)}px`;
    for (const e of this.noseAnchored) e.style.translate = t;
  }

  private invalidate(): void {
    const last = this.last;
    last.speed = last.alt = last.kills = '';
    last.throttle = last.ab = last.heat = last.hp = last.pitch = last.roll = NaN;
    last.fpmX = last.fpmY = last.noseX = last.noseY = NaN;
    this.radar.invalidate();
    this.weapons.invalidate();
    this.ordnance.invalidate();
    this.assist.invalidate();
  }
}
