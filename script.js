/* ============================================================
   个人主页 · 交互脚本（原生 JS，无依赖、无网络请求）
   ============================================================ */
(function () {
  'use strict';

  var prefersReducedMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
  var supportsIO = 'IntersectionObserver' in window;

  /* ---------- 移动端汉堡菜单 ---------- */
  function initMobileNav() {
    var nav = document.getElementById('nav');
    var burger = document.getElementById('navBurger');
    if (!nav || !burger) return;

    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('nav-open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      burger.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
    });

    nav.querySelectorAll('.nav__link').forEach(function (link) {
      link.addEventListener('click', function () {
        nav.classList.remove('nav-open');
        burger.setAttribute('aria-expanded', 'false');
        burger.setAttribute('aria-label', 'Open navigation menu');
      });
    });
  }

  /* ---------- 滚动状态 + 当前板块高亮 ---------- */
  function initNavScrollSpy() {
    var nav = document.getElementById('nav');
    var links = Array.prototype.slice.call(document.querySelectorAll('.nav__link'));
    var sections = links
      .map(function (l) { return document.getElementById(l.dataset.nav); })
      .filter(Boolean);

    if (nav) {
      var onScroll = function () {
        nav.classList.toggle('is-scrolled', window.scrollY > 8);
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
    if (!supportsIO || !sections.length) return;

    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (l) {
          l.classList.toggle('is-active', l.dataset.nav === entry.target.id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ---------- Stat Card 数字与进度条 ----------
     动效版（随滚动增长）在 motion.js。
     这里只负责「没有动效时也必须显示正确数字」——HTML 里初始写的是 0，
     GSAP 未加载或用户关闭动效时若不补终值，简历数据会停在 0。 */
  function motionActive() {
    return window.__motionActive === true;
  }

  function setStatsFinal(root) {
    root.querySelectorAll('.stat-num').forEach(function (el) {
      var raw = el.dataset.target || '0';
      var decimals = (raw.split('.')[1] || '').length;
      el.textContent = parseFloat(raw).toFixed(decimals);
    });
    root.querySelectorAll('.stat-bar').forEach(function (bar) {
      var fill = bar.querySelector('.stat-bar__fill');
      if (!fill) return;
      fill.style.transition = 'none';
      fill.style.width = parseFloat(bar.dataset.to || '0') + '%';
    });
  }

  function initStatCounters() {
    if (motionActive()) return;
    setStatsFinal(document);
  }

  /* ---------- 实习子项目 Tab ---------- */
  function initTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab[role="tab"]'));
    if (!tabs.length) return;

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var panel = document.getElementById(tab.getAttribute('aria-controls'));
        tabs.forEach(function (t) {
          var p = document.getElementById(t.getAttribute('aria-controls'));
          var active = t === tab;
          t.classList.toggle('is-active', active);
          t.setAttribute('aria-selected', active ? 'true' : 'false');
          if (p) p.hidden = !active;
        });
        if (panel && !motionActive()) setStatsFinal(panel);
      });
    });
  }

  /* ---------- 职探 Demo 视频弹层 ---------- */
  function initDemoModal() {
    var modal = document.getElementById('demoModal');
    if (!modal) return;

    var frame = modal.querySelector('.demo-modal__frame');
    var titleEl = document.getElementById('demoModalTitle');
    var closeBtn = modal.querySelector('.demo-modal__close');
    var trigger = null;
    var FOCUSABLE = '.demo-modal__close, .demo-modal__frame';

    function isOpen() {
      return !modal.hasAttribute('hidden');
    }

    function open(btn) {
      trigger = btn;
      if (titleEl && btn.dataset.demoTitle) titleEl.textContent = btn.dataset.demoTitle;
      /* iframe 的 title 也要跟着切，否则屏读器会一直念第一个项目的名字 */
      if (frame && btn.dataset.demoTitle) frame.title = btn.dataset.demoTitle + ' video';
      if (frame) frame.src = btn.dataset.demo || '';
      modal.removeAttribute('hidden');
      document.body.classList.add('no-scroll');
      if (closeBtn) closeBtn.focus();
    }

    function close() {
      if (!isOpen()) return;
      modal.setAttribute('hidden', '');
      document.body.classList.remove('no-scroll');
      if (frame) { frame.src = ''; frame.title = 'Demo video'; }
      if (trigger && typeof trigger.focus === 'function') trigger.focus();
      trigger = null;
    }

    document.querySelectorAll('.proj__demo-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        open(btn);
      });
      btn.addEventListener('keydown', function (e) {
        e.stopPropagation();
      });
    });

    modal.addEventListener('click', function (e) {
      if (e.target && e.target.hasAttribute('data-close')) close();
    });

    document.addEventListener('keydown', function (e) {
      if (!isOpen()) return;
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      var nodes = Array.prototype.slice.call(modal.querySelectorAll(FOCUSABLE));
      if (!nodes.length) return;
      var first = nodes[0];
      var last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  /* ---------- 3D 翻转卡片：技术项目卡 + 足迹地图节点 ---------- */
  function initFlipCards() {
    document.querySelectorAll('.flip, .fp-node').forEach(function (card) {
      var timer = null;
      function toggle() {
        var flipped = card.classList.toggle('is-flipped');
        card.setAttribute('aria-pressed', flipped ? 'true' : 'false');
        card.classList.add('is-flipping');
        clearTimeout(timer);
        timer = setTimeout(function () { card.classList.remove('is-flipping'); }, 750);
      }
      card.addEventListener('click', toggle);
      /* 原生 <button>（足迹节点）由浏览器把 Enter / Space 转成 click，
         再绑 keydown 会翻两次；只有 role="button" 的 <article> 需要补键盘 */
      if (card.tagName !== 'BUTTON') {
        card.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            toggle();
          }
        });
      }
      /* 卡内的详情页链接不应触发翻转 */
      card.querySelectorAll('.flip__link').forEach(function (link) {
        link.addEventListener('click', function (e) { e.stopPropagation(); });
        link.addEventListener('keydown', function (e) { e.stopPropagation(); });
      });
    });
  }

  /* ---------- Toast ---------- */
  var toastTimer = null;
  function showToast(msg) {
    var toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('is-visible');
    }, 2000);
  }

  /* ---------- 电话：桌面端点击复制，移动端直接拨号 ---------- */
  function initCopyPhone() {
    var card = document.getElementById('phoneCard');
    if (!card) return;

    card.addEventListener('click', function (e) {
      var isMobile = window.matchMedia && window.matchMedia('(max-width: 767px)').matches;
      if (isMobile) return;

      e.preventDefault();
      var text = card.dataset.phone || '';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          showToast('Phone number copied: ' + text);
        }).catch(function () {
          showToast('Copy failed — please select and copy manually');
        });
      } else {
        showToast('This browser does not support auto-copy — please copy manually');
      }
    });
  }

  /* ---------- 滚动进场动画 ----------
     已迁移至 motion.js（GSAP ScrollTrigger 接管），此处不再实现 */

  /* ---------- 顶部滚动进度条 ----------
     已迁移至 motion.js（ScrollTrigger 全页 scrub） */

  /* ---------- Hero 身份词打字机轮播 ---------- */
  function initHeroRotator() {
    var el = document.getElementById('heroRotator');
    if (!el) return;
    var words = (el.dataset.words || '').split('|').filter(Boolean);
    if (words.length < 2 || prefersReducedMotion) return;

    var wi = 0, ci = words[0].length, deleting = true;

    function step() {
      if (deleting) {
        ci--;
        if (ci <= 0) { deleting = false; wi = (wi + 1) % words.length; ci = 0; }
      } else {
        ci++;
        if (ci >= words[wi].length) { deleting = true; ci = words[wi].length; }
      }
      el.textContent = words[wi].slice(0, ci);
      var delay = ci === words[wi].length ? 2400 : (deleting ? 55 : 95);
      setTimeout(step, delay);
    }
    setTimeout(step, 2400);
  }

  /* ---------- 指针类动效（黏性光标 / 磁吸 / 倾斜） ----------
     已整体迁移至 motion.js，由 GSAP quickTo 统一调度 */

  /* ---------- 时间线滚动填充 ----------
     已迁移至 motion.js（ScrollTrigger scrub 驱动） */

  /* ---------- 详情页 sticky 目录高亮 ---------- */
  function initToc() {
    var toc = document.querySelector('.toc__list');
    if (!toc) return;

    var links = Array.prototype.slice.call(toc.querySelectorAll('a[href^="#"]'));
    if (!links.length) return;

    var blocks = links
      .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); })
      .filter(Boolean);
    if (!blocks.length) return;

    function activate(id) {
      links.forEach(function (a) {
        a.classList.toggle('is-active', a.getAttribute('href') === '#' + id);
      });
    }
    activate(blocks[0].id);

    if (!supportsIO) return;
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) activate(entry.target.id);
      });
    }, { rootMargin: '-30% 0px -60% 0px', threshold: 0 });

    blocks.forEach(function (b) { spy.observe(b); });
  }

  /* ---------- 翻书爱好页 ---------- */
  function initFlipbook() {
    var book = document.getElementById('book');
    if (!book) return;

    var sheets = Array.prototype.slice.call(book.querySelectorAll('.book__sheet'));
    if (!sheets.length) return;

    var total = sheets.length;
    var prevBtn = document.getElementById('bookPrev');
    var nextBtn = document.getElementById('bookNext');
    var dotsWrap = document.getElementById('bookDots');
    var dots = [];
    var k = 0;
    var busy = false;

    for (var i = 0; i <= total; i++) {
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.setAttribute('aria-label', 'Go to spread ' + (i + 1));
      dot.dataset.index = String(i);
      if (dotsWrap) dotsWrap.appendChild(dot);
      dots.push(dot);
    }

    function paint() {
      sheets.forEach(function (sheet, idx) {
        var flipped = idx < k;
        sheet.classList.toggle('is-flipped', flipped);
        sheet.style.zIndex = String(flipped ? idx + 1 : total - idx + 1);
        var front = sheet.querySelector('.book__face--front');
        var back = sheet.querySelector('.book__face--back');
        if (front) front.setAttribute('aria-hidden', idx === k ? 'false' : 'true');
        if (back) back.setAttribute('aria-hidden', idx === k - 1 ? 'false' : 'true');
        if (front) front.classList.toggle('is-live', idx === k);
        if (back) back.classList.toggle('is-live', idx === k - 1);
      });
      dots.forEach(function (d, idx) { d.classList.toggle('is-active', idx === k); });
      if (prevBtn) prevBtn.disabled = k === 0;
      if (nextBtn) nextBtn.disabled = k === total;
      book.classList.toggle('is-opened', k > 0);
    }

    function goTo(next) {
      next = Math.max(0, Math.min(total, next));
      if (busy || next === k) return;
      busy = true;
      var moving = next > k ? sheets[k] : sheets[next];
      if (moving && !prefersReducedMotion) {
        moving.classList.add('is-turning');
        setTimeout(function () { moving.classList.remove('is-turning'); }, 1000);
      }
      k = next;
      paint();
      setTimeout(function () { busy = false; }, prefersReducedMotion ? 130 : 620);
    }

    if (prevBtn) prevBtn.addEventListener('click', function () { goTo(k - 1); });
    if (nextBtn) nextBtn.addEventListener('click', function () { goTo(k + 1); });
    dots.forEach(function (d) {
      d.addEventListener('click', function () { goTo(Number(d.dataset.index)); });
    });

    /* 点击左右半侧翻页 */
    book.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      var rect = book.getBoundingClientRect();
      goTo(e.clientX - rect.left > rect.width / 2 ? k + 1 : k - 1);
    });

    /* 方向键 */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') goTo(k + 1);
      else if (e.key === 'ArrowLeft') goTo(k - 1);
    });

    /* 触屏左右滑动 */
    var touchX = null;
    book.addEventListener('touchstart', function (e) {
      touchX = e.changedTouches[0].clientX;
    }, { passive: true });
    book.addEventListener('touchend', function (e) {
      if (touchX === null) return;
      var dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 40) goTo(dx < 0 ? k + 1 : k - 1);
      touchX = null;
    });

    /* 光标跟随高光 */
    if (!prefersReducedMotion && window.matchMedia && window.matchMedia('(hover: hover)').matches) {
      book.addEventListener('mousemove', function (e) {
        var rect = book.getBoundingClientRect();
        book.classList.add('is-glowing');
        book.style.setProperty('--bx', (e.clientX - rect.left) + 'px');
        book.style.setProperty('--by', (e.clientY - rect.top) + 'px');
      });
      book.addEventListener('mouseleave', function () { book.classList.remove('is-glowing'); });
    }

    paint();

    /* 入场动画 */
    if (prefersReducedMotion || !supportsIO) {
      book.classList.add('is-ready');
    } else {
      var io = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          book.classList.add('is-ready');
          obs.unobserve(entry.target);
        });
      }, { threshold: 0.25 });
      io.observe(book);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    initMobileNav();
    initNavScrollSpy();
    initStatCounters();
    initTabs();
    initCopyPhone();
    initHeroRotator();
    initFlipCards();
    initDemoModal();
    initToc();
    initFlipbook();
  });
})();
