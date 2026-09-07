/**
 * copilot.js —— 问答组件前端逻辑
 *
 * 只在 pages/ask.html 引入（首页那块已改成入口块，不再挂组件）。
 * 三级状态：正常（SSE 流式）→ mock（本地演示，显式标注）→ 降级（静态兜底 + 案例直链）。
 */

(function () {
  'use strict';

  /** 同域部署留空；页面与函数不同域时在 index.html 里设 window.__COPILOT_API__ */
  var API_BASE = window.__COPILOT_API__ || '';
  var TIMEOUT_MS = 8000;

  /** 引用注册表：模型只输出 id，链接由前端生成，未注册的 page 直接丢弃。
   *  路径必须是根绝对路径 —— 组件现在挂在 /pages/ask.html，
   *  写成 'pages/xxx.html' 会被解析成 /pages/pages/xxx.html 而 404。 */
  var PAGES = {
    home: '/index.html',
    'case-baidu': '/pages/case-baidu-map.html',
    zhitan: '/pages/project-zhitan.html',
    aail: '/pages/project-aail.html',
    hull: '/pages/project-hull.html'
  };

  var widget = document.getElementById('askWidget');
  if (!widget) return;

  var form = document.getElementById('askForm');
  var input = document.getElementById('askInput');
  var submit = document.getElementById('askSubmit');
  var counter = document.getElementById('askCounter');
  var statusEl = document.getElementById('askStatus');
  var answerEl = document.getElementById('askAnswer');
  var labelEl = document.getElementById('askLabel');
  var chipsWrap = document.getElementById('askChips');
  var modeBtns = Array.prototype.slice.call(widget.querySelectorAll('.ask__mode-btn'));

  var mode = 'qa';
  var busy = false;

  var COPY = {
    qa: {
      label: 'Your question',
      placeholder: 'e.g. What exactly did she own at Baidu Maps?',
      submit: 'Ask',
      thinking: 'Reading the site…'
    },
    jd: {
      label: 'Paste the job description',
      placeholder: 'Paste the requirements and I will map them against what is on this site, including the gaps.',
      submit: 'Match',
      thinking: 'Matching requirement by requirement…'
    }
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** [[ref:case-baidu/strategy-a]] → 站内锚点角标；未知 page 静默丢弃，不渲染坏链 */
  function resolveRefs(escaped) {
    return escaped.replace(/\[\[ref:([\w-]+)\/([\w-]+)\]\]/g, function (m, page, anchor) {
      var file = PAGES[page];
      if (!file) return '';
      return '<a class="ask__ref" href="' + file + '#' + anchor +
             '" title="Jump to the source section">↗</a>';
    });
  }

  function setStatus(text) { statusEl.textContent = text || ''; }

  function showAnswer(html) {
    answerEl.hidden = false;
    answerEl.innerHTML = html;
  }

  function banner(text, warn) {
    return '<p class="ask__banner' + (warn ? ' ask__banner--warn' : '') + '">' +
           escapeHtml(text) + '</p>';
  }

  /** 降级：接口不可用时不留白屏，给静态兜底与案例直链 */
  function degrade(reason) {
    var links =
      '<p class="ask__jd-evidence">' +
      '<a class="ask__ref" href="pages/case-baidu-map.html">Baidu Maps case ↗</a> · ' +
      '<a class="ask__ref" href="pages/project-zhitan.html">Career Scout ↗</a> · ' +
      '<a class="ask__ref" href="pages/project-hull.html">Hull Tactical ↗</a></p>';
    showAnswer(banner(reason, true) + links);
    setStatus('');
  }

  function switchMode(next) {
    if (busy || next === mode) return;
    mode = next;
    modeBtns.forEach(function (b) {
      var on = b.dataset.mode === next;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    labelEl.textContent = COPY[next].label;
    input.placeholder = COPY[next].placeholder;
    submit.textContent = COPY[next].submit;
    chipsWrap.hidden = next === 'jd';
    input.value = '';
    updateCounter();
    answerEl.hidden = true;
    answerEl.innerHTML = '';
    setStatus('');
  }

  function updateCounter() {
    counter.textContent = input.value.length + ' / 2000';
    submit.disabled = busy || !input.value.trim();
  }

  /* ---------- QA：SSE 流式 ---------- */

  async function runQa(question) {
    var ctrl = new AbortController();
    // 只掐首字节：拿到第一个 delta 就清掉，否则长回答会被 8 秒截断
    var timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);

    var res;
    try {
      res = await fetch(API_BASE + '/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'qa', question: question }),
        signal: ctrl.signal
      });
    } catch (e) {
      clearTimeout(timer);
      throw { kind: e && e.name === 'AbortError' ? 'timeout' : 'network' };
    }

    if (res.status === 404) { clearTimeout(timer); throw { kind: 'nomock' }; }
    if (!res.ok) {
      clearTimeout(timer);
      var info = {};
      try { info = await res.json(); } catch (e) {}
      throw { kind: res.status === 429 ? 'rate' : 'unavailable', info: info };
    }

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buf = '', full = '', first = true;

    for (;;) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });

      var idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        var raw = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 2);
        if (raw.indexOf('data:') !== 0) continue;
        var evt;
        try { evt = JSON.parse(raw.slice(5).trim()); } catch (e) { continue; }

        if (evt.type === 'delta') {
          if (first) { clearTimeout(timer); setStatus(''); first = false; }
          full += evt.text;
          showAnswer(resolveRefs(escapeHtml(full)) + '<span class="ask__caret"></span>');
        } else if (evt.type === 'error') {
          full += '\n（回答被中断）';
        }
      }
    }
    clearTimeout(timer);
    showAnswer(resolveRefs(escapeHtml(full)));
    return full;
  }

  /* ---------- JD：结构化结果 ---------- */

  async function runJd(jd) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 30000);
    var res;
    try {
      res = await fetch(API_BASE + '/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'jd', jd: jd }),
        signal: ctrl.signal
      });
    } catch (e) {
      clearTimeout(timer);
      throw { kind: e && e.name === 'AbortError' ? 'timeout' : 'network' };
    }
    clearTimeout(timer);
    if (res.status === 404) throw { kind: 'nomock' };
    if (!res.ok) throw { kind: res.status === 429 ? 'rate' : 'unavailable' };

    var data = await res.json();
    renderJd(data);
  }

  function refLinks(refs) {
    return (refs || []).map(function (r) {
      var file = PAGES[r.page];
      if (!file) return '';
      return '<a class="ask__ref" href="' + file + '#' + r.anchor + '">↗</a>';
    }).join('');
  }

  function renderJd(data) {
    // 全部匹配 = 不可信。宁可说重合度不足，也不给一份看起来完美的分析
    if (!data.trustworthy) {
      degrade('This job description doesn\'t overlap enough with what\'s written on the site to produce an honest match. Reading the case pages directly will tell you more.');
      return;
    }
    var html = '';
    if (data.summary) html += banner(data.summary);

    html += '<div class="ask__jd-group"><p class="ask__jd-title">Backed by evidence</p>';
    data.matches.forEach(function (m) {
      html += '<div class="ask__jd-item"><p class="ask__jd-req">' + escapeHtml(m.requirement) +
        '<span class="ask__jd-level ask__jd-level--' + (m.level === 'strong' ? 'strong' : 'partial') + '">' +
        (m.level === 'strong' ? 'Strong' : 'Partial') + '</span></p>' +
        '<p class="ask__jd-evidence">' + escapeHtml(m.evidence) + ' ' + refLinks(m.refs) + '</p></div>';
    });
    html += '</div>';

    html += '<div class="ask__jd-group"><p class="ask__jd-title">Gaps — stated honestly</p>';
    data.gaps.forEach(function (g) {
      html += '<div class="ask__jd-item"><p class="ask__jd-req">' + escapeHtml(g.requirement) +
        '<span class="ask__jd-level ask__jd-level--gap">Gap</span></p>' +
        '<p class="ask__jd-evidence">' + escapeHtml(g.note) + '</p></div>';
    });
    html += '</div>';
    showAnswer(html);
  }

  /* ---------- mock：本地演示模式 ---------- */

  var MOCK = [
    { keys: ['baidu', 'map', '百度', '地图', 'intern', '实习'],
      text: 'At Baidu Maps she owned two coverage workstreams. On parking fees she took coverage from 27% to 45% (+15PP, 10+ PP ahead of competitors) by sampling 500 lots against competitors first, then tiering 150 cities. [[ref:case-baidu/strategy-a]] On opening hours she traced 23 bad records and found the real defect was link recall, not the operators. [[ref:case-baidu/strategy-b]]' },
    { keys: ['agent', 'multi', '多智能体', 'career', 'scout', '职探'],
      text: 'Career Scout splits "is this company trustworthy" into five dimensions searched in parallel, with a controller agent resolving conflicts instead of averaging them. [[ref:zhitan/orchestration]]' },
    { keys: ['not to build', 'decide', '判断', '取舍', 'roi', 'prioriti'],
      text: 'Her rule is that not all data is worth completing: residential parking fees are useless to outside users, so she cut that scope entirely rather than spending capacity on it. [[ref:case-baidu/judge]]' },
    { keys: ['hull', 'sharpe', 'model', '模型', '金融'],
      text: 'Hull Tactical used a three-dimension feature system and Stacking; Pearson 0.384, annualized Sharpe 2.97, RMSE 0.9997. [[ref:hull/validation]]' }
  ];

  function mockAnswer(q) {
    var low = q.toLowerCase();
    for (var i = 0; i < MOCK.length; i++) {
      for (var j = 0; j < MOCK[i].keys.length; j++) {
        if (low.indexOf(MOCK[i].keys[j]) >= 0) return MOCK[i].text;
      }
    }
    return 'This site doesn\'t cover that. The written pages are the source of truth — the case study and project pages are the best place to look.';
  }

  function runMock(question) {
    var note = 'Local demo mode — canned answers, not real model output. The live version needs the /api/ask function deployed.';
    if (mode === 'jd') {
      showAnswer(banner(note, true) + banner('JD matching needs the deployed API; it is not simulated locally.'));
      return;
    }
    var text = mockAnswer(question);
    showAnswer(banner(note, true) + '<p>' + resolveRefs(escapeHtml(text)) + '</p>');
  }

  /* ---------- 提交与事件绑定 ---------- */

  var ERRORS = {
    rate: 'Too many questions in a short window. Give it a minute and try again.',
    timeout: 'The model didn\'t respond in time. The pages below have the same information.',
    network: 'Couldn\'t reach the answering service. The pages below have the same information.',
    unavailable: 'The answering service is unavailable right now. The pages below have the same information.'
  };

  async function onSubmit(e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || busy) return;
    if (text.length > 2000) return;

    busy = true;
    updateCounter();
    answerEl.hidden = true;
    answerEl.innerHTML = '';
    setStatus(COPY[mode].thinking);

    try {
      if (isLocalFile()) { runMock(text); }
      else if (mode === 'jd') { await runJd(text); }
      else { await runQa(text); }
    } catch (err) {
      var kind = (err && err.kind) || 'unavailable';
      if (kind === 'nomock') runMock(text);            // 函数没部署，退回本地演示
      else degrade(ERRORS[kind] || ERRORS.unavailable);
    } finally {
      busy = false;
      setStatus('');
      updateCounter();
    }
  }

  /** 用 file:// 直接打开时没有后端，直接走 mock */
  function isLocalFile() {
    return location.protocol === 'file:';
  }

  modeBtns.forEach(function (b) {
    b.addEventListener('click', function () { switchMode(b.dataset.mode); });
  });
  chipsWrap.addEventListener('click', function (e) {
    var chip = e.target.closest('.ask__chip');
    if (!chip) return;
    input.value = chip.textContent.trim();
    updateCounter();
    input.focus();
  });
  input.addEventListener('input', updateCounter);
  input.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') form.requestSubmit();
  });
  form.addEventListener('submit', onSubmit);

  updateCounter();
})();
