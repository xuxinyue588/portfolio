/* ============================================================
   个人主页 · GSAP 场景层
   依赖 vendor/gsap.min.js + ScrollTrigger + SplitText
   本文件只负责动效；导航 / Tab / 弹层等交互在 script.js
   ============================================================ */
(function () {
  'use strict';

  /* GSAP 未加载成功时静默降级：加 .no-motion 让内容直接可见，
     script.js 里的功能性交互不受影响 */
  if (typeof window.gsap === 'undefined' || typeof window.ScrollTrigger === 'undefined') {
    document.documentElement.classList.add('no-motion');
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  var hasSplit = typeof window.SplitText !== 'undefined';
  if (hasSplit) gsap.registerPlugin(SplitText);

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  /* ---------- 节奏 token：全站只允许用这几个值 ----------
     「高级」在动效里基本等于「同一套节奏反复出现」。
     主曲线与 style.css 的 --ease-liquid 是同一条，CSS transition
     和 GSAP tween 因此说同一种语言 */
  var E = {
    out: 'cubic-bezier(0.2, 0.9, 0.1, 1)',  /* 主曲线：位移、遮罩、擦除、淡入 */
    back: 'back.out(1.7)',                   /* 副曲线：只允许用在带 scale 的原语里，
                                                它读起来是主曲线的变体，不是第二种语言 */
    soft: 'power2.out',                      /* 跟随类：光标、磁吸 */
    none: 'none'                             /* scrub 专用 */
  };
  var D = { fast: 0.4, base: 0.7, slow: 1.1 };
  var S = 0.07;                              /* stagger 基准间隔 */

  /* ---------- 节奏形态：同一条 ease 下的三种 stagger 分布 ---------- */
  var TIMING = {
    seq:   { each: S, from: 'start' },          /* 顺序：纵向列表 */
    split: { each: S * 1.4, from: 'center' },   /* 对向：横向并排，从中心炸开 */
    chain: { each: D.base * 0.4, from: 'start' } /* 链式：瀑布下落 */
  };

  /* ---------- 原语库 ----------
     六个动作共用同一条 ease 和同一组时长，所以仍然统一；
     但同一屏里会同时出现 2-3 种，变化就来自这里 */
  var PRIMITIVES = {
    /* 默认原语：层级最低的正文内容 */
    rise: {
      from: { y: 34, x: -12, opacity: 0 },
      to: { y: 0, x: 0, opacity: 1, duration: D.base, ease: E.out }
    },
    /* 最高层级文字：逐行从行内向上切出。
       3.13 的 mask:'lines' 会自动给每行套一层裁剪容器，
       不必自己写 wrapper —— 没有它字会越界压到上一行 */
    maskLines: {
      split: true,
      to: { yPercent: 0, opacity: 1, duration: D.base, ease: E.out },
      from: { yPercent: 105, opacity: 0 }
    },
    /* 图像与数据块：单向擦除揭开，比淡入有分量 */
    wipe: {
      from: { clipPath: 'inset(0% 0% 100% 0%)', y: 16, opacity: 1 },
      to: { clipPath: 'inset(0% 0% 0% 0%)', y: 0, duration: D.slow, ease: E.out }
    },
    /* 小而多的元素：弹入才有精神，唯一允许用 E.back 的地方 */
    pop: {
      from: { scale: 0.7, opacity: 0 },
      to: { scale: 1, opacity: 1, duration: D.base, ease: E.back }
    },
    /* 人像专用：失焦到清晰，是「对焦」的隐喻 */
    blurFocus: {
      willChange: 'filter',
      from: { filter: 'blur(10px)', scale: 1.06, opacity: 0 },
      to: { filter: 'blur(0px)', scale: 1, opacity: 1, duration: D.slow, ease: E.out }
    },
    /* 卡片落定，带一点惯性剪切 */
    skewSettle: {
      from: { skewY: 4, y: 42, opacity: 0 },
      to: { skewY: 0, y: 0, opacity: 1, duration: D.base, ease: E.out }
    }
  };

  /* 显式映射：命中顺序即优先级，同一元素只取第一条 */
  var ASSIGN = [
    ['.section__title, .intro__statement, .exp__result',            'maskLines', 'seq'],
    ['.stat-card',                                                   'wipe',      'split'],
    ['.about__figure img',                                           'blurFocus', 'seq'],
    ['.leaf__photo img',                                             'wipe',      'seq'],
    ['.tag, .journey__time, .flip__stack li',                        'pop',       'seq'],
    ['.contact-card',                                                'skewSettle','split'],
    ['.journey__item',                                               'rise',      'chain'],
    ['.ability__item',                                               'rise',      'chain'],
    ['.section__eyebrow, .section__desc, .section__index, .about__subtitle, .journey__text, .exp, .about__aside, .detail-hero__lead, .detail-meta, .detail-block, .page-nav__item', 'rise', 'seq']
  ];

  function boot() {
    /* 减弱动效：直接交给 .no-motion 兜底，一个 tween 都不建。
       不用 gsap.matchMedia 分两个分支——旧浏览器可能对
       reduce / no-preference 两个查询都返回不匹配，那会让预隐藏的标题永远不显示 */
    if (reduce) {
      document.documentElement.classList.add('no-motion');
      return;
    }

    initReveal();
    initHero();
    initJourney();
    initFootprint();
    initStats();
    initWork();
    initScrollProgress();
    initVelocity();
    initThread();
    initChapterOdometer();
    initHandoff();
    initCurtain();
    initIdle();

    /* 仅指针设备：光标 / 磁吸 / 倾斜。触屏切换到外接鼠标时会自动挂上 */
    gsap.matchMedia().add('(hover: hover) and (pointer: fine)', function () {
      initCursor();
      initMagnetic();
      initTilt();
    });

    ScrollTrigger.refresh();

    /* Tab 切换会把 panel 从 hidden 变可见，布局变了必须重算触发点，
       否则 panel-b 里三张数据卡的 start/end 全是 0 */
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('.tab[role="tab"]')) {
        requestAnimationFrame(function () { ScrollTrigger.refresh(); });
      }
    });
  }

  var reduce = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
  var revealGroups = [];

  /* 给 script.js 的信号：动效层是否真的接管了。
     script.js 靠它决定要不要直接补上 stat 数字终值 */
  window.__motionActive = !reduce;

  /* defer 脚本在 DOM 解析完成后同步执行，此时就把元素压到初始态，
     避免等到 DOMContentLoaded 才隐藏而闪现一帧完整内容 */
  function prehide() {
    var claimed = [];   /* 同一元素只归属第一条命中的规则 */

    ASSIGN.forEach(function (rule) {
      var name = rule[1];
      var prim = PRIMITIVES[name];
      if (!prim) return;

      var nodes = $$(rule[0]).filter(function (n) {
        return claimed.indexOf(n) === -1;
      });
      if (!nodes.length) return;
      nodes.forEach(function (n) { claimed.push(n); });

      /* maskLines 需要 SplitText 才成立，缺插件时退回 rise */
      var effective = (name === 'maskLines' && !hasSplit) ? 'rise' : name;

      revealGroups.push({ prim: effective, timing: rule[2] || 'seq', nodes: nodes });
      nodes.forEach(function (n) { n.setAttribute('data-motion', effective); });
      if (reduce) return;

      /* split 类原语的初始态由 SplitText 切完行后再写，
         这里只把整块先隐掉，避免闪现一帧未切分的文字 */
      if (PRIMITIVES[effective].split) gsap.set(nodes, { autoAlpha: 0 });
      else gsap.set(nodes, PRIMITIVES[effective].from);
    });

    /* 标题在拆分完成前先隐掉，避免整行文字闪现一帧 */
    if (!reduce) {
      $$('.hero__title, .detail-hero__title').forEach(function (el) {
        el.setAttribute('data-motion', 'title');
        gsap.set(el, { autoAlpha: 0 });
      });
    }
  }

  function initReveal() {
    revealGroups.forEach(function (g) {
      var prim = PRIMITIVES[g.prim];
      var timing = TIMING[g.timing] || TIMING.seq;

      /* 逐行遮罩切出：必须等字体就位再切行，否则行高变化会露出被裁的字 */
      if (prim.split) {
        whenFontsReady(function () { revealByLines(g.nodes, prim, timing); });
        return;
      }

      /* batch：同一屏内一起进入的元素自动归组做 stagger，
         各元素仍是独立触发点，长列表不会整组提前播完 */
      ScrollTrigger.batch(g.nodes, {
        start: 'top 88%',
        once: true,
        batchMax: 4,
        interval: 0.12,
        onEnter: function (batch) {
          var vars = Object.assign({}, prim.to, {
            stagger: timing,
            overwrite: 'auto',
            /* 清掉内联 transform / clip-path / filter，
               否则 .tilt 的 CSS transform 会被压住 */
            clearProps: 'all'
          });
          if (prim.willChange) {
            batch.forEach(function (el) { el.style.willChange = prim.willChange; });
            vars.onComplete = function () {
              batch.forEach(function (el) { el.style.willChange = ''; });
            };
          }
          gsap.to(batch, vars);
        }
      });
    });

    /* .section__head::after 的蓝色渐变下划线靠 .is-in 触发。
       现在进场目标改成了 .section__head 的各个子元素，
       所以这条线单独挂一个只切类、不做动画的触发器 */
    $$('.section__head').forEach(function (head) {
      ScrollTrigger.create({
        trigger: head,
        start: 'top 88%',
        once: true,
        onEnter: function () { head.classList.add('is-in'); }
      });
    });
  }

  /* 逐行遮罩切出：每个元素独立切分与触发 */
  function revealByLines(nodes, prim, timing) {
    nodes.forEach(function (el) {
      var played = false;
      SplitText.create(el, {
        type: 'lines',
        mask: 'lines',           /* 3.13：自动给每行套裁剪容器 */
        linesClass: 'split-line',
        autoSplit: true,         /* resize 重切，played 拦住重播 */
        onSplit: function (self) {
          gsap.set(el, { autoAlpha: 1 });
          if (played) return;
          return gsap.from(self.lines, Object.assign({}, prim.from, {
            duration: prim.to.duration,
            ease: prim.to.ease,
            stagger: timing,
            scrollTrigger: {
              trigger: el,
              start: 'top 88%',
              once: true,
              onEnter: function () { played = true; }
            }
          }));
        }
      });
    });
  }

  /* ---------- Hero：标题逐字浮起 + 滚动三层视差 ----------
     卡顿的四个原因一起治：
     1) 字体落地后 autoSplit 重切并重播 → 等 fonts.ready 再切，且只播一次
     2) rotateX 没有 perspective → 退化成纵向压扁，显式给 transformPerspective
     3) 150px 字号 + 三层 text-shadow 逐字符重绘 → 动画期间关掉阴影
     4) yPercent 120 无遮罩会越界压到 eyebrow → 拆到行级并裁剪 */
  function splitTitleIn(sel, stagger) {
    var el = $(sel);
    if (!el) return;
    if (!hasSplit) { gsap.set(el, { autoAlpha: 1 }); return; }

    var played = false;

    SplitText.create(el, {
      type: 'lines,chars',
      mask: 'lines',           /* 裁切交给 GSAP 的遮罩层，配 CSS 里的内边距补偿；
                                  没有它，字符从 yPercent 115 冒出来会压到上方 eyebrow 行 */
      aria: 'auto',            /* 自动补 aria-label，屏读器仍读完整标题 */
      autoSplit: true,         /* resize 后重切，但下面用 played 拦住重播 */
      linesClass: 'split-line',
      onSplit: function (self) {
        gsap.set(el, { autoAlpha: 1 });
        if (played) return;    /* 字体落地或 resize 触发的重切不再重播 */
        played = true;

        el.classList.add('is-splitting');
        return gsap.from(self.chars, {
          yPercent: 115,
          rotateX: -45,
          transformPerspective: 800,
          transformOrigin: '50% 100%',
          opacity: 0,
          duration: D.base,
          ease: E.out,
          stagger: stagger || 0.026,
          onComplete: function () { el.classList.remove('is-splitting'); }
        });
      }
    });
  }

  /* 字体没就位就切分，webfont 落地后行宽变化会让动画看起来重启一次。
     fonts.ready 在字体已缓存时同帧 resolve，不额外拖慢；
     1.2s 超时兜底，防止 Google Fonts 不可达时标题一直不出现 */
  function whenFontsReady(fn) {
    var done = false;
    var run = function () { if (!done) { done = true; fn(); } };
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(run);
    else run();
    setTimeout(run, 1200);
  }

  function initHero() {
    whenFontsReady(function () {
      splitTitleIn('.hero__title', 0.026);
      splitTitleIn('.detail-hero__title', 0.014);
    });

    var hero = $('#hero');
    if (!hero) return;

    var bg = $('.hero__grid-bg');
    var geo = $('#heroGeo');
    var text = $('.hero__text');
    var avatar = $('.hero__avatar img');

    var tl = gsap.timeline({
      scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true }
    });

    /* 背景最慢、文字反向、人像居中——三档速度差就是纵深感的来源 */
    if (bg) tl.to(bg, { yPercent: 30, ease: E.none }, 0);
    /* 只动 #heroGeo 容器本身；它的子元素 transform 归 initCursor 的弹簧跟随管 */
    if (geo) tl.to(geo, { yPercent: 22, ease: E.none }, 0);
    if (text) tl.to(text, { yPercent: -8, opacity: 0.3, ease: E.none }, 0);
    /* 人像不做 scale：.hero__avatar 无 overflow 裁剪，放大会压到相邻栏 */
    if (avatar) tl.to(avatar, { yPercent: 10, ease: E.none }, 0);
  }

  /* ---------- Trajectory：时间线随滚动填充、节点逐个点亮 ---------- */
  function initJourney() {
    var list = document.getElementById('journeyList');
    if (!list) return;

    /* scrub: 0.6 —— 滚动停下后填充还会继续追赶一小段，这是「惯性」手感来源 */
    ScrollTrigger.create({
      trigger: list,
      start: 'top 60%',
      end: 'bottom 60%',
      scrub: 0.6,
      onUpdate: function (self) {
        list.style.setProperty('--journey-progress', (self.progress * 100).toFixed(2) + '%');
      }
    });

    /* 每个节点独立触发，来回滚动可逆 */
    $$('.journey__item', list).forEach(function (item) {
      ScrollTrigger.create({
        trigger: item,
        start: 'top 55%',
        onEnter: function () { item.classList.add('is-passed'); },
        onLeaveBack: function () { item.classList.remove('is-passed'); }
      });
    });
  }

  /* ---------- 生活足迹地图：缓缓展开 ---------- */
  /* 顺序按时间线：网格 → 上海→深圳 → 深圳→柏林 → 深圳→北京，
     每条航线画完它的终点节点才弹入，所以「线把节点带出来」而不是各自淡入 */
  function initFootprint() {
    var root = document.getElementById('footprint');
    if (!root) return;

    var grid = $('.fp-grid', root);
    var caption = $('.footprint__caption', root);
    var LEGS = [
      { draw: '#fpMaskShenzhen .fp-draw', start: '.fp-node[data-city="shanghai"]', end: '.fp-node[data-city="shenzhen"]' },
      { draw: '#fpMaskBerlin .fp-draw',   end: '.fp-node[data-city="berlin"]' },
      { draw: '#fpMaskBeijing .fp-draw',  end: '.fp-node[data-city="beijing"]' }
    ];

    var draws = LEGS.map(function (leg) { return $(leg.draw, root); }).filter(Boolean);
    if (grid) gsap.set(grid, { opacity: 0, scaleY: 0.82, transformOrigin: '50% 50%' });
    gsap.set(draws, { strokeDashoffset: 1 });
    /* 上海是第一条线的起点，所以它跟网格一起先在场 */
    var startNode = $(LEGS[0].start, root);
    var endNodes = LEGS.map(function (leg) { return $(leg.end, root); }).filter(Boolean);
    gsap.set([startNode].concat(endNodes).filter(Boolean), { scale: 0.55, autoAlpha: 0 });
    if (caption) gsap.set(caption, { autoAlpha: 0 });

    var tl = gsap.timeline({
      paused: true,
      defaults: { ease: E.out },
      onComplete: function () { gsap.set(root.querySelectorAll('.fp-node'), { clearProps: 'transform' }); }
    });
    if (grid) tl.to(grid, { opacity: 1, scaleY: 1, duration: 0.55 }, 0);
    if (startNode) tl.to(startNode, { scale: 1, autoAlpha: 1, duration: D.base, ease: E.back }, 0.15);

    draws.forEach(function (path, i) {
      var at = 0.3 + i * 0.35;
      tl.to(path, { strokeDashoffset: 0, duration: 0.62 }, at);
      var end = $(LEGS[i].end, root);
      if (end) tl.to(end, { scale: 1, autoAlpha: 1, duration: D.base, ease: E.back }, at + 0.42);
    });
    if (caption) tl.to(caption, { autoAlpha: 1, duration: D.fast }, '>-0.2');

    ScrollTrigger.create({
      trigger: root,
      start: 'top 82%',
      once: true,
      onEnter: function () { tl.play(); }
    });
  }

  /* ---------- Deep Dive：数据卡跟随滚动增长 ---------- */
  function initStats() {
    $$('.stat-num').forEach(function (el) {
      var raw = el.dataset.target || '0';
      var decimals = (raw.split('.')[1] || '').length;
      var counter = { v: 0 };

      gsap.to(counter, {
        v: parseFloat(raw),
        ease: E.none,
        scrollTrigger: {
          trigger: el.closest('.stat-card') || el,
          start: 'top 85%',
          end: 'top 45%',
          scrub: 0.4
        },
        onUpdate: function () { el.textContent = counter.v.toFixed(decimals); }
      });
    });

    /* 覆盖率条：从继承来的 27% 长到交付的 45%，基准线不动 */
    $$('.stat-bar').forEach(function (bar) {
      var fill = bar.querySelector('.stat-bar__fill');
      if (!fill) return;
      var from = parseFloat(bar.dataset.from || '0');
      var to = parseFloat(bar.dataset.to || '0');
      fill.style.transition = 'none';
      gsap.fromTo(fill,
        { width: from + '%' },
        {
          width: to + '%',
          ease: E.none,
          scrollTrigger: { trigger: bar, start: 'top 90%', end: 'top 55%', scrub: 0.4 }
        }
      );
    });
  }

  /* ---------- Work：项目卡入场 + 滚动错层 ----------
     没有做 pin：三张卡在桌面端是 grid 一行并排（style.css:1094），
     钉住标题或横向滚动都换不来有效滚动距离，只会白加高度。详见 doc.md 5.1 */
  function initWork() {
    var cards = $$('.proj-grid .flip');
    if (!cards.length) return;

    cards.forEach(function (c) { c.setAttribute('data-motion', 'work'); });
    gsap.set(cards, { y: 60, scale: 0.94, opacity: 0 });

    gsap.to(cards, {
      y: 0, scale: 1, opacity: 1,
      duration: D.slow,
      ease: E.out,
      /* 三张卡横向并排，从中心向两边展开比从左扫到右更有张力 */
      stagger: TIMING.split,
      scrollTrigger: { trigger: '.proj-grid', start: 'top 85%', once: true }
    });

    /* 错层：中间那张慢一点，一行并排也能读出深度差。
       用 yPercent 而非 y，避免和入场 tween 的 y 抢同一个属性 */
    cards.forEach(function (card, i) {
      var lag = [0, 1, 0.45][i % 3];
      if (!lag) return;
      gsap.to(card, {
        yPercent: -4 * lag,
        ease: E.none,
        scrollTrigger: { trigger: '.proj-grid', start: 'top bottom', end: 'bottom top', scrub: 0.5 }
      });
    });
  }

  /* ---------- 光标：黏性双球 + Hero 几何体惯性跟随 + 折射光晕 ----------
     手写的 lx += (px-lx)*0.34 全部换成 gsap.quickTo，
     好处是插值进 GSAP 的单一 rAF 调度，和滚动场景共用同一帧 */
  function initCursor() {
    var hero = $('#hero');
    var goo = document.getElementById('gooLayer');
    var lead = goo ? $('.goo__blob--lead', goo) : null;
    var trail = goo ? $('.goo__blob--trail', goo) : null;
    var shapes = $$('#heroGeo > span');
    if (!goo && !shapes.length) return;

    var leadX, leadY, trailX, trailY;
    if (lead && trail) {
      leadX = gsap.quickTo(lead, 'x', { duration: D.fast * 0.55, ease: E.soft });
      leadY = gsap.quickTo(lead, 'y', { duration: D.fast * 0.55, ease: E.soft });
      trailX = gsap.quickTo(trail, 'x', { duration: D.base * 0.85, ease: E.soft });
      trailY = gsap.quickTo(trail, 'y', { duration: D.base * 0.85, ease: E.soft });
    }

    /* 每个几何体按 data-depth 反向偏移，duration 越长越「重」 */
    var followers = shapes.map(function (el) {
      var depth = Number(el.dataset.depth) || 12;
      return {
        depth: depth,
        x: gsap.quickTo(el, 'x', { duration: D.slow + depth / 40, ease: E.soft }),
        y: gsap.quickTo(el, 'y', { duration: D.slow + depth / 40, ease: E.soft })
      };
    });

    /* 光标形态：悬停可交互元素时放大，.flip 上额外显示提示字。
       提示文字必须放在 .goo 之外——.goo 挂了 url(#goo) 阈值滤镜，文字进去会被糊掉 */
    var hint = document.createElement('span');
    hint.className = 'goo__hint';
    hint.setAttribute('aria-hidden', 'true');
    document.body.appendChild(hint);
    var hintX = gsap.quickTo(hint, 'x', { duration: D.fast * 0.6, ease: E.soft });
    var hintY = gsap.quickTo(hint, 'y', { duration: D.fast * 0.6, ease: E.soft });

    var HOT = '.btn, .flip, .contact-card, .proj__demo-btn, .tab, .ask__chip, .hero__ask, .fp-node';
    document.addEventListener('pointerover', function (e) {
      var hot = e.target.closest && e.target.closest(HOT);
      if (goo) goo.classList.toggle('is-hot', !!hot);
      var isFlip = !!(hot && hot.classList.contains('flip'));
      hint.textContent = isFlip ? 'Flip' : '';
      hint.classList.toggle('is-visible', isFlip);
    }, { passive: true });

    document.addEventListener('pointermove', function (e) {
      if (goo) goo.classList.add('is-live');
      if (leadX) { leadX(e.clientX); leadY(e.clientY); trailX(e.clientX); trailY(e.clientY); }
      hintX(e.clientX + 22);
      hintY(e.clientY + 16);

      if (!hero || !followers.length) return;
      var r = hero.getBoundingClientRect();
      var inside = e.clientY >= r.top && e.clientY <= r.bottom;
      hero.classList.toggle('is-glowing', inside);
      if (inside) {
        hero.style.setProperty('--mx', (e.clientX - r.left).toFixed(0) + 'px');
        hero.style.setProperty('--my', (e.clientY - r.top).toFixed(0) + 'px');
      }
      var nx = inside ? ((e.clientX - r.left) / r.width - 0.5) * 2 : 0;
      var ny = inside ? ((e.clientY - r.top) / r.height - 0.5) * 2 : 0;
      followers.forEach(function (f) { f.x(-nx * f.depth); f.y(-ny * f.depth); });
    }, { passive: true });

    document.addEventListener('pointerleave', function () {
      if (goo) goo.classList.remove('is-live', 'is-hot');
      hint.classList.remove('is-visible');
      if (hero) hero.classList.remove('is-glowing');
    });
  }

  /* ---------- 按钮磁吸 ----------
     位移走 CSS 变量 + CSS transition（CSS 自定义属性带单位时 GSAP 无法可靠插值），
     这里只负责把光标位置换算成偏移量 */
  function initMagnetic() {
    $$('.btn, .proj__demo-btn').forEach(function (btn) {
      btn.addEventListener('mousemove', function (e) {
        var r = btn.getBoundingClientRect();
        btn.style.setProperty('--mag-x', (((e.clientX - r.left) / r.width - 0.5) * 8).toFixed(1) + 'px');
        btn.style.setProperty('--mag-y', (((e.clientY - r.top) / r.height - 0.5) * 6).toFixed(1) + 'px');
      });
      btn.addEventListener('mouseleave', function () {
        btn.style.setProperty('--mag-x', '0px');
        btn.style.setProperty('--mag-y', '0px');
      });
    });
  }

  /* ---------- 卡片 3D 微倾斜 ---------- */
  function initTilt() {
    $$('.stat-card, .ability__item').forEach(function (card) {
      card.classList.add('tilt');
      card.addEventListener('mousemove', function (e) {
        var r = card.getBoundingClientRect();
        card.style.setProperty('--tilt-y', (((e.clientX - r.left) / r.width - 0.5) * 7).toFixed(2) + 'deg');
        card.style.setProperty('--tilt-x', ((-((e.clientY - r.top) / r.height - 0.5)) * 7).toFixed(2) + 'deg');
      });
      card.addEventListener('mouseleave', function () {
        card.style.setProperty('--tilt-x', '0deg');
        card.style.setProperty('--tilt-y', '0deg');
      });
    });
  }

  /* ---------- 顶部滚动进度条 ----------
     交给 ScrollTrigger 的全页 scrub，不再单独挂 scroll 监听。
     注意：nav 的 is-scrolled 切换仍留在 script.js —— 它只读 window.scrollY、
     不触发 layout，且 GSAP 加载失败时导航底色必须照常工作 */
  function initScrollProgress() {
    var bar = document.getElementById('scrollProgress');
    if (!bar) return;

    gsap.fromTo(bar,
      { width: '0%' },
      {
        width: '100%',
        ease: E.none,
        scrollTrigger: { start: 0, end: 'max', scrub: 0.2 }
      }
    );
  }

  /* ---------- 共享驱动量 --vel ----------
     把滚动速度归一化到 -1~1 写进 <html>，全站元素按不同权重消费同一个值。
     单看每条都极轻微，但因为所有元素同时对同一个输入响应，
     滚动时整页会像一块有弹性的整体在动 —— 这是「连接感」的技术核心 */
  function initVelocity() {
    var root = document.documentElement;
    var cur = 0, target = 0, idle = null;

    /* ScrollTrigger 本身已经占用 gsap.ticker，这里不额外起 rAF 循环。
       静止时提前 return，不做无意义的样式写入 */
    gsap.ticker.add(function () {
      if (Math.abs(target - cur) < 0.0008) return;
      cur += (target - cur) * 0.12;
      root.style.setProperty('--vel', cur.toFixed(3));
    });

    ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: function (self) {
        target = gsap.utils.clamp(-1, 1, self.getVelocity() / 2600);
        /* onUpdate 在停止滚动后就不再触发，必须自己把目标值收回 0，
           否则页面会永远歪着 */
        clearTimeout(idle);
        idle = setTimeout(function () { target = 0; }, 80);
      }
    });
  }

  /* ---------- 贯穿全页的主线 ---------- */
  function initThread() {
    var svg = document.getElementById('thread');
    var path = svg ? $('.thread__path', svg) : null;
    if (!path) return;

    /* pathLength 归一化成 1，不必读真实长度，resize 也无需重算 */
    gsap.set(path, { strokeDasharray: 1, strokeDashoffset: 1 });

    var idle = null;
    gsap.to(path, {
      strokeDashoffset: 0,
      ease: E.none,
      scrollTrigger: {
        start: 0,
        end: 'max',
        scrub: 0.5,
        onUpdate: function () {
          svg.classList.add('is-drawing');
          clearTimeout(idle);
          idle = setTimeout(function () { svg.classList.remove('is-drawing'); }, 2000);
        }
      }
    });
  }

  /* ---------- 章节序号里程表 ----------
     六个数字叠在同一个格子里，用一条 timeline 串起来、由整页滚动 scrub 驱动，
     所以它天然是连续换位的，而不是六次互不相干的淡入 */
  function initChapterOdometer() {
    var wrap = document.getElementById('chapterNum');
    if (!wrap) return;
    var nums = $$('span', wrap);
    if (!nums.length) return;

    var tl = gsap.timeline({
      scrollTrigger: { trigger: 'main', start: 'top top', end: 'bottom bottom', scrub: 0.8 }
    });

    nums.forEach(function (n, i) {
      tl.fromTo(n,
        { yPercent: 55, autoAlpha: 0 },
        { yPercent: 0, autoAlpha: 1, ease: E.none, duration: 0.35 }, i)
        .to(n, { yPercent: -55, autoAlpha: 0, ease: E.none, duration: 0.35 }, i + 0.65);
    });
  }

  /* ---------- 章节接力：消除段与段之间的静止空档 ----------
     每段独立触发时，两段之间会有一截"什么都不动"的空白，观感就是一段一段的。
     这里让每段在自己即将离开视口时轻微上移变淡——那段区间下一屏正在进场，
     两屏同时在动，空档就消失了。
     幅度刻意很小（-5% / 透明度 .55）：目的是去掉静止感，不是把内容藏起来 */
  function initHandoff() {
    var sections = $$('main > section');
    if (sections.length < 2) return;

    sections.forEach(function (sec, i) {
      /* Hero 已有自己的三层视差；最后一屏（Contact）永远不淡出 */
      if (i === 0 || i === sections.length - 1) return;
      var inner = $('.container', sec);
      if (!inner) return;

      gsap.to(inner, {
        yPercent: -5,
        opacity: 0.55,
        ease: E.none,
        scrollTrigger: {
          trigger: sec,
          start: 'bottom 78%',
          end: 'bottom 22%',
          scrub: 0.4
        }
      });
    });
  }

  /* ---------- 跨页幕布过渡 ---------- */
  function initCurtain() {
    var curtain = document.getElementById('curtain');
    if (!curtain) return;

    function store(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
    function take(k) {
      try {
        var v = sessionStorage.getItem(k);
        sessionStorage.removeItem(k);
        return v;
      } catch (e) { return null; }
    }

    /* 入场：只有从站内跳过来才播，直接输入 URL / 外链进入不播 */
    if (take('nav-in')) {
      gsap.fromTo(curtain,
        { scaleY: 1, transformOrigin: '50% 0%' },
        { scaleY: 0, duration: D.base, ease: E.out });
    }

    /* 后退时页面可能从 bfcache 恢复，幕布还停在合拢态，必须归零 */
    window.addEventListener('pageshow', function (e) {
      if (!e.persisted) return;
      gsap.set(curtain, { scaleY: 0 });
      curtain.style.pointerEvents = 'none';
    });

    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      /* 新窗口、下载、修饰键、非左键一律不拦——招聘方常用「新标签页打开」 */
      if (a.target || a.hasAttribute('download')) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      if (/^(https?:|mailto:|tel:|#)/.test(href)) return;
      if (!/\.html($|[?#])/.test(href)) return;

      e.preventDefault();
      store('nav-in', '1');
      curtain.style.pointerEvents = 'auto';
      gsap.fromTo(curtain,
        { scaleY: 0, transformOrigin: '50% 100%' },
        {
          scaleY: 1,
          duration: D.fast,          /* 不超过 0.4s，跳页延迟才不会被感知为卡 */
          ease: E.out,
          overwrite: true,
          onComplete: function () { location.href = a.href; }
        });
    });
  }

  /* ---------- 待机动效：不滚动时页面也要活着 ----------
     停止滚动后除了光标全站凝固，这是「动效单一」感受里最容易被忽略的一块。
     三处都是极低频循环，走 transform / dashoffset，页面切到后台时 GSAP 自动暂停 ticker */
  function initIdle() {
    /* Hero 两个圆环极慢自转：转一圈 90s / 120s，慢到不分散注意力。
       自转写 rotation、光标跟随写 x/y，同为 GSAP 管理，互不覆盖 */
    var big = $('.geo__ring--lg');
    var small = $('.geo__ring--sm');
    if (big) gsap.to(big, { rotation: 360, duration: 90, ease: E.none, repeat: -1 });
    if (small) gsap.to(small, { rotation: -360, duration: 120, ease: E.none, repeat: -1 });

    /* 主线流光：一小段虚线沿全程跑，14s 一圈 */
    var spark = document.getElementById('threadSpark');
    if (spark) {
      gsap.fromTo(spark,
        { strokeDashoffset: 1 },
        { strokeDashoffset: 0, duration: 14, ease: E.none, repeat: -1 });
    }

    /* 光标呼吸：静止时也有生命 */
    var trail = $('.goo__blob--trail');
    if (trail) {
      gsap.to(trail, {
        scale: 1.12, duration: 2.4, ease: E.soft, repeat: -1, yoyo: true
      });
    }
  }

  /* SCENES_PLACEHOLDER */

  /* script.js 的 DOMContentLoaded 先注册先执行，此处保证在其之后启动 */
  prehide();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
