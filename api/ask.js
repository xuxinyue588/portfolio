/**
 * POST /api/ask —— 受控问答 / JD 匹配
 *
 * 链路：方法校验 → Origin 白名单 → 请求体校验 → 限流 → prompt 组装 → 调用模型 → 流式转发
 *
 * 说明：QA 用 SSE 流式返回；JD 需要完整 JSON 结构，用非流式。
 */

'use strict';

const { callModel } = require('./_lib/provider.js');
const { buildMessages, MAX_INPUT_CHARS } = require('./_lib/prompt.js');
const ratelimit = require('./_lib/ratelimit.js');
const profile = require('./_data/profile.json');

/** 从 profile.json 里收集所有合法 refs，模型编造的引用在服务端就丢掉 */
const VALID_REFS = (function collect(node, acc) {
  if (Array.isArray(node)) node.forEach(n => collect(n, acc));
  else if (node && typeof node === 'object') {
    for (const r of node.refs || []) {
      if (r && r.page && r.anchor) acc.add(r.page + '/' + r.anchor);
    }
    Object.values(node).forEach(v => collect(v, acc));
  }
  return acc;
})(profile, new Set());

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/**
 * Origin 白名单。默认只允许同域（无 Origin 头的同源请求也放行）。
 * 设 ALLOWED_ORIGINS 可显式追加，逗号分隔。
 */
function checkOrigin(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;                       // 同源 fetch 通常不带 Origin
  const host = req.headers.host;
  const allowed = String(process.env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  let sameHost = false;
  try { sameHost = new URL(origin).host === host; } catch (e) { sameHost = false; }

  if (sameHost) return true;
  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    return true;
  }
  return false;
}

/** Vercel 通常已解析 JSON body；兜底自己读一次 */
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return null; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { return null; }
}

function validate(body) {
  if (!body || typeof body !== 'object') return 'invalid_json';
  const mode = body.mode === 'jd' ? 'jd' : 'qa';
  const text = mode === 'jd' ? body.jd : body.question;
  if (typeof text !== 'string' || !text.trim()) return 'empty_input';
  if (text.length > MAX_INPUT_CHARS) return 'input_too_long';
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    checkOrigin(req, res);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  if (!checkOrigin(req, res)) return json(res, 403, { error: 'forbidden_origin' });

  const gate = ratelimit.check(req);
  if (!gate.ok) {
    res.setHeader('Retry-After', String(gate.retryAfter));
    return json(res, 429, { error: 'rate_limited', reason: gate.reason, retryAfter: gate.retryAfter });
  }

  const body = await readBody(req);
  const bad = validate(body);
  if (bad) return json(res, 400, { error: bad });

  const mode = body.mode === 'jd' ? 'jd' : 'qa';
  const messages = buildMessages({
    mode,
    question: body.question,
    jd: body.jd,
    history: body.history,
    profile
  });

  if (mode === 'jd') return handleJd(res, messages);
  return handleQa(res, messages);
};

/* ---------- JD 模式：非流式 + JSON 结构兜底校验 ---------- */

async function handleJd(res, messages) {
  const r = await callModel(messages, { stream: false, maxTokens: 1200, jsonMode: true });
  if (!r.ok) return json(res, r.status || 503, { error: r.error });

  const raw = r.data && r.data.choices && r.data.choices[0]
    && r.data.choices[0].message && r.data.choices[0].message.content;
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return json(res, 502, { error: 'bad_model_output' }); }

  // 结构兜底：字段缺失或类型不对时补成安全默认值，不把脏数据丢给前端
  const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
  const gaps = Array.isArray(parsed.gaps) ? parsed.gaps : [];
  const clean = {
    matches: matches
      .filter(m => m && typeof m.requirement === 'string')
      .map(m => ({
        requirement: m.requirement,
        level: m.level === 'strong' ? 'strong' : 'partial',
        evidence: typeof m.evidence === 'string' ? m.evidence : '',
        refs: (Array.isArray(m.refs) ? m.refs : []).filter(x => x && VALID_REFS.has(x.page + '/' + x.anchor))
      })),
    gaps: gaps
      .filter(g => g && typeof g.requirement === 'string')
      .map(g => ({ requirement: g.requirement, note: typeof g.note === 'string' ? g.note : '' })),
    summary: typeof parsed.summary === 'string' ? parsed.summary : ''
  };
  // gaps 为空视为不可信：一份全部匹配的分析没有参考价值，交给前端改文案
  clean.trustworthy = clean.gaps.length > 0 && clean.matches.length > 0;
  return json(res, 200, clean);
}

/* ---------- QA 模式：SSE 流式转发 ---------- */

function sse(res, obj) {
  res.write('data: ' + JSON.stringify(obj) + '\n\n');
}

async function handleQa(res, messages) {
  const r = await callModel(messages, { stream: true, maxTokens: 900 });
  if (!r.ok) return json(res, r.status || 503, { error: r.error });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');   // 禁止中间层缓冲，否则流式失去意义

  let full = '';
  let buf = '';
  const reader = r.response.body.getReader();
  const decoder = new TextDecoder();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        let chunk;
        try { chunk = JSON.parse(payload); } catch (e) { continue; }
        const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
        const text = delta && delta.content;
        if (text) { full += text; sse(res, { type: 'delta', text }); }
      }
    }

    // 收尾：把正文里出现过的合法引用去重后单独给前端一份，编造的直接丢弃
    const refs = [];
    const seen = new Set();
    for (const m of full.matchAll(/\[\[ref:([\w-]+)\/([\w-]+)\]\]/g)) {
      const key = m[1] + '/' + m[2];
      if (VALID_REFS.has(key) && !seen.has(key)) {
        seen.add(key);
        refs.push({ page: m[1], anchor: m[2] });
      }
    }
    sse(res, { type: 'refs', refs });
    sse(res, { type: 'done' });
  } catch (err) {
    sse(res, { type: 'error', error: 'stream_interrupted' });
  } finally {
    if (r.cleanup) r.cleanup();
    res.end();
  }
}
