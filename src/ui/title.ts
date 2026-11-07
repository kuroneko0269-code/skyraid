import { t } from '../core/i18n';
import './title.css';
import './save.css';
import { APP_VERSION } from 'virtual:app-info';
import { APP_SHELL_CONFIG } from '../data/app';
import { SCREEN_CONFIG } from '../data/screens';
import { coverActive, onCoverGone, signal } from '../core/viewport-cover';
import { visibleBox, type LogoBox } from '../core/cover-motion';
import { logoUrl, probeImage, resolveLogo, type ImageProbe } from './brand';
import { createGlyph } from './glyphs';
import { el } from './hud-dom';
import { createButton, createScreen, setScreenShown } from './screen';

/**
 * タイトル画面。背景は実際のシーン（デモカメラ）で、ここは文字だけの DOM。
 * ロゴは public/brand/logo.png があれば画像、無ければ「SkyRaid」のテキスト（4-10）。画面のどこをタップしても / Enter で開始。
 * 起動して最初に出すときだけ HUD の展開アニメ（枠の線が伸びて中身がフェードイン）。薄いスキャンライン。
 * 右下にパイロット名（3-1。未入力の初回起動では出さない）。右上に設定の歯車と版（7-D。歯車のタップは開始にしない）
 */
export class TitleScreen {
  readonly root: HTMLDivElement;
  private readonly pilot: HTMLDivElement;
  private readonly logo: HTMLDivElement;
  private shown = false;
  private deployed = false;
  /** 10-1b: 出した時刻（幕のロゴの着く先は、画面のフェードが済んでから） */
  private shownAt = 0;
  /** ロゴを画像にするか文字のままかが決まったか */
  private logoResolved = false;

  constructor(
    parent: HTMLElement,
    private readonly onStart: () => void,
    onSettings: () => void,
    probe: ImageProbe = probeImage,
  ) {
    const root = createScreen(parent, 'title-screen');
    root.style.setProperty('--title-deploy', `${APP_SHELL_CONFIG.titleDeploySeconds}s`);
    // HUD の枠: 上下の線と四隅の括弧
    const frame = el('div', 'title-frame', root);
    for (const part of [
      'rule-top',
      'rule-bottom',
      'corner-tl',
      'corner-tr',
      'corner-bl',
      'corner-br',
    ])
      el('span', `title-frame-${part}`, frame);
    this.logo = el('div', 'title-logo', root);
    el('span', 'title-logo-main', this.logo, 'SkyRaid');
    el('div', 'title-prompt', root, t('title.prompt'));
    this.pilot = el('div', 'title-pilot', root);
    this.pilot.hidden = true;
    el('div', 'title-scanlines', root);
    const corner = el('div', 'title-corner', root);
    el('span', 'title-version', corner, `v${APP_VERSION}`);
    const gear = createButton(corner, 'ui-button title-settings', '', onSettings);
    gear.setAttribute('aria-label', t('title.settings'));
    gear.appendChild(createGlyph('gear', 'title-settings-icon'));
    // 歯車のタップ・クリックは画面の「タップで開始」に渡さない
    gear.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    root.addEventListener('click', this.start);
    window.addEventListener('keydown', this.onKeyDown);
    this.root = root;
    void resolveLogo(probe).then((kind) => {
      if (kind === 'image') this.showLogoImage();
      this.logoResolved = true;
    });
  }

  /** 右下のパイロット名（null なら隠す） */
  setPilotName(name: string | null): void {
    this.pilot.textContent = name === null ? '' : `PILOT  ${name}`;
    this.pilot.hidden = name === null;
  }

  setShown(shown: boolean): void {
    this.shown = shown;
    // 展開アニメは起動して最初に出すときだけ（クラスを付けたままにして、2 回目以降は最後の状態のまま）
    if (shown && !this.deployed) {
      this.deployed = true;
      // 10-1: 起動の計測（scripts/perf.js がこの印より前に読み始めたものを「タイトルまでに読む量」に数える）
      performance.mark('skyraid:title');
      this.shownAt = performance.now();
      // 10-1b: 測り直しの幕の下で出したときは、展開アニメを幕が明けるときに回す。ロゴは幕のロゴが重なって着くので動かさない
      if (coverActive()) {
        const root = this.root;
        onCoverGone(() => {
          root.classList.add('is-deploying', 'is-logo-landed');
        });
      } else this.root.classList.add('is-deploying');
    }
    setScreenShown(this.root, shown);
  }

  /**
   * 10-1b: 幕のロゴの着く先（ロゴの画像か文字の見えている箱）。出ていない・ロゴが決まっていない・画面のフェードの途中なら null
   */
  landingBox(): LogoBox | null {
    if (!this.shown || !this.logoResolved) return null;
    if (performance.now() - this.shownAt < SCREEN_CONFIG.fadeSeconds * 1000) return null;
    const img = this.logo.querySelector('img');
    if (img)
      return img.naturalHeight > 0
        ? visibleBox(img.getBoundingClientRect(), img.naturalWidth / img.naturalHeight)
        : null;
    const main = this.logo.querySelector<HTMLElement>('.title-logo-main');
    return main ? visibleBox(main.getBoundingClientRect(), 0) : null;
  }

  /** 10-1c: 幕のロゴが重なって着いた: タイトルの文字にも短い乱れ（信号がつながった。幕のロゴと同時） */
  signalLanded(): void {
    signal(this.logo);
  }

  /** ロゴを画像に差し替える（読めると分かってから。テキストは読み上げ用に残す） */
  private showLogoImage(): void {
    const img = document.createElement('img');
    img.className = 'title-logo-image';
    img.src = logoUrl();
    img.alt = 'SkyRaid';
    img.draggable = false;
    this.logo.replaceChildren(img);
    this.logo.classList.add('has-image');
  }

  private readonly start = (): void => {
    if (this.shown) this.onStart();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.shown || e.repeat) return;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      this.start();
    }
  };
}
