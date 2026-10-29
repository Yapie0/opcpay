import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { realpathSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import QRCode from 'qrcode';
import { opcpay } from '../../index.mjs';
import { openStore, atomic } from './store.mjs';
import { mockProvider } from './mock.mjs';

const validAction = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
const pending = "('NEW','UNKNOWN','CONFIRMED')";
function failure(status, message, extra = {}) { return Object.assign(new Error(message), { status, extra, userFacing: true }); }
function safePurchase(result, mockOrigin) {
  // These are opaque provider URLs. Never parse tokens or fetch a returned URL.
  if (result?.status !== 'READY') return result;
  let url; try { url = new URL(result.purchase_url); } catch { throw failure(502, '购买入口暂时不可用，请重试'); }
  if ((!['https:', 'alipays:'].includes(url.protocol) && !(mockOrigin && url.origin === mockOrigin)) || url.username || url.password) throw failure(502, '购买入口无效');
  return result;
}

export function createApp(options = {}) {
  const env = options.env || process.env;
  const mode = env.PAYMENT_MODE || 'mock';
  if (!['mock', 'live'].includes(mode)) throw Error('PAYMENT_MODE must be mock or live');
  const origin = new URL(env.PUBLIC_ORIGIN || 'http://localhost:3000');
  if (origin.origin !== origin.href.replace(/\/$/, '') || origin.search || origin.hash) throw Error('PUBLIC_ORIGIN must be an origin without path');
  if (mode === 'live' && (origin.protocol !== 'https:' || !env.opcpay_api_key)) throw Error('Live mode requires HTTPS PUBLIC_ORIGIN and opcpay_api_key');
  const password = env.DEMO_PASSWORD || (mode === 'mock' ? 'local-demo-password' : '');
  if (password.length < 12 || (mode === 'live' && password === 'local-demo-password')) throw Error('Set a private DEMO_PASSWORD with at least 12 characters');
  const userId = env.DEMO_USER_ID || 'example-user-1';
  const db = options.db || openStore(resolve(env.DATABASE_PATH || './data/example.sqlite'));
  // Never replay mock operations against a real project after changing .env.
  // Older databases without a marker must use a new path if they contain data.
  try {
    atomic(db, () => {
      const saved = db.prepare("SELECT value FROM example_meta WHERE key='payment_mode'").get();
      const legacyData = !saved && db.prepare('SELECT (SELECT count(*) FROM purchases) + (SELECT count(*) FROM jobs) + (SELECT count(*) FROM sessions) + (SELECT count(*) FROM mock_balances) AS n').get().n > 0;
      if (legacyData || (saved && saved.value !== mode)) throw Error('Payment mode differs from this database; set a separate DATABASE_PATH for mock/live 模式');
      db.prepare("INSERT OR IGNORE INTO example_meta(key,value) VALUES ('payment_mode',?)").run(mode);
    });
  } catch (error) { if (!options.db) db.close(); throw error; }
  const provider = options.provider || (mode === 'mock' ? mockProvider(db, origin.origin) : new opcpay({ apiKey: env.opcpay_api_key }));
  const locks = new Map();
  const attempts = new Map();
  const hash = value => createHash('sha256').update(value).digest();
  const secret = hash(password);
  async function serial(user, work) {
    const previous = locks.get(user) || Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    locks.set(user, next);
    try { return await next; } finally { if (locks.get(user) === next) locks.delete(user); }
  }
  function session(req, res) {
    const cookie = /(?:^|;\s*)opcpay_example=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
    let row = cookie && db.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').get(cookie[1], Date.now());
    if (!row) {
      row = { id: randomBytes(32).toString('hex'), user_id: null, csrf: randomBytes(24).toString('hex'), expires: Date.now() + 12 * 3600000 };
      db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(row.id, row.user_id, row.csrf, row.expires);
      res.setHeader('Set-Cookie', `opcpay_example=${row.id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${origin.protocol === 'https:' ? '; Secure' : ''}`);
      db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    }
    return row;
  }
  async function body(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw failure(415, '请使用 JSON');
    const chunks = []; let bytes = 0;
    for await (const data of req) { bytes += data.length; if (bytes > 8192) throw failure(413, '请求太大'); chunks.push(data); }
    const raw = Buffer.concat(chunks).toString('utf8');
    try { const result = JSON.parse(raw || '{}'); if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error(); return result; }
    catch { throw failure(400, '请求格式无效'); }
  }
  async function profile() {
    const [capabilities, product] = await Promise.all([provider.capabilities(), provider.product()]);
    if (!capabilities.provider_configured || !capabilities.capabilities?.entitlement_query) throw failure(409, '请先完成项目收款配置');
    return { capabilities, product };
  }
  function update(table, id, status, result) {
    db.prepare(`UPDATE ${table} SET status=?, result=? WHERE id=? AND status!='DELIVERED'`).run(status, JSON.stringify(result), id);
  }
  function storedResult(row) { return row.result ? JSON.parse(row.result) : null; }
  async function purchase(user, input) {
    if (!validAction(input.actionId) || typeof input.skuId !== 'string') throw failure(400, '请选择套餐');
    let row = db.prepare('SELECT * FROM purchases WHERE user_id=? AND action_id=?').get(user, input.actionId);
    if (row && row.sku !== input.skuId) throw failure(409, '同一次购买不能更换套餐');
    if (!row) {
      const unresolved = db.prepare("SELECT * FROM purchases WHERE user_id=? AND status IN ('NEW','UNKNOWN') LIMIT 1").get(user);
      if (unresolved) throw failure(409, '请先恢复上次购买', { pendingActionId: unresolved.action_id, skuId: unresolved.sku });
      const { capabilities, product } = await profile();
      if (!capabilities.capabilities?.purchase_entry || product.capability_status !== 'ENABLED') throw failure(409, '此项目暂不可购买');
      if (!product.charging_options?.some(p => p.sku_id === input.skuId)) throw failure(400, '套餐已变化，请刷新');
      row = { id: 'purchase-' + randomUUID(), user_id: user, action_id: input.actionId, sku: input.skuId, callback_url: origin.origin + '/return', status: 'NEW' };
      // Persist before the first provider write; retry always uses these values.
      db.prepare('INSERT INTO purchases(id,user_id,action_id,sku,callback_url,status) VALUES (?,?,?,?,?,?)').run(row.id, user, row.action_id, row.sku, row.callback_url, row.status);
    }
    if (['FAILED', 'EXPIRED'].includes(row.status)) return { id: row.id, ...storedResult(row), status: row.status };
    try {
      if (row.status !== 'NEW') {
        const original = await provider.purchaseQuery(user, row.id);
        if (original.status === 'EXPIRED' || original.response?.status === 'EXPIRED') {
          update('purchases', row.id, 'EXPIRED', { status: 'EXPIRED' }); return { id: row.id, status: 'EXPIRED' };
        }
        if (original.response?.status === 'READY') {
          const result = safePurchase(original.response, mode === 'mock' ? origin.origin : null); update('purchases', row.id, 'READY', result); return { id: row.id, ...result };
        }
      }
    } catch { /* Explicit POST below safely restores the identical original intent. */ }
    try {
      const result = safePurchase(await provider.purchase({ userId: user, idempotencyKey: row.id, skuId: row.sku, callbackURL: row.callback_url }), mode === 'mock' ? origin.origin : null);
      update('purchases', row.id, ['READY', 'FAILED', 'EXPIRED'].includes(result.status) ? result.status : 'UNKNOWN', result);
      return { id: row.id, ...result };
    } catch { update('purchases', row.id, 'UNKNOWN', { status: 'UNKNOWN' }); return { id: row.id, status: 'UNKNOWN' }; }
  }
  async function use(user, input) {
    if (!validAction(input.actionId)) throw failure(400, '请求编号无效');
    let row = db.prepare('SELECT * FROM jobs WHERE user_id=? AND action_id=?').get(user, input.actionId);
    if (!row) {
      const old = db.prepare(`SELECT action_id FROM jobs WHERE user_id=? AND status IN ${pending} LIMIT 1`).get(user);
      if (old) throw failure(409, '请先恢复上一次使用', { pendingActionId: old.action_id });
      const { capabilities, product } = await profile();
      if (!['ONE_TIME', 'ONE_TIME_DURATION', 'QUANTITY'].includes(product.billing_mode)) throw failure(409, '尚未支持的收费方式');
      if (product.billing_mode === 'QUANTITY' && (!capabilities.capabilities?.consumption || !['COUNT', 'POINT'].includes(product.quota_unit))) throw failure(409, '此项目暂不可核销');
      row = { id: 'job-' + randomUUID(), user_id: user, action_id: input.actionId, mode: product.billing_mode, unit: product.quota_unit || null, amount: 1, reason: '示例报告生成', status: 'NEW' };
      db.prepare('INSERT INTO jobs(id,user_id,action_id,mode,unit,amount,reason,status) VALUES (?,?,?,?,?,?,?,?)').run(row.id, user, row.action_id, row.mode, row.unit, row.amount, row.reason, row.status);
    }
    if (row.status === 'DELIVERED') return { status: 'DELIVERED', receipt: JSON.parse(db.prepare('SELECT result FROM receipts WHERE job_id=?').get(row.id).result) };
    if (row.status === 'FAILED') return { status: 'FAILED', ...storedResult(row) };
    if (row.status !== 'CONFIRMED') {
      let result;
      try {
        if (row.status === 'NEW') {
          const access = await provider.access(user, row.amount);
          const allowed = row.mode === 'QUANTITY'
            ? access.access_granted === true && access.requires_consumption === true && access.quota_unit === row.unit && Number(access.remaining) >= row.amount
            : access.access_granted === true && access.decision === 'ALLOW';
          if (!allowed) {
            const outcome = { status: 'FAILED', purchaseRequired: access.decision === 'PURCHASE_REQUIRED' || (row.mode === 'QUANTITY' && Number(access.remaining) < row.amount) };
            update('jobs', row.id, 'FAILED', outcome); return outcome;
          }
          if (row.mode !== 'QUANTITY') result = { status: 'SUCCEEDED', confirmed: true, accessDecision: 'ALLOW' };
        }
        if (row.mode === 'QUANTITY') {
          try { result = await provider.consumption(user, row.id); } catch { /* Restore the same persisted operation below. */ }
          if (!(result?.status === 'SUCCEEDED' && result.confirmed === true)) {
            result = await provider.consume({ userId: user, idempotencyKey: row.id, amount: row.amount, reason: row.reason });
          }
          if (result?.status === 'FAILED') { update('jobs', row.id, 'FAILED', result); return { status: 'FAILED' }; }
          if (!(result?.status === 'SUCCEEDED' && result.confirmed === true && result.idempotency_key === row.id && result.consumed === row.amount && result.quota_unit === row.unit)) {
            update('jobs', row.id, 'UNKNOWN', { status: 'UNKNOWN' }); return { status: 'UNKNOWN' };
          }
        } else if (row.status !== 'NEW') {
          // No quota operation was performed: refresh ALLOW after an interrupted access check.
          const access = await provider.access(user, row.amount);
          if (!(access.access_granted === true && access.decision === 'ALLOW')) return { status: 'UNKNOWN' };
          result = { status: 'SUCCEEDED', confirmed: true, accessDecision: 'ALLOW' };
        }
        update('jobs', row.id, 'CONFIRMED', result);
      } catch { update('jobs', row.id, 'UNKNOWN', { status: 'UNKNOWN' }); return { status: 'UNKNOWN' }; }
    }
    // Local delivery and its receipt commit together. An external AI/service
    // should use a unique outbox job, not perform network work inside this TX.
    return atomic(db, () => {
      const existing = db.prepare('SELECT result FROM receipts WHERE job_id=?').get(row.id);
      const receipt = existing ? JSON.parse(existing.result) : { id: row.id, text: '示例报告已生成', createdAt: new Date().toISOString() };
      if (!existing) db.prepare('INSERT INTO receipts VALUES (?,?,?)').run(row.id, user, JSON.stringify(receipt));
      update('jobs', row.id, 'DELIVERED', receipt);
      return { status: 'DELIVERED', receipt };
    });
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, origin);
      if (req.headers.host !== origin.host) throw failure(400, '请求地址不匹配');
      const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/return': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      if (req.method === 'GET' && assets[url.pathname]) { const [file, type] = assets[url.pathname]; res.writeHead(200, { 'Content-Type': type }); return res.end(await readFile(new URL('./public/' + file, import.meta.url))); }
      if (!url.pathname.startsWith('/api/')) throw failure(404, '页面不存在');
      const s = session(req, res);
      if (req.method === 'GET' && url.pathname === '/api/session') return send(200, { user: s.user_id ? { id: s.user_id } : null, csrf: s.csrf, mode });
      let input = {};
      if (req.method === 'POST') {
        if (req.headers.origin !== origin.origin || req.headers['x-csrf-token'] !== s.csrf) throw failure(403, '请求已失效，请刷新');
        input = await body(req);
      }
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const ip = req.socket.remoteAddress;
        if (attempts.size > 1000) attempts.clear();
        const a = attempts.get(ip) || { count: 0, reset: Date.now() + 60000 };
        if (a.reset < Date.now()) { a.count = 0; a.reset = Date.now() + 60000; }
        a.count++; attempts.set(ip, a);
        if (a.count > 10) throw failure(429, '请稍后再试');
        if (typeof input.password !== 'string' || !timingSafeEqual(hash(input.password), secret)) throw failure(401, '密码不正确');
        db.prepare('DELETE FROM sessions WHERE id=?').run(s.id);
        const fresh = session({ headers: {} }, res);
        db.prepare('UPDATE sessions SET user_id=? WHERE id=?').run(userId, fresh.id);
        return send(200, { ok: true });
      }
      if (!s.user_id) throw failure(401, '请先登录');
      if (req.method === 'POST' && url.pathname === '/api/logout') { db.prepare('DELETE FROM sessions WHERE id=?').run(s.id); res.setHeader('Set-Cookie', 'opcpay_example=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); return send(200, { ok: true }); }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const { product } = await profile(); const access = await provider.access(s.user_id, 1);
        const job = db.prepare(`SELECT action_id FROM jobs WHERE user_id=? AND status IN ${pending} LIMIT 1`).get(s.user_id);
        const receipts = db.prepare('SELECT result FROM receipts WHERE user_id=? ORDER BY rowid DESC LIMIT 5').all(s.user_id).map(x => JSON.parse(x.result));
        return send(200, { product, access, pendingActionId: job?.action_id, receipts });
      }
      if (req.method === 'POST' && url.pathname === '/api/purchase') return send(200, await serial(s.user_id, () => purchase(s.user_id, input)));
      if (req.method === 'POST' && url.pathname === '/api/use') return send(200, await serial(s.user_id, () => use(s.user_id, input)));
      const qr = /^\/api\/purchases\/([a-z0-9-]+)\/qr.svg$/.exec(url.pathname);
      if (req.method === 'GET' && qr) {
        const row = db.prepare('SELECT * FROM purchases WHERE id=? AND user_id=?').get(qr[1], s.user_id);
        if (!row || row.status !== 'READY') throw failure(404, '购买入口不存在');
        const value = safePurchase(storedResult(row), mode === 'mock' ? origin.origin : null);
        if (value.expire_time) {
          const stamp = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value.expire_time) ? value.expire_time.replace(' ', 'T') + '+08:00' : value.expire_time;
          const deadline = Date.parse(stamp);
          if (!Number.isFinite(deadline) || deadline <= Date.now()) throw failure(410, '购买入口已过期，请重新选择套餐');
        }
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end(await QRCode.toString(value.purchase_url, { type: 'svg', width: 240 }));
      }
      if (req.method === 'POST' && url.pathname === '/api/mock/complete' && mode === 'mock') { await serial(s.user_id, () => provider.complete(s.user_id, input.id)); return send(200, { ok: true }); }
      throw failure(404, '页面不存在');
    } catch (error) {
      // Never send upstream bodies, credentials or full internal errors to browsers.
      send(error.userFacing ? error.status : 502, { error: error.userFacing ? error.message : '服务暂时不可用，请重试', ...(error.userFacing ? error.extra : {}) });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  return { server, db, provider, close: () => new Promise(resolve => server.close(() => { db.close(); resolve(); })) };
}
if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, '127.0.0.1', () => console.log(`opcpay example: ${process.env.PUBLIC_ORIGIN || 'http://localhost:' + port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit(0)));
}
