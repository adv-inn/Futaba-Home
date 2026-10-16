/**
 * Futaba Static Page — Theme Switcher + i18n + Scroll Animations
 */

(function () {
  'use strict';

  // ========== Theme Management ==========

  var STORAGE_KEY = 'futaba-static-theme';
  var THEME_ORDER = ['clean-light', 'clean-dark', 'persona5'];

  // z-index lookup: for each active theme, assign z-index to all 3 cards
  // so that adjacent non-active card is always in front of the farther one
  var Z_INDEX_MAP = {
    'light': { 'light': 10, 'dark': 5, 'p5': 4 },
    'dark':  { 'light': 4, 'dark': 10, 'p5': 5 },
    'p5':    { 'light': 4, 'dark': 5, 'p5': 10 },
  };

  function getStoredTheme() {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'clean-light';
    } catch (e) {
      return 'clean-light';
    }
  }

  function applyTheme(themeName, skipAnimation) {
    var root = document.documentElement;

    // Remove all theme classes
    root.classList.remove('theme-persona5', 'theme-clean', 'dark');

    switch (themeName) {
      case 'persona5':
        root.classList.add('theme-persona5');
        break;
      case 'clean-light':
        root.classList.add('theme-clean');
        break;
      case 'clean-dark':
        root.classList.add('theme-clean', 'dark');
        break;
    }

    // background-color is driven by CSS theme classes + transition
    // Clear any inline backgroundColor so CSS takes over
    if (!skipAnimation) {
      root.style.removeProperty('background-color');
    }

    // Persist choice
    try {
      localStorage.setItem(STORAGE_KEY, themeName);
    } catch (e) {
      // localStorage unavailable
    }

    // Update cascade cards — active card + dynamic z-index
    var cascadeMap = { 'clean-light': 'light', 'clean-dark': 'dark', 'persona5': 'p5' };
    var activeKey = cascadeMap[themeName];
    var zMap = Z_INDEX_MAP[activeKey];
    document.querySelectorAll('.cascade-card').forEach(function (card) {
      var key = card.dataset.theme;
      var isActive = key === activeKey;
      var wasActive = card.classList.contains('active');
      // Only re-trigger pop animation when newly becoming active
      if (isActive && !wasActive && !skipAnimation) {
        card.style.animation = 'none';
        // Force reflow to restart animation
        void card.offsetWidth;
        card.style.animation = '';
      }
      card.classList.toggle('active', isActive);
      card.style.zIndex = zMap[key];
    });
  }

  function cycleTheme(direction) {
    var current = getStoredTheme();
    var idx = THEME_ORDER.indexOf(current);
    if (idx === -1) idx = 0;
    var next = (idx + direction + THEME_ORDER.length) % THEME_ORDER.length;
    applyTheme(THEME_ORDER[next]);
  }

  // ========== Download Card + Mirror Switcher ==========

  var MIRROR_KEY = 'futaba-static-mirror';
  // Mirror prefix is prepended to the FULL GitHub URL (gh-proxy style):
  //   https://gh-proxy.com/https://github.com/adv-inn/Futaba/releases/download/...
  var MIRRORS = {
    github:  { prefix: '' },
    ghproxy: { prefix: 'https://gh-proxy.com/' },
  };
  var ASSETS = ['installer', 'portable_exe', 'portable_zip'];
  var ASSET_ELEMENT_IDS = {
    installer: 'downloadPrimary',
    portable_exe: 'downloadPortableExe',
    portable_zip: 'downloadPortableZip',
  };
  // GitHub canonical URLs from version.json (always rewritten from this)
  var canonicalUrls = null;
  var canonicalVersion = null;

  function getStoredMirror() {
    try {
      var v = localStorage.getItem(MIRROR_KEY);
      return MIRRORS[v] ? v : 'github';
    } catch (e) {
      return 'github';
    }
  }

  function rewriteUrl(githubUrl, mirror) {
    if (!githubUrl) return '#';
    if (!MIRRORS[mirror]) return githubUrl;
    // Only rewrite real github.com download URLs; leave anything else alone.
    if (githubUrl.indexOf('https://github.com/') !== 0) return githubUrl;
    return MIRRORS[mirror].prefix + githubUrl;
  }

  function applyDownloadLinks(mirror) {
    if (!canonicalUrls) return;
    ASSETS.forEach(function (asset) {
      var el = document.getElementById(ASSET_ELEMENT_IDS[asset]);
      if (!el) return;
      var url = canonicalUrls[asset];
      if (!url) { el.removeAttribute('href'); return; }
      el.href = rewriteUrl(url, mirror);
    });
  }

  function setMirror(mirror) {
    if (!MIRRORS[mirror]) mirror = 'github';
    try { localStorage.setItem(MIRROR_KEY, mirror); } catch (e) {}
    document.querySelectorAll('#mirrorSwitcher button').forEach(function (btn) {
      var isActive = btn.dataset.mirror === mirror;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    applyDownloadLinks(mirror);
  }

  function setDownloadStatus(message) {
    var el = document.getElementById('downloadStatus');
    if (!el) return;
    if (message) {
      el.textContent = message;
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  }

  function applyVersionLabels() {
    var versionTag = document.getElementById('downloadVersion');
    var footerVersion = document.getElementById('footerVersion');
    var label = canonicalVersion ? 'v' + canonicalVersion : '';
    if (versionTag) versionTag.textContent = label;
    if (footerVersion) footerVersion.textContent = label;
  }

  function loadVersionData() {
    // Cache-bust with a coarse hourly key so users see fresh releases without
    // hammering the CDN. fetch() respects the Pages cache headers either way.
    var cacheKey = Math.floor(Date.now() / 3600000);
    return fetch('./version.json?t=' + cacheKey, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        canonicalVersion = data.version || null;
        canonicalUrls = (data.download && typeof data.download === 'object') ? data.download : null;
        applyVersionLabels();
        applyDownloadLinks(getStoredMirror());
      })
      .catch(function (err) {
        // Fallback: keep the static GitHub /releases links and surface a hint.
        canonicalVersion = null;
        canonicalUrls = null;
        applyVersionLabels();
        var dict = LANGS[getStoredLang()] || LANGS.zh;
        setDownloadStatus(dict['download.error'] || 'Failed to load version info.');
        // eslint-disable-next-line no-console
        console.warn('[futaba-home] version.json load failed:', err);
      });
  }

  // ---- Download count (GitHub Releases API, all versions summed) ----

  var RELEASES_API = 'https://api.github.com/repos/adv-inn/futaba/releases?per_page=100';
  var totalDownloads = null;

  function applyDownloadCount(lang) {
    var el = document.getElementById('downloadCount');
    if (!el) return;
    if (totalDownloads === null) { el.hidden = true; return; }
    var dict = LANGS[lang || getStoredLang()] || LANGS.zh;
    document.getElementById('downloadCountText').textContent =
      dict['download.count'].replace('{n}', totalDownloads.toLocaleString('en-US'));
    el.hidden = false;
  }

  function loadDownloadCount() {
    return fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (releases) {
        totalDownloads = releases.reduce(function (sum, rel) {
          return sum + (rel.assets || []).reduce(function (s, a) {
            return /\.(exe|zip)$/i.test(a.name) ? s + a.download_count : s;
          }, 0);
        }, 0);
        applyDownloadCount();
      })
      .catch(function (err) {
        // Stat line stays hidden; the card works fine without it.
        // eslint-disable-next-line no-console
        console.warn('[futaba-home] releases API load failed:', err);
      });
  }

  function initDownloadCard() {
    var switcher = document.getElementById('mirrorSwitcher');
    if (switcher) {
      switcher.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-mirror]');
        if (!btn) return;
        setMirror(btn.dataset.mirror);
      });
    }
    // Initialize mirror state immediately so UI reflects the stored choice
    // even before version.json finishes loading.
    setMirror(getStoredMirror());
    loadVersionData();
    loadDownloadCount();
  }

  // ========== i18n ==========

  var LANG_KEY = 'futaba-static-lang';
  var LANGS = {
    zh: {
      'hero.subtitle': '一款使用 Tauri 开发的支持双端操作的英雄联盟客户端，简洁，高效',
      'features.title': 'Features',
      'features.subtitle': '从选人阶段到对局结束，全流程智能辅助',
      // Feature cards
      'feature.accept.title': '自动接受对局',
      'feature.accept.desc': '匹配成功后自动接受对局，无需手动操作，再也不会错过匹配',
      'feature.history.title': '战绩查询',
      'feature.history.desc': '查看详细对局历史记录，KDA、伤害、装备一应俱全，还能一键生成战绩分享图',
      'feature.friends.title': '好友交互',
      'feature.friends.desc': '聊天、邀请好友组队、预约邀请，社交功能一应俱全',
      'feature.opgg.title': 'OP.GG 集成',
      'feature.opgg.desc': '自动应用版本强势出装、符文和召唤师技能，支持排位、大乱斗、斗魂竞技场等多模式',
      'feature.counter.title': 'Counter 对位分析',
      'feature.counter.desc': '自动计算选中英雄的克制与被克制关系，经典模式下展示对位推荐',
      'feature.ai.title': 'AI 智能分析',
      'feature.ai.desc': 'AI 实时局势分析与出装推荐，对局结束后提供复盘评价与改进建议',
      'feature.hextech.title': '海克斯识别',
      'feature.hextech.desc': '海克斯大乱斗 / 斗魂竞技场开局截屏 OCR 识别三张强化卡，叠加 OP.GG 梯队与选取率',
      'feature.overlay.title': '游戏内悬浮窗',
      'feature.overlay.desc': '透明无边框悬浮窗覆盖在游戏画面上，快捷键一键切换，不影响游戏操作',
      'feature.mobile.title': '移动端支持',
      'feature.mobile.desc': '局域网数据共享，手机扫码即可操控选人、查看出装和海克斯推荐',
      // Showcase sections
      'showcase.app.title': '主程序',
      'showcase.app.subtitle': '启动英雄联盟客户端后，使用 Futaba 接管所有其他功能',
      'showcase.opgg.title': 'OP.GG 集成',
      'showcase.opgg.subtitle': '自动应用版本强势装备与符文，经典模式展示 Counter 对位推荐，大乱斗展示海克斯强化',
      'showcase.mobile.title': '移动端',
      'showcase.mobile.subtitle': '局域网内扫码访问，接受对局、抢英雄、查出装，拿外卖上厕所也不耽误',
      // Highlights + Share showcase
      'highlights.title': '核心功能',
      'highlights.subtitle': 'Futaba 最想让你看到的三件事',
      'highlight.hextech.title': '海克斯强化识别',
      'highlight.hextech.desc': '海克斯大乱斗与斗魂竞技场的强化选项，客户端 API 根本不提供。Futaba 直接截屏 OCR 识别三张卡牌，匹配 OP.GG 数据，把梯队、选取率和强度叠在每张卡牌下方，选强化不再靠猜。',
      'highlight.hextech.p1': '纯屏幕识别，不读取游戏内存，不改游戏文件',
      'highlight.hextech.p2': '三张卡牌各自独立浮窗，位置跟随卡牌',
      'highlight.hextech.p3': '支持海克斯大乱斗与斗魂竞技场',
      'highlight.opgg.title': 'OP.GG 深度兼容',
      'highlight.opgg.desc': '排位、大乱斗、海克斯大乱斗、斗魂竞技场，全模式接入 OP.GG 实时数据。英雄梯队、胜率、出装、符文、海克斯强化推荐，选人阶段一键应用，进游戏直接开打。',
      'highlight.opgg.p1': '版本强势出装 / 符文 / 召唤师技能自动应用',
      'highlight.opgg.p2': '经典模式 Counter 对位，大乱斗 ARAM 平衡调整',
      'highlight.opgg.p3': '海克斯强化按稀有度分级，S / A 梯队一目了然',
      'highlight.mobile.title': '移动端适配',
      'highlight.mobile.desc': '局域网开启数据共享，手机扫码即可打开 Futaba Mobile。接受对局、抢英雄、看出装、查海克斯推荐，离开电脑也不耽误。',
      'highlight.mobile.p1': '无需安装 App，浏览器扫码直达',
      'highlight.mobile.p2': 'mDNS 广播，记住 futaba.local 一个地址就够',
      'highlight.mobile.p3': '远程操作可单独关闭，只在可信网络使用',
      'showcase.share.title': '战绩分享',
      'showcase.share.subtitle': '对局结束一键生成分享图，单人战绩或多人同框，带皮肤原画、海克斯选择与队内占比',
      // Tech + Footer
      'tech.title': 'Tech Stack',
      'tech.subtitle': '现代技术栈，原生性能',
      'footer.tribute': 'Inspired by Persona 5 — "Take Your Heart"',
      'footer.mirror_thanks': '国内镜像加速由',
      'footer.mirror_thanks_suffix': '提供，感谢开源项目',
      // Download card
      'download.mirror': '镜像源',
      'download.mirror.github': 'GitHub',
      'download.mirror.ghproxy': '国内镜像',
      'download.installer': '下载安装版',
      'download.portable_exe': '便携版 EXE',
      'download.portable_zip': '便携版 ZIP',
      'download.error': '版本信息加载失败，将跳转至 GitHub Releases',
      'download.count': '累计下载 {n} 次',
    },
    en: {
      'hero.subtitle': 'A dual-platform League of Legends client built with Tauri — simple and efficient',
      'features.title': 'Features',
      'features.subtitle': 'Intelligent assistance from champion select to post-game',
      // Feature cards
      'feature.accept.title': 'Auto Accept',
      'feature.accept.desc': 'Automatically accept matches when a game is found — never miss a queue pop again',
      'feature.history.title': 'Match History',
      'feature.history.desc': 'Browse detailed match history with KDA, damage and builds, and generate a share card in one click',
      'feature.friends.title': 'Friends & Social',
      'feature.friends.desc': 'Chat, invite friends to party, schedule invites — all social features in one place',
      'feature.opgg.title': 'OP.GG Integration',
      'feature.opgg.desc': 'Auto-apply meta builds, runes, and summoner spells across Ranked, ARAM, Arena, and more',
      'feature.counter.title': 'Counter Analysis',
      'feature.counter.desc': 'Automatically calculate counter and favorable matchups for your selected champion',
      'feature.ai.title': 'AI Analysis',
      'feature.ai.desc': 'Real-time AI situation analysis and build advice, plus post-game review with improvement tips',
      'feature.hextech.title': 'Hextech Recognition',
      'feature.hextech.desc': 'OCR the three augment cards in Hextech ARAM and Arena, overlay OP.GG tier and pick rate on each',
      'feature.overlay.title': 'In-Game Overlay',
      'feature.overlay.desc': 'Transparent borderless overlay on top of the game, toggle with a hotkey without interrupting gameplay',
      'feature.mobile.title': 'Mobile Support',
      'feature.mobile.desc': 'LAN data sharing — scan QR code on your phone to pick champions, view builds, and more',
      // Showcase sections
      'showcase.app.title': 'Main App',
      'showcase.app.subtitle': 'Launch the LoL client, then let Futaba handle everything else',
      'showcase.opgg.title': 'OP.GG Integration',
      'showcase.opgg.subtitle': 'Auto-apply meta builds and runes, show counter matchups in Classic mode, augments in ARAM',
      'showcase.mobile.title': 'Mobile',
      'showcase.mobile.subtitle': 'Scan to access on your local network — accept matches, pick champions, and check builds on the go',
      // Highlights + Share showcase
      'highlights.title': 'Highlights',
      'highlights.subtitle': 'The three things Futaba does best',
      'highlight.hextech.title': 'Hextech Augment Recognition',
      'highlight.hextech.desc': 'The LoL client API never exposes the augment picker in Hextech ARAM and Arena. Futaba screenshots the three cards, OCRs their names, matches them against OP.GG data and overlays tier, pick rate and strength right under each card. No more guessing.',
      'highlight.hextech.p1': 'Pure screen capture + OCR — no memory reading, no game file changes',
      'highlight.hextech.p2': 'One independent overlay per card, anchored to the card',
      'highlight.hextech.p3': 'Works in Hextech ARAM and Arena',
      'highlight.opgg.title': 'Deep OP.GG Integration',
      'highlight.opgg.desc': 'Ranked, ARAM, Hextech ARAM and Arena all pull live OP.GG data. Champion tiers, win rates, builds, runes and augment picks — applied with one click in champion select.',
      'highlight.opgg.p1': 'Auto-apply meta builds, runes and summoner spells',
      'highlight.opgg.p2': 'Counter matchups in Classic, balance changes in ARAM',
      'highlight.opgg.p3': 'Augments graded by rarity with S / A tiers at a glance',
      'highlight.mobile.title': 'Built for Mobile',
      'highlight.mobile.desc': 'Turn on LAN sharing, scan the QR code and Futaba Mobile opens on your phone. Accept matches, lock in champions, check builds and augment picks — even away from your desk.',
      'highlight.mobile.p1': 'No app to install — scan and go',
      'highlight.mobile.p2': 'mDNS broadcast: one address to remember, futaba.local',
      'highlight.mobile.p3': 'Remote control can be switched off separately on untrusted networks',
      'showcase.share.title': 'Share Cards',
      'showcase.share.subtitle': 'Generate a share image after any match — solo or up to five players, with skin splash, augment picks and team share',
      // Tech + Footer
      'tech.title': 'Tech Stack',
      'tech.subtitle': 'Modern stack, native performance',
      'footer.tribute': 'Inspired by Persona 5 — "Take Your Heart"',
      'footer.mirror_thanks': 'China-region mirror powered by',
      'footer.mirror_thanks_suffix': '— thanks to the open-source project',
      // Download card
      'download.mirror': 'Mirror',
      'download.mirror.github': 'GitHub',
      'download.mirror.ghproxy': 'China Mirror',
      'download.installer': 'Download Installer',
      'download.portable_exe': 'Portable EXE',
      'download.portable_zip': 'Portable ZIP',
      'download.error': 'Failed to fetch release info — falling back to GitHub Releases',
      'download.count': '{n} downloads',
    },
    ja: {
      'hero.subtitle': 'Tauri で開発されたデュアルプラットフォーム対応の LoL クライアント — シンプルで高効率',
      'features.title': 'Features',
      'features.subtitle': 'チャンピオン選択から試合終了まで、全行程をスマートにサポート',
      // Feature cards
      'feature.accept.title': '自動マッチ承認',
      'feature.accept.desc': 'マッチング成功後に自動で対戦を承認。手動操作不要で、マッチを見逃しません',
      'feature.history.title': '戦績検索',
      'feature.history.desc': 'KDA、ダメージ、アイテムを含む詳細な試合履歴を閲覧し、ワンクリックで戦績シェア画像を生成',
      'feature.friends.title': 'フレンド機能',
      'feature.friends.desc': 'チャット、フレンド招待、予約招待など、ソーシャル機能が充実',
      'feature.opgg.title': 'OP.GG 連携',
      'feature.opgg.desc': 'メタビルド・ルーン・サモナースペルを自動適用。ランク・ARAM・アリーナなど複数モードに対応',
      'feature.counter.title': 'カウンター分析',
      'feature.counter.desc': '選択チャンピオンのカウンターと有利マッチアップを自動計算',
      'feature.ai.title': 'AI 分析',
      'feature.ai.desc': 'AIによるリアルタイム局勢分析とビルド提案、試合後の振り返りと改善アドバイス',
      'feature.hextech.title': 'ヘクステック認識',
      'feature.hextech.desc': 'ヘクステック大乱闘 / アリーナで 3 枚の強化カードを OCR 認識し、OP.GG ティアとピック率を重ねて表示',
      'feature.overlay.title': 'ゲーム内オーバーレイ',
      'feature.overlay.desc': '透明なボーダーレスオーバーレイをゲーム画面上に表示。ホットキーで切り替え、操作を妨げません',
      'feature.mobile.title': 'モバイル対応',
      'feature.mobile.desc': 'LAN共有でスマホからQRスキャン。チャンピオン選択・ビルド確認・ヘクステック推薦をモバイルで',
      // Showcase sections
      'showcase.app.title': 'メインアプリ',
      'showcase.app.subtitle': 'LoLクライアント起動後、Futabaがすべての機能を引き継ぎます',
      'showcase.opgg.title': 'OP.GG 連携',
      'showcase.opgg.subtitle': 'メタビルドとルーンを自動適用、クラシックモードでカウンター表示、ARAMでオーグメント表示',
      'showcase.mobile.title': 'モバイル',
      'showcase.mobile.subtitle': 'LAN内でQRスキャン。対戦承認・チャンピオン選択・ビルド確認を外出先でも',
      // Highlights + Share showcase
      'highlights.title': '主な機能',
      'highlights.subtitle': 'Futaba が最も得意とする 3 つのこと',
      'highlight.hextech.title': 'ヘクステック強化の認識',
      'highlight.hextech.desc': 'ヘクステック大乱闘とアリーナの強化選択は、クライアント API では取得できません。Futaba は画面上の 3 枚のカードを OCR で読み取り、OP.GG データと照合してティア・ピック率・強度を各カードの直下に重ねて表示します。',
      'highlight.hextech.p1': '画面キャプチャ + OCR のみ。メモリ読み取りやゲームファイルの改変なし',
      'highlight.hextech.p2': 'カードごとに独立したオーバーレイ、位置はカードに追従',
      'highlight.hextech.p3': 'ヘクステック大乱闘とアリーナに対応',
      'highlight.opgg.title': 'OP.GG との深い連携',
      'highlight.opgg.desc': 'ランク・ARAM・ヘクステック大乱闘・アリーナ、全モードで OP.GG のライブデータを取得。ティア・勝率・ビルド・ルーン・強化のおすすめを、チャンピオン選択中にワンクリックで適用。',
      'highlight.opgg.p1': 'メタビルド / ルーン / サモナースペルを自動適用',
      'highlight.opgg.p2': 'クラシックではカウンター、ARAM ではバランス調整を表示',
      'highlight.opgg.p3': '強化はレアリティ別、S / A ティアが一目でわかる',
      'highlight.mobile.title': 'モバイル対応',
      'highlight.mobile.desc': 'LAN 共有をオンにして QR をスキャンするだけで Futaba Mobile が開きます。試合の承認、チャンピオンの確保、ビルドや強化の確認を、PC から離れていても。',
      'highlight.mobile.p1': 'アプリのインストール不要、スキャンするだけ',
      'highlight.mobile.p2': 'mDNS 配信、futaba.local の 1 つのアドレスで OK',
      'highlight.mobile.p3': 'リモート操作は個別にオフにでき、信頼できるネットワークだけで使用可能',
      'showcase.share.title': '戦績シェア',
      'showcase.share.subtitle': '試合後にワンクリックでシェア画像を生成。ソロでも最大 5 人でも、スキンイラスト・強化選択・チーム内割合つき',
      // Tech + Footer
      'tech.title': 'Tech Stack',
      'tech.subtitle': 'モダンな技術スタック、ネイティブパフォーマンス',
      'footer.tribute': 'Inspired by Persona 5 — "Take Your Heart"',
      'footer.mirror_thanks': '中国向けミラーは',
      'footer.mirror_thanks_suffix': 'が提供、オープンソースプロジェクト',
      // Download card
      'download.mirror': 'ミラー',
      'download.mirror.github': 'GitHub',
      'download.mirror.ghproxy': '国内ミラー',
      'download.installer': 'インストーラー',
      'download.portable_exe': 'ポータブル EXE',
      'download.portable_zip': 'ポータブル ZIP',
      'download.error': 'バージョン情報の取得に失敗しました。GitHub Releases にリダイレクトします',
      'download.count': '累計 {n} ダウンロード',
    },
  };

  function getStoredLang() {
    try {
      return localStorage.getItem(LANG_KEY) || 'zh';
    } catch (e) {
      return 'zh';
    }
  }

  function applyLang(lang) {
    var dict = LANGS[lang];
    if (!dict) return;

    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang === 'ja' ? 'ja' : 'en';

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.dataset.i18n;
      if (dict[key] !== undefined) {
        el.textContent = dict[key];
      }
    });

    applyDownloadCount(lang);

    // Update lang switcher buttons
    document.querySelectorAll('#langSwitcher button').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });

    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch (e) {
      // localStorage unavailable
    }
  }

  // ========== Scroll Reveal (IntersectionObserver) ==========

  function initScrollReveal() {
    var elements = document.querySelectorAll('.scroll-reveal');
    if (!elements.length) return;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );

    elements.forEach(function (el) { observer.observe(el); });
  }

  // ========== Smooth Scroll for Anchor Links ==========

  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        var target = document.querySelector(link.getAttribute('href'));
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  // ========== Init ==========

  function init() {
    // Bind cascade nav buttons
    var prevBtn = document.getElementById('cascadePrev');
    var nextBtn = document.getElementById('cascadeNext');
    if (prevBtn) prevBtn.addEventListener('click', function () { cycleTheme(-1); });
    if (nextBtn) nextBtn.addEventListener('click', function () { cycleTheme(1); });

    // Bind language switcher
    document.querySelectorAll('#langSwitcher button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyLang(btn.dataset.lang);
      });
    });

    // Apply stored theme — skip animation on initial load
    applyTheme(getStoredTheme(), true);

    // Apply stored language
    applyLang(getStoredLang());

    // Init download card (mirror switcher + version.json)
    initDownloadCard();

    // Init scroll animations
    initScrollReveal();

    // Init smooth scroll
    initSmoothScroll();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
