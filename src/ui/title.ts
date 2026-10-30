import './title.css';
import './save.css';
import { APP_SHELL_CONFIG } from '../data/app';
import { logoUrl, probeImage, resolveLogo, type ImageProbe } from './brand';
import { el } from './hud-dom';
import { createScreen, setScreenShown } from './screen';

/**
 * タイトル画面。背景は実際のシーン（デモカメラ）で、ここは文字だけの DOM。
 * ロゴは public/brand/logo.png があれば画像、無ければ「SkyRaid」のテキスト（4-10）。画面のどこをタップしても / Enter で開始。
 * 起動して最初に出すときだけ HUD の展開アニメ（枠の線が伸びて中身がフェードイン）。薄いスキャンライン。
 * 右下にパイロット名（3-1。未入力の初回起動では出さない）
 */
export class TitleScreen {
  readonly root: HTMLDivElement;
  private readonly pilot: HTMLDivElement;
  private readonly logo: HTMLDivElement;
  private shown = false;
  private deployed = false;

  constructor(
    parent: HTMLElement,
    private readonly onStart: () => void,
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
    el('div', 'title-prompt', root, 'タップ / Enter で開始');
    this.pilot = el('div', 'title-pilot', root);
    this.pilot.hidden = true;
    el('div', 'title-scanlines', root);
    root.addEventListener('click', this.start);
    window.addEventListener('keydown', this.onKeyDown);
    this.root = root;
    void resolveLogo(probe).then((kind) => {
      if (kind === 'image') this.showLogoImage();
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
      this.root.classList.add('is-deploying');
    }
    setScreenShown(this.root, shown);
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
