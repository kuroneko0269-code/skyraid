// 古いブラウザの案内（8-3）: アプリのモジュール（src/main.ts）が動くと <html data-app="started"> を付ける。
// 読み込みが終わっても付いていなければ、構文（ES2022）・モジュールを読めない古いブラウザとみなして案内を出す（真っ黒にしない）。
// どのブラウザでも動くよう ES5 だけで書く。文面と動作環境は src/data/compat.ts と同じ（変えたら両方）
(function () {
  'use strict';
  function show() {
    if (document.documentElement.getAttribute('data-app')) return;
    if (document.querySelector('.compat-notice')) return;
    var root = document.createElement('div');
    root.className = 'compat-notice';
    root.setAttribute('role', 'alert');
    var box = document.createElement('div');
    box.className = 'compat-notice-box';
    root.appendChild(box);
    function add(tag, cls, text) {
      var e = document.createElement(tag);
      e.className = cls;
      e.textContent = text;
      box.appendChild(e);
      return e;
    }
    add('div', 'compat-notice-app', 'SkyRaid: Titan Skies');
    add('h1', 'compat-notice-title', 'このブラウザは古いため起動できません');
    add(
      'p',
      'compat-notice-text',
      'ブラウザ（iPhone / iPad は iOS）を最新にするか、下の環境のブラウザで開いてください。',
    );
    add('h2', 'compat-notice-sub', '動作環境');
    var list = document.createElement('ul');
    list.className = 'compat-notice-list';
    var items = [
      'iPhone / iPad: iOS / iPadOS 16.4 以降の Safari',
      'Android: Chrome 105 以降',
      'パソコン: Chrome / Edge 105 以降・Safari 16.4 以降・Firefox 121 以降',
    ];
    for (var i = 0; i < items.length; i++) {
      var li = document.createElement('li');
      li.textContent = items[i];
      list.appendChild(li);
    }
    box.appendChild(list);
    add(
      'p',
      'compat-notice-note',
      'WebGL 2 が使えること（ブラウザのハードウェア アクセラレーションを ON）。推奨はノートパソコンの内蔵 GPU 以上・2020 年以降のスマホ',
    );
    document.body.appendChild(root);
  }
  // モジュールは読み込みの終わり（load）より前に動く。念のため少し待ってから確かめる
  window.addEventListener('load', function () {
    setTimeout(show, 500);
  });
})();
