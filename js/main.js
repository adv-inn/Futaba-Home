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
  var LINE_KEY = 'futaba-static-mirror-line';
  // Download channels. 'ghproxy' keeps its old name so stored choices survive.
  var MIRRORS = { github: true, ghproxy: true, lanzou: true };
  var LANZOU_URL = 'https://wwbgt.lanzout.com/b01i61l0ti';
  var LANZOU_PASSWORD = '4zy4';
  var RELEASES_PAGE = 'https://github.com/adv-inn/futaba/releases';
  // Same line set as the app (futaba-core github_mirror.rs MIRRORS).
  // Mirror URL = prefix + original URL with `strip` removed from its head.
  var MIRROR_LINES = [
    { id: 'gh-proxy.com', prefix: 'https://gh-proxy.com/', strip: '' },
    { id: 'gh-proxy.org', prefix: 'https://gh-proxy.org/', strip: '' },
    { id: 'v4.gh-proxy.org', prefix: 'https://v4.gh-proxy.org/', strip: '' },
    { id: 'v6.gh-proxy.org', prefix: 'https://v6.gh-proxy.org/', strip: '' },
    { id: 'cdn.gh-proxy.org', prefix: 'https://cdn.gh-proxy.org/', strip: '' },
    { id: 'axisnow.gh-proxy.org', prefix: 'https://axisnow.gh-proxy.org/', strip: '' },
    { id: 'xget', prefix: 'https://xget.xi-xu.me/gh/', strip: 'https://github.com/' },
  ];
  // Probe parameters match the app: 512KB per line, 6s per line, all concurrent.
  var PROBE_BYTES = 512 * 1024;
  var PROBE_TIMEOUT_MS = 6000;
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

  // ---- Mirror lines: speed test + selection ----

  // id -> bytes/s (number) | null (failed / timed out); absent = not measured yet
  var lineSpeeds = {};
  var probeStarted = false;

  function getStoredLine() {
    try {
      var v = localStorage.getItem(LINE_KEY);
      return findLine(v) ? v : 'auto';
    } catch (e) {
      return 'auto';
    }
  }

  function findLine(id) {
    return MIRROR_LINES.filter(function (l) { return l.id === id; })[0] || null;
  }

  function lineUrl(line, githubUrl) {
    // Only rewrite real github.com URLs; leave anything else alone.
    if (githubUrl.indexOf('https://github.com/') !== 0) return githubUrl;
    return line.prefix + githubUrl.slice(line.strip.length);
  }

  // Measured lines first by speed; failed / unmeasured keep default order at the end
  // (a failed probe may be a blip — still worth a try, same as the app's rank()).
  function rankedLines() {
    var speed = function (l) { return typeof lineSpeeds[l.id] === 'number' ? lineSpeeds[l.id] : -1; };
    return MIRROR_LINES.slice().sort(function (a, b) { return speed(b) - speed(a); });
  }

  function currentLine() {
    return findLine(getStoredLine()) || rankedLines()[0];
  }

  // Resolves to bytes/s including time-to-first-byte, or null on error / timeout.
  // Plain GET (no Range header) keeps it a CORS simple request; we stop reading
  // once the sample is full and abort the rest of the transfer.
  function probeLine(line, githubUrl) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, PROBE_TIMEOUT_MS);
    var started = performance.now();
    return fetch(lineUrl(line, githubUrl), { signal: ctrl.signal, cache: 'no-store' })
      .then(function (r) {
        if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
        var reader = r.body.getReader();
        var received = 0;
        function pump() {
          return reader.read().then(function (chunk) {
            if (!chunk.done) received += chunk.value.length;
            return chunk.done || received >= PROBE_BYTES ? received : pump();
          });
        }
        return pump();
      })
      .then(function (received) {
        clearTimeout(timer);
        ctrl.abort();
        return received > 0 ? received / Math.max((performance.now() - started) / 1000, 1e-3) : null;
      })
      .catch(function () {
        clearTimeout(timer);
        return null;
      });
  }

  function startLineProbe() {
    if (probeStarted || !canonicalUrls || !canonicalUrls.installer) return;
    if (!window.fetch || !window.AbortController || !window.ReadableStream) return;
    probeStarted = true;
    renderLineOptions();
    MIRROR_LINES.forEach(function (line) {
      probeLine(line, canonicalUrls.installer).then(function (speed) {
        lineSpeeds[line.id] = speed;
        renderLineOptions();
        applyDownloadLinks(getStoredMirror());
      });
    });
  }

  function formatSpeed(bytesPerSec, dict) {
    if (bytesPerSec === null) return dict['download.line.failed'];
    if (bytesPerSec === undefined) return probeStarted ? dict['download.line.testing'] : '';
    var mb = bytesPerSec / (1024 * 1024);
    return mb >= 1 ? mb.toFixed(1) + ' MB/s' : Math.round(bytesPerSec / 1024) + ' KB/s';
  }

  function renderLineOptions(lang) {
    var select = document.getElementById('mirrorLine');
    if (!select) return;
    var dict = LANGS[lang || getStoredLang()] || LANGS.zh;
    var best = rankedLines()[0];
    var bestSpeed = lineSpeeds[best.id];
    var autoText = dict['download.line.auto'] +
      (typeof bestSpeed === 'number' ? ' · ' + best.id + ' ' + formatSpeed(bestSpeed, dict) : '');
    var options = [{ value: 'auto', text: autoText }].concat(MIRROR_LINES.map(function (l) {
      var s = formatSpeed(lineSpeeds[l.id], dict);
      return { value: l.id, text: s ? l.id + ' · ' + s : l.id };
    }));
    select.innerHTML = '';
    options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.text;
      select.appendChild(opt);
    });
    select.value = getStoredLine();
  }

  function setLine(id) {
    try { localStorage.setItem(LINE_KEY, findLine(id) ? id : 'auto'); } catch (e) {}
    applyDownloadLinks(getStoredMirror());
  }

  // ---- Channels ----

  // githubUrl is null until version.json loads (or if it failed): fall back to
  // the Releases page, which is never routed through a mirror.
  function channelUrl(githubUrl, mirror) {
    if (mirror === 'lanzou') return LANZOU_URL;
    if (!githubUrl) return RELEASES_PAGE;
    return mirror === 'ghproxy' ? lineUrl(currentLine(), githubUrl) : githubUrl;
  }

  function applyDownloadLinks(mirror) {
    ASSETS.forEach(function (asset) {
      var el = document.getElementById(ASSET_ELEMENT_IDS[asset]);
      if (el) el.href = channelUrl(canonicalUrls && canonicalUrls[asset], mirror);
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
    var card = document.getElementById('downloadCard');
    if (card) card.dataset.channel = mirror;
    // Lanzou is a share page, not a file: open it in a new tab.
    var primary = document.getElementById('downloadPrimary');
    if (primary && mirror === 'lanzou') {
      primary.target = '_blank';
      primary.rel = 'noopener noreferrer';
    } else if (primary) {
      primary.removeAttribute('target');
      primary.removeAttribute('rel');
    }
    applyDownloadLinks(mirror);
    if (mirror === 'ghproxy') startLineProbe();
  }

  function copyLanzouPassword() {
    var btn = document.getElementById('lanzouCopy');
    if (!btn || !navigator.clipboard) return;
    navigator.clipboard.writeText(LANZOU_PASSWORD).then(function () {
      var dict = LANGS[getStoredLang()] || LANGS.zh;
      btn.textContent = dict['download.lanzou.copied'];
      setTimeout(function () { btn.textContent = dict['download.lanzou.copy']; }, 1500);
    });
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
        if (getStoredMirror() === 'ghproxy') startLineProbe();
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

  // ---- Download count ----
  // stats.json is refreshed every 6h by .github/workflows/stats.yml (sum of all .exe / .zip
  // release assets). Calling the GitHub API from the browser hit the 60/h-per-IP anonymous
  // limit and is unreliable from China; when it failed, the whole line disappeared.

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
    var cacheKey = Math.floor(Date.now() / 3600000);
    return fetch('./stats.json?t=' + cacheKey, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        totalDownloads = typeof data.downloads === 'number' ? data.downloads : null;
        applyDownloadCount();
      })
      .catch(function (err) {
        // Stat line stays hidden; the card works fine without it.
        // eslint-disable-next-line no-console
        console.warn('[futaba-home] stats.json load failed:', err);
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
    var lineSelect = document.getElementById('mirrorLine');
    if (lineSelect) {
      lineSelect.addEventListener('change', function () { setLine(lineSelect.value); });
    }
    var copyBtn = document.getElementById('lanzouCopy');
    if (copyBtn) copyBtn.addEventListener('click', copyLanzouPassword);
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
      'feature.accept.title': '自动接受与选用',
      'feature.accept.desc': '匹配成功自动接受；选人阶段按常用英雄列表自动选用，大乱斗交换期自动换取更靠前的常用英雄',
      'feature.history.title': '战绩查询',
      'feature.history.desc': '查看详细对局历史，KDA、伤害、装备一应俱全；一键生成分享图，带 MVP / SVP 评分与高光标签',
      'feature.friends.title': '好友交互',
      'feature.friends.desc': '聊天、邀请组队、处理好友申请；好友私聊即时弹出提醒，好友按钮显示未读数',
      'feature.opgg.title': 'OP.GG 集成',
      'feature.opgg.desc': '自动应用版本强势出装、符文和召唤师技能，支持排位、大乱斗、斗魂竞技场等多模式',
      'feature.counter.title': 'Counter 对位分析',
      'feature.counter.desc': '自动计算选中英雄的克制与被克制关系，经典模式下展示对位推荐',
      'feature.ai.title': 'AI 智能分析',
      'feature.ai.desc': 'AI 实时局势分析与出装推荐，对局结束后提供复盘评价与改进建议',
      'feature.hextech.title': '海克斯识别',
      'feature.hextech.desc': '截屏识别海克斯大乱斗 / 斗魂竞技场的强化卡，叠加梯度、胜率与搭配推荐，OCR 引擎内置开箱即用',
      'feature.overlay.title': '游戏内悬浮窗',
      'feature.overlay.desc': '透明悬浮窗覆盖游戏画面，快捷键一键切换；海克斯大乱斗按当前装备推荐下一件与完整出装路线',
      'feature.mobile.title': '移动端支持',
      'feature.mobile.desc': '局域网数据共享，手机扫码即可操控选人、查看出装和海克斯推荐',
      'feature.champselect.title': '选人客户端浮窗',
      'feature.champselect.desc': '选人阶段直接在客户端上叠加英雄梯度、胜率与推荐面板，召唤师技能与装备集一键应用',
      'feature.playerlist.title': '玩家红黑榜',
      'feature.playerlist.desc': '对局结束或翻战绩时右键标记玩家，附理由与快捷标签；再次遇到时房间页和选人界面显示红黑徽章',
      'feature.mayhem.title': '海斗数据',
      'feature.mayhem.desc': '海克斯大乱斗专属数据页：英雄 / 强化 / 装备榜、强化组合、命运之武器，以及多强化组合的出装计算器',
      // Showcase sections
      'showcase.app.title': '主程序',
      'showcase.app.subtitle': '启动英雄联盟客户端后，使用 Futaba 接管所有其他功能',
      'showcase.opgg.title': 'OP.GG 集成',
      'showcase.opgg.subtitle': '自动应用版本强势装备与符文，经典模式展示 Counter 对位推荐，大乱斗展示海克斯强化',
      'showcase.mobile.title': '移动端',
      'showcase.mobile.subtitle': '局域网内扫码访问，接受对局、抢英雄、查出装，拿外卖上厕所也不耽误',
      // Highlights + Share showcase
      'highlights.title': '核心功能',
      'highlights.subtitle': 'Futaba 最想让你看到的四件事',
      'highlight.hextech.title': '海克斯强化识别',
      'highlight.hextech.desc': '海克斯大乱斗与斗魂竞技场的强化选项，客户端 API 根本不提供。Futaba 直接截屏识别每张强化卡，把梯度、胜率、本英雄排名、适配装备与通用搭配叠在卡牌下方，选强化不再靠猜。',
      'highlight.hextech.p1': '纯屏幕识别，不读取游戏内存，不改游戏文件',
      'highlight.hextech.p2': '高精度 OCR 引擎内置，开箱即用，支持海克斯大乱斗与斗魂竞技场',
      'highlight.hextech.p3': '能与已选强化组成推荐组合的卡牌高亮提示',
      'highlight.champselect.title': '选人客户端浮窗',
      'highlight.champselect.desc': '选人阶段不用切出客户端。Futaba 直接在英雄联盟客户端上叠加推荐面板：英雄梯度与胜率、召唤师技能、技能主次、核心出装和海克斯强化，看一眼就能定下这局怎么打。',
      'highlight.champselect.p1': '召唤师技能一键应用，核心出装一键写入装备集',
      'highlight.champselect.p2': '海克斯大乱斗数据与 OP.GG 随时切换',
      'highlight.champselect.p3': '可选英雄的梯度、胜率与队友红黑榜徽章同步显示',
      'highlight.opgg.title': 'OP.GG 与海斗数据',
      'highlight.opgg.desc': '排位、大乱斗、斗魂竞技场全模式接入 OP.GG 实时数据；海克斯大乱斗额外接入专属数据站，英雄、强化、装备榜与强化组合一应俱全。选人阶段一键应用，进游戏直接开打。',
      'highlight.opgg.p1': '版本强势出装 / 符文 / 召唤师技能自动应用',
      'highlight.opgg.p2': '经典模式 Counter 对位，大乱斗 ARAM 平衡调整',
      'highlight.opgg.p3': '强化出装计算器：按已选强化推荐装备，对局中跟随强化推荐下一件',
      'highlight.mobile.title': '移动端适配',
      'highlight.mobile.desc': '局域网开启数据共享，手机扫码即可打开 Futaba Mobile。接受对局、抢英雄、看出装、查海克斯推荐，离开电脑也不耽误。',
      'highlight.mobile.p1': '无需安装 App，浏览器扫码直达',
      'highlight.mobile.p2': 'mDNS 广播，记住 futaba.local 一个地址就够',
      'highlight.mobile.p3': '远程操作可单独关闭，只在可信网络使用',
      'showcase.share.title': '战绩分享',
      'showcase.share.subtitle': '对局结束一键生成分享图，单人战绩或多人同框，带皮肤原画、MVP / SVP 评分、高光标签与海克斯选择；敌我同框自动切换 VS 对抗布局',
      // Tech + Footer
      'tech.title': 'Tech Stack',
      'tech.subtitle': '现代技术栈，原生性能',
      'footer.tribute': 'Inspired by Persona 5 — "Take Your Heart"',
      'footer.mirror_thanks': '国内镜像加速由',
      'footer.mirror_thanks_and': '与',
      'footer.mirror_thanks_suffix': '提供，感谢开源项目',
      // Download card
      'download.mirror': '下载源',
      'download.mirror.github': 'GitHub',
      'download.mirror.ghproxy': '国内镜像',
      'download.mirror.lanzou': '蓝奏云',
      'download.line': '线路',
      'download.line.auto': '自动选择最快',
      'download.line.testing': '测速中…',
      'download.line.failed': '不可用',
      'download.installer': '下载安装版',
      'download.portable_exe': '便携版 EXE',
      'download.portable_zip': '便携版 ZIP',
      'download.lanzou.open': '前往蓝奏云下载',
      'download.lanzou.password': '提取密码',
      'download.lanzou.copy': '复制',
      'download.lanzou.copied': '已复制',
      'download.lanzou.hint': '国内直连，速度较慢',
      'download.error': '版本信息加载失败，将跳转至 GitHub Releases',
      'download.count': '累计下载 {n} 次',
    },
    en: {
      'hero.subtitle': 'A dual-platform League of Legends client built with Tauri — simple and efficient',
      'features.title': 'Features',
      'features.subtitle': 'Intelligent assistance from champion select to post-game',
      // Feature cards
      'feature.accept.title': 'Auto Accept & Pick',
      'feature.accept.desc': 'Auto-accept when a match is found; auto-pick from your favorite champions in champ select, and auto-swap for a higher-ranked favorite during ARAM trades',
      'feature.history.title': 'Match History',
      'feature.history.desc': 'Detailed match history with KDA, damage and builds; one-click share cards with MVP / SVP scores and highlight tags',
      'feature.friends.title': 'Friends & Social',
      'feature.friends.desc': 'Chat, party invites and friend requests; private messages pop up instantly, with an unread count on the friends button',
      'feature.opgg.title': 'OP.GG Integration',
      'feature.opgg.desc': 'Auto-apply meta builds, runes, and summoner spells across Ranked, ARAM, Arena, and more',
      'feature.counter.title': 'Counter Analysis',
      'feature.counter.desc': 'Automatically calculate counter and favorable matchups for your selected champion',
      'feature.ai.title': 'AI Analysis',
      'feature.ai.desc': 'Real-time AI situation analysis and build advice, plus post-game review with improvement tips',
      'feature.hextech.title': 'Hextech Recognition',
      'feature.hextech.desc': 'Recognizes augment cards in Hextech ARAM and Arena and overlays tier, win rate and synergy picks; the OCR engine is built in and works out of the box',
      'feature.overlay.title': 'In-Game Overlay',
      'feature.overlay.desc': 'Transparent overlay on top of the game, toggled by hotkey; in Hextech ARAM it suggests your next item and a full build path from what you already own',
      'feature.mobile.title': 'Mobile Support',
      'feature.mobile.desc': 'LAN data sharing — scan QR code on your phone to pick champions, view builds, and more',
      'feature.champselect.title': 'Champ Select Overlay',
      'feature.champselect.desc': 'Champion tiers, win rates and a recommendation panel overlaid right on the LoL client during champ select; apply spells and item sets in one click',
      'feature.playerlist.title': 'Player Lists',
      'feature.playerlist.desc': 'Right-click a player after a match or in your history to add them to your red or black list with a reason and tags; badges show up when you meet them again',
      'feature.mayhem.title': 'ARAM Mayhem Data',
      'feature.mayhem.desc': 'A dedicated Hextech ARAM data page: champion / augment / item rankings, augment combos, first-item picks, and a build calculator for any set of augments',
      // Showcase sections
      'showcase.app.title': 'Main App',
      'showcase.app.subtitle': 'Launch the LoL client, then let Futaba handle everything else',
      'showcase.opgg.title': 'OP.GG Integration',
      'showcase.opgg.subtitle': 'Auto-apply meta builds and runes, show counter matchups in Classic mode, augments in ARAM',
      'showcase.mobile.title': 'Mobile',
      'showcase.mobile.subtitle': 'Scan to access on your local network — accept matches, pick champions, and check builds on the go',
      // Highlights + Share showcase
      'highlights.title': 'Highlights',
      'highlights.subtitle': 'The four things Futaba does best',
      'highlight.hextech.title': 'Hextech Augment Recognition',
      'highlight.hextech.desc': 'The LoL client API never exposes the augment picker in Hextech ARAM and Arena. Futaba reads every augment card straight off the screen and overlays tier, win rate, rank for your champion, fitting items and common combos right under each card. No more guessing.',
      'highlight.hextech.p1': 'Pure screen capture + OCR — no memory reading, no game file changes',
      'highlight.hextech.p2': 'High-accuracy OCR engine built in, works out of the box in Hextech ARAM and Arena',
      'highlight.hextech.p3': 'Cards that form a recommended combo with augments you already own are highlighted',
      'highlight.champselect.title': 'Champ Select Overlay',
      'highlight.champselect.desc': 'No need to leave the client during champ select. Futaba overlays a recommendation panel right on the LoL client: champion tier and win rate, summoner spells, skill order, core build and augments, so one glance tells you how to play the game.',
      'highlight.champselect.p1': 'Apply summoner spells and write the core build to an item set in one click',
      'highlight.champselect.p2': 'Switch between ARAM Mayhem data and OP.GG at any time',
      'highlight.champselect.p3': 'Tiers and win rates for available champions, plus red / black list badges for teammates',
      'highlight.opgg.title': 'OP.GG & ARAM Mayhem Data',
      'highlight.opgg.desc': 'Ranked, ARAM and Arena all pull live OP.GG data, and Hextech ARAM adds a dedicated data source with champion, augment and item rankings plus augment combos. Apply it all with one click in champ select.',
      'highlight.opgg.p1': 'Auto-apply meta builds, runes and summoner spells',
      'highlight.opgg.p2': 'Counter matchups in Classic, balance changes in ARAM',
      'highlight.opgg.p3': 'Augment build calculator: items recommended for your augments, and the next item suggested in game as you pick more',
      'highlight.mobile.title': 'Built for Mobile',
      'highlight.mobile.desc': 'Turn on LAN sharing, scan the QR code and Futaba Mobile opens on your phone. Accept matches, lock in champions, check builds and augment picks — even away from your desk.',
      'highlight.mobile.p1': 'No app to install — scan and go',
      'highlight.mobile.p2': 'mDNS broadcast: one address to remember, futaba.local',
      'highlight.mobile.p3': 'Remote control can be switched off separately on untrusted networks',
      'showcase.share.title': 'Share Cards',
      'showcase.share.subtitle': 'Generate a share image after any match, solo or up to five players, with skin splash, MVP / SVP scores, highlight tags and augment picks; allies and enemies together switch to a VS layout',
      // Tech + Footer
      'tech.title': 'Tech Stack',
      'tech.subtitle': 'Modern stack, native performance',
      'footer.tribute': 'Inspired by Persona 5 — "Take Your Heart"',
      'footer.mirror_thanks': 'China-region mirrors powered by',
      'footer.mirror_thanks_and': 'and',
      'footer.mirror_thanks_suffix': '— thanks to the open-source projects',
      // Download card
      'download.mirror': 'Source',
      'download.mirror.github': 'GitHub',
      'download.mirror.ghproxy': 'China Mirror',
      'download.mirror.lanzou': 'Lanzou',
      'download.line': 'Line',
      'download.line.auto': 'Fastest (auto)',
      'download.line.testing': 'testing…',
      'download.line.failed': 'unavailable',
      'download.installer': 'Download Installer',
      'download.portable_exe': 'Portable EXE',
      'download.portable_zip': 'Portable ZIP',
      'download.lanzou.open': 'Open Lanzou',
      'download.lanzou.password': 'Password',
      'download.lanzou.copy': 'Copy',
      'download.lanzou.copied': 'Copied',
      'download.lanzou.hint': 'Direct in China, slower',
      'download.error': 'Failed to fetch release info — falling back to GitHub Releases',
      'download.count': '{n} downloads',
    },
    ja: {
      'hero.subtitle': 'Tauri で開発されたデュアルプラットフォーム対応の LoL クライアント — シンプルで高効率',
      'features.title': 'Features',
      'features.subtitle': 'チャンピオン選択から試合終了まで、全行程をスマートにサポート',
      // Feature cards
      'feature.accept.title': '自動承認とピック',
      'feature.accept.desc': 'マッチ成立で自動承認。チャンピオン選択ではお気に入りリストから自動ピックし、ARAM のトレード中はより上位のお気に入りに自動で交換',
      'feature.history.title': '戦績検索',
      'feature.history.desc': 'KDA・ダメージ・アイテムを含む詳細な試合履歴。MVP / SVP 評価とハイライトタグつきのシェア画像をワンクリックで生成',
      'feature.friends.title': 'フレンド機能',
      'feature.friends.desc': 'チャット、パーティー招待、フレンド申請の処理。個別メッセージは即座に通知され、フレンドボタンに未読数を表示',
      'feature.opgg.title': 'OP.GG 連携',
      'feature.opgg.desc': 'メタビルド・ルーン・サモナースペルを自動適用。ランク・ARAM・アリーナなど複数モードに対応',
      'feature.counter.title': 'カウンター分析',
      'feature.counter.desc': '選択チャンピオンのカウンターと有利マッチアップを自動計算',
      'feature.ai.title': 'AI 分析',
      'feature.ai.desc': 'AIによるリアルタイム局勢分析とビルド提案、試合後の振り返りと改善アドバイス',
      'feature.hextech.title': 'ヘクステック認識',
      'feature.hextech.desc': 'ヘクステック大乱闘 / アリーナの強化カードを画面認識し、ティア・勝率・相性のよい組み合わせを表示。OCR エンジン内蔵ですぐ使える',
      'feature.overlay.title': 'ゲーム内オーバーレイ',
      'feature.overlay.desc': 'ゲーム画面上の透明オーバーレイ、ホットキーで切り替え。ヘクステック大乱闘では所持アイテムから次の一品と完成ビルドを提案',
      'feature.mobile.title': 'モバイル対応',
      'feature.mobile.desc': 'LAN共有でスマホからQRスキャン。チャンピオン選択・ビルド確認・ヘクステック推薦をモバイルで',
      'feature.champselect.title': 'チャンピオン選択オーバーレイ',
      'feature.champselect.desc': 'チャンピオン選択中、LoL クライアント上にティア・勝率・おすすめパネルを直接表示。サモナースペルとアイテムセットをワンクリックで適用',
      'feature.playerlist.title': 'レッド / ブラックリスト',
      'feature.playerlist.desc': '試合後や戦績から右クリックでプレイヤーを登録、理由とタグも記録。再び出会うとロビーとチャンピオン選択にバッジを表示',
      'feature.mayhem.title': 'ヘクステック大乱闘データ',
      'feature.mayhem.desc': 'ヘクステック大乱闘専用データ：チャンピオン / 強化 / アイテムのランキング、強化の組み合わせ、最初の伝説アイテム、複数の強化に合わせたビルド計算機',
      // Showcase sections
      'showcase.app.title': 'メインアプリ',
      'showcase.app.subtitle': 'LoLクライアント起動後、Futabaがすべての機能を引き継ぎます',
      'showcase.opgg.title': 'OP.GG 連携',
      'showcase.opgg.subtitle': 'メタビルドとルーンを自動適用、クラシックモードでカウンター表示、ARAMでオーグメント表示',
      'showcase.mobile.title': 'モバイル',
      'showcase.mobile.subtitle': 'LAN内でQRスキャン。対戦承認・チャンピオン選択・ビルド確認を外出先でも',
      // Highlights + Share showcase
      'highlights.title': '主な機能',
      'highlights.subtitle': 'Futaba が最も得意とする 4 つのこと',
      'highlight.hextech.title': 'ヘクステック強化の認識',
      'highlight.hextech.desc': 'ヘクステック大乱闘とアリーナの強化選択は、クライアント API では取得できません。Futaba は画面上の強化カードを 1 枚ずつ読み取り、ティア・勝率・このチャンピオンでの順位・相性のよいアイテムと組み合わせを各カードの直下に表示します。',
      'highlight.hextech.p1': '画面キャプチャ + OCR のみ。メモリ読み取りやゲームファイルの改変なし',
      'highlight.hextech.p2': '高精度 OCR エンジン内蔵ですぐ使える。ヘクステック大乱闘とアリーナに対応',
      'highlight.hextech.p3': '取得済みの強化とおすすめの組み合わせになるカードをハイライト',
      'highlight.champselect.title': 'チャンピオン選択オーバーレイ',
      'highlight.champselect.desc': 'チャンピオン選択中にクライアントから離れる必要はありません。Futaba は LoL クライアント上におすすめパネルを直接表示します。ティアと勝率、サモナースペル、スキルの上げ順、コアビルド、強化まで、ひと目で方針が決まります。',
      'highlight.champselect.p1': 'サモナースペルの適用とコアビルドのアイテムセット書き込みをワンクリックで',
      'highlight.champselect.p2': 'ヘクステック大乱闘データと OP.GG をいつでも切り替え',
      'highlight.champselect.p3': '選択可能なチャンピオンのティアと勝率、味方のレッド / ブラックリストバッジも表示',
      'highlight.opgg.title': 'OP.GG とヘクステック大乱闘データ',
      'highlight.opgg.desc': 'ランク・ARAM・アリーナは OP.GG のライブデータ、ヘクステック大乱闘は専用データソースでチャンピオン・強化・アイテムのランキングと強化の組み合わせを取得。チャンピオン選択中にワンクリックで適用。',
      'highlight.opgg.p1': 'メタビルド / ルーン / サモナースペルを自動適用',
      'highlight.opgg.p2': 'クラシックではカウンター、ARAM ではバランス調整を表示',
      'highlight.opgg.p3': '強化ビルド計算機：選んだ強化に合うアイテムを提案し、試合中は強化に合わせて次の一品を提案',
      'highlight.mobile.title': 'モバイル対応',
      'highlight.mobile.desc': 'LAN 共有をオンにして QR をスキャンするだけで Futaba Mobile が開きます。試合の承認、チャンピオンの確保、ビルドや強化の確認を、PC から離れていても。',
      'highlight.mobile.p1': 'アプリのインストール不要、スキャンするだけ',
      'highlight.mobile.p2': 'mDNS 配信、futaba.local の 1 つのアドレスで OK',
      'highlight.mobile.p3': 'リモート操作は個別にオフにでき、信頼できるネットワークだけで使用可能',
      'showcase.share.title': '戦績シェア',
      'showcase.share.subtitle': '試合後にワンクリックでシェア画像を生成。ソロでも複数人でも、スキンイラスト・MVP / SVP 評価・ハイライトタグ・強化選択つき。敵味方が並ぶと VS レイアウトに',
      // Tech + Footer
      'tech.title': 'Tech Stack',
      'tech.subtitle': 'モダンな技術スタック、ネイティブパフォーマンス',
      'footer.tribute': 'Inspired by Persona 5 — "Take Your Heart"',
      'footer.mirror_thanks': '中国向けミラーは',
      'footer.mirror_thanks_and': 'と',
      'footer.mirror_thanks_suffix': 'が提供しています。オープンソースプロジェクトに感謝：',
      // Download card
      'download.mirror': 'ダウンロード元',
      'download.mirror.github': 'GitHub',
      'download.mirror.ghproxy': '国内ミラー',
      'download.mirror.lanzou': '藍奏雲',
      'download.line': '回線',
      'download.line.auto': '最速を自動選択',
      'download.line.testing': '計測中…',
      'download.line.failed': '利用不可',
      'download.installer': 'インストーラー',
      'download.portable_exe': 'ポータブル EXE',
      'download.portable_zip': 'ポータブル ZIP',
      'download.lanzou.open': '藍奏雲を開く',
      'download.lanzou.password': 'パスワード',
      'download.lanzou.copy': 'コピー',
      'download.lanzou.copied': 'コピーしました',
      'download.lanzou.hint': '中国国内向け、低速',
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
    renderLineOptions(lang);

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
