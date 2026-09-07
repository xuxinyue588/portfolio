/**
 * 限流
 *
 * ⚠ 局限（必须知道）：默认实现是**进程内内存计数器**。
 * Serverless 会同时存在多个实例、且实例会被回收，因此：
 *   - 计数不在实例间共享，攻击者并发打进不同实例可以绕过；
 *   - 实例回收后计数归零。
 * 它的作用是"抬高成本"，不是"严格限制"。
 *
 * 要真限流就把 store 换成共享存储（Upstash Redis / Vercel KV）：
 * 实现下面 Store 的三个方法即可，调用方无需改动。
 *   get(key) -> any | undefined
 *   set(key, value)
 *   now() -> ms
 */

'use strict';

const PER_MIN = Number(process.env.RATE_PER_MIN || 5);
const PER_HOUR = Number(process.env.RATE_PER_HOUR || 20);
const DAILY_MAX = Number(process.env.DAILY_MAX_REQUESTS || 300);

/** 内存 store：key -> 时间戳数组 / 计数对象 */
function createMemoryStore() {
  const map = new Map();
  return {
    get: k => map.get(k),
    set: (k, v) => map.set(k, v),
    delete: k => map.delete(k),
    keys: () => Array.from(map.keys()),
    now: () => Date.now()
  };
}

let store = createMemoryStore();

/** 供测试或接入 Redis 时替换 */
function setStore(s) {
  store = s;
}

/** 从请求里取客户端标识。Vercel 会带 x-forwarded-for */
function clientKey(req) {
  const h = (req && req.headers) || {};
  const xff = h['x-forwarded-for'] || h['X-Forwarded-For'] || '';
  const ip = String(xff).split(',')[0].trim()
    || h['x-real-ip']
    || (req && req.socket && req.socket.remoteAddress)
    || 'unknown';
  return 'ip:' + ip;
}

/** 滑动窗口：保留窗口内的时间戳，顺手清掉过期的 */
function slide(key, windowMs, limit, now) {
  const arr = (store.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= limit) {
    const retryAfter = Math.ceil((windowMs - (now - arr[0])) / 1000);
    store.set(key, arr);
    return { ok: false, retryAfter: Math.max(retryAfter, 1) };
  }
  arr.push(now);
  store.set(key, arr);
  return { ok: true };
}

/** 全站每日上限：超了就整天关闭接口，宁可不可用也不被刷爆额度 */
function daily(now) {
  const day = new Date(now).toISOString().slice(0, 10);
  const rec = store.get('daily') || { day, count: 0 };
  if (rec.day !== day) {
    rec.day = day;
    rec.count = 0;
  }
  if (rec.count >= DAILY_MAX) {
    store.set('daily', rec);
    const nextUtcMidnight = Date.parse(day + 'T00:00:00Z') + 86400000;
    return { ok: false, retryAfter: Math.ceil((nextUtcMidnight - now) / 1000), reason: 'daily_cap' };
  }
  rec.count += 1;
  store.set('daily', rec);
  return { ok: true, used: rec.count };
}

/**
 * 检查是否放行。顺序：先查每日总量，再查单 IP 的分钟/小时窗口。
 * @returns {{ok:boolean, retryAfter?:number, reason?:string, dailyUsed?:number}}
 */
function check(req) {
  const now = store.now();
  const key = clientKey(req);

  const perMin = slide(key + ':m', 60 * 1000, PER_MIN, now);
  if (!perMin.ok) return { ok: false, retryAfter: perMin.retryAfter, reason: 'per_minute' };

  const perHour = slide(key + ':h', 60 * 60 * 1000, PER_HOUR, now);
  if (!perHour.ok) return { ok: false, retryAfter: perHour.retryAfter, reason: 'per_hour' };

  // 每日计数放在最后，避免被前面拦掉的请求也占用当天额度
  const d = daily(now);
  if (!d.ok) return { ok: false, retryAfter: d.retryAfter, reason: d.reason };

  return { ok: true, dailyUsed: d.used };
}

module.exports = { check, clientKey, setStore, createMemoryStore, PER_MIN, PER_HOUR, DAILY_MAX };
