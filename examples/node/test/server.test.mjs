import test from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';
import { openStore } from '../store.mjs';
import { mockProvider } from '../mock.mjs';

async function fixture(options = {}) {
  const env = { PAYMENT_MODE: 'mock', PUBLIC_ORIGIN: 'http://localhost:3000', DEMO_PASSWORD: 'local-demo-password', ...options.env };
  const app = createApp({ env, db: options.db || openStore(':memory:'), provider: options.provider });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  let cookie = '', csrf = '';
  const request = async (path, input, extra = {}, chunks) => {
    const payload = input === undefined ? undefined : JSON.stringify(input);
    const response = await new Promise((resolve, reject) => {
      const req = httpRequest(base + path, { method: input === undefined ? 'GET' : 'POST', headers: { Host: new URL(env.PUBLIC_ORIGIN).host, Cookie: cookie, ...(input === undefined ? {} : { Origin: env.PUBLIC_ORIGIN, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }), ...extra } }, res => {
        let text = ''; res.setEncoding('utf8'); res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
      }); req.on('error', reject);
      if (chunks) (async () => { for (const chunk of chunks) { req.write(chunk); await new Promise(resolve => setTimeout(resolve, 10)); } req.end(); })().catch(reject);
      else req.end(payload);
    });
    if (response.headers['set-cookie']) cookie = response.headers['set-cookie'][0].split(';')[0];
    const text = response.text;
    let value; try { value = JSON.parse(text); } catch { value = text; }
    return { status: response.status, value, response };
  };
  async function session() { const r = await request('/api/session'); csrf = r.value.csrf; return r; }
  async function login() { await session(); const r = await request('/api/login', { password: env.DEMO_PASSWORD }); assert.equal(r.status, 200); await session(); }
  async function fund() { const p = await request('/api/purchase', { actionId: randomUUID(), skuId: 'mock-small' }); assert.equal(p.value.status, 'READY'); assert.equal((await request('/api/mock/complete', { id: p.value.id })).status, 200); return p.value; }
  return { ...app, request, session, login, fund, csrf: () => csrf };
}

test('会话、CSRF、实际档位和模拟付款不重复加额度', async () => {
  const app = await fixture();
  try {
    assert.equal((await app.request('/api/state')).status, 401);
    await app.login();
    assert.equal((await app.request('/api/purchase', { actionId: randomUUID(), skuId: 'nonexistent' })).status, 400);
    assert.equal((await app.request('/api/use', { actionId: randomUUID() }, { Origin: 'https://evil.invalid' })).status, 403);
    assert.equal((await app.request('/api/use', { actionId: randomUUID() }, { 'X-CSRF-Token': 'wrong' })).status, 403);
    const p = await app.fund();
    await app.request('/api/mock/complete', { id: p.id });
    const state = await app.request('/api/state');
    assert.deepEqual(state.value.product.charging_options.map(x => x.quota_amount), [3, 15]);
    assert.equal(state.value.access.remaining, 3);
    const qr = await app.request('/api/purchases/' + p.id + '/qr.svg');
    assert.equal(qr.status, 200); assert.match(qr.value, /<svg/);
    assert.doesNotMatch(JSON.stringify(state.value), /opcpay_api_key|local-demo-password/);
  } finally { await app.close(); }
});

test('同一操作并发和响应丢失重试均只核销和交付一次', async () => {
  const app = await fixture();
  try {
    await app.login(); await app.fund(); const actionId = randomUUID();
    const results = await Promise.all(Array.from({ length: 4 }, () => app.request('/api/use', { actionId, userId: 'forged', amount: 10000 })));
    for (const r of results) { assert.equal(r.status, 200); assert.equal(r.value.status, 'DELIVERED'); }
    assert.equal(app.db.prepare('SELECT count(*) AS n FROM mock_consumed').get().n, 1);
    assert.equal(app.db.prepare('SELECT count(*) AS n FROM receipts').get().n, 1);
    assert.equal((await app.request('/api/state')).value.access.remaining, 2);
    assert.equal((await app.request('/api/use', { actionId })).value.receipt.id, results[0].value.receipt.id);
  } finally { await app.close(); }
});

test('扣减成功但网络中断后按原号恢复，不再次扣减', async () => {
  const db = openStore(':memory:'); const provider = mockProvider(db, 'http://localhost:3000');
  const consume = provider.consume; let first = true;
  provider.consume = async input => { const result = await consume(input); if (first) { first = false; throw Error('lost response'); } return result; };
  const app = await fixture({ db, provider });
  try {
    await app.login(); await app.fund(); const actionId = randomUUID();
    assert.equal((await app.request('/api/use', { actionId })).value.status, 'UNKNOWN');
    assert.equal(app.db.prepare('SELECT count(*) AS n FROM receipts').get().n, 0);
    const blocked = await app.request('/api/use', { actionId: randomUUID() });
    assert.equal(blocked.status, 409); assert.equal(blocked.value.pendingActionId, actionId);
    assert.equal((await app.request('/api/use', { actionId })).value.status, 'DELIVERED');
    assert.equal((await app.request('/api/state')).value.access.remaining, 2);
    assert.equal(app.db.prepare('SELECT count(*) AS n FROM mock_consumed').get().n, 1);
  } finally { await app.close(); }
});

test('交付失败保留已确认核销；修复后原号只交付一次', async () => {
  const app = await fixture();
  try {
    await app.login(); await app.fund(); const actionId = randomUUID();
    app.db.exec("CREATE TRIGGER block_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'test delivery failure'); END;");
    assert.equal((await app.request('/api/use', { actionId })).status, 502);
    assert.equal(app.db.prepare('SELECT status FROM jobs').get().status, 'CONFIRMED');
    app.db.exec('DROP TRIGGER block_receipt');
    assert.equal((await app.request('/api/use', { actionId })).value.status, 'DELIVERED');
    assert.equal((await app.request('/api/state')).value.access.remaining, 2);
    assert.equal(app.db.prepare('SELECT count(*) AS n FROM receipts').get().n, 1);
  } finally { await app.close(); }
});

test('未知购买使用原编号恢复，参数冲突拒绝，不信任客户端身份', async () => {
  const db = openStore(':memory:'); const provider = mockProvider(db, 'http://localhost:3000');
  const purchase = provider.purchase; let first = true; const ids = [];
  provider.purchase = async input => {
    ids.push(input.idempotencyKey); assert.ok(db.prepare('SELECT id FROM purchases WHERE id=?').get(input.idempotencyKey));
    assert.equal(input.userId, 'example-user-1'); const result = await purchase(input);
    if (first) { first = false; throw Error('network failed'); } return result;
  };
  const app = await fixture({ db, provider });
  try {
    await app.login(); const actionId = randomUUID();
    const input = { actionId, skuId: 'mock-small', userId: 'forged', price: '0.01' };
    assert.equal((await app.request('/api/purchase', input)).value.status, 'UNKNOWN');
    assert.equal((await app.request('/api/purchase', { ...input, skuId: 'mock-large' })).status, 409);
    assert.equal((await app.request('/api/purchase', input)).value.status, 'READY');
    assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
  } finally { await app.close(); }
});

test('实际扣减数量或用户权益不匹配时不交付', async () => {
  const db = openStore(':memory:'); const provider = mockProvider(db, 'http://localhost:3000');
  provider.consume = async ({ idempotencyKey }) => ({ status: 'SUCCEEDED', confirmed: true, idempotency_key: idempotencyKey, quota_unit: 'COUNT', consumed: 999 });
  const app = await fixture({ db, provider });
  try {
    await app.login(); await app.fund();
    assert.equal((await app.request('/api/use', { actionId: randomUUID() })).value.status, 'UNKNOWN');
    assert.equal(db.prepare('SELECT count(*) AS n FROM receipts').get().n, 0);
  } finally { await app.close(); }
});

test('买断和时长严格按 ALLOW 放行，不调用核销', async () => {
  for (const billing_mode of ['ONE_TIME', 'ONE_TIME_DURATION']) {
    const db = openStore(':memory:'); const provider = mockProvider(db, 'http://localhost:3000');
    provider.product = async () => ({ capability_status: 'ENABLED', billing_mode, charging_options: [] });
    provider.access = async () => ({ access_granted: true, decision: 'ALLOW' });
    provider.consume = async () => { throw Error('must not consume'); };
    const app = await fixture({ db, provider });
    try { await app.login(); assert.equal((await app.request('/api/use', { actionId: randomUUID() })).value.status, 'DELIVERED'); }
    finally { await app.close(); }
  }
});

test('重启仍保留业务号和交付回执', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'opcpay-restart-')); const path = join(dir, 'data.sqlite');
  let app = await fixture({ db: openStore(path) }); const actionId = randomUUID();
  try {
    await app.login(); await app.fund(); const original = await app.request('/api/use', { actionId });
    await app.close(); app = await fixture({ db: openStore(path) }); await app.login();
    const restored = await app.request('/api/use', { actionId });
    assert.equal(restored.value.receipt.id, original.value.receipt.id);
    assert.equal((await app.request('/api/state')).value.access.remaining, 2);
  } finally { await app.close(); rmSync(dir, { recursive: true }); }
});

test('真实模式拒绝演示配置，关闭模拟付款入口，匿名无上游调用', async () => {
  assert.throws(() => createApp({ env: { PAYMENT_MODE: 'live', PUBLIC_ORIGIN: 'http://localhost:3000' } }), /HTTPS/);
  assert.throws(() => createApp({ env: { PAYMENT_MODE: 'live', PUBLIC_ORIGIN: 'https://example.invalid', opcpay_api_key: 'fixture' } }), /DEMO_PASSWORD/);
  const db = openStore(':memory:'); const provider = mockProvider(db, 'https://example.invalid'); let called = 0;
  provider.product = async () => { called++; throw Error('should not run'); };
  const app = await fixture({ db, provider, env: { PAYMENT_MODE: 'live', PUBLIC_ORIGIN: 'https://example.invalid', opcpay_api_key: 'fixture', DEMO_PASSWORD: 'private-long-password' } });
  try {
    assert.equal((await app.request('/api/state')).status, 401); assert.equal(called, 0);
    await app.login(); assert.equal((await app.request('/api/mock/complete', { id: 'none' })).status, 404);
  } finally { await app.close(); }
});

test('购买二维码仅属于当前登录用户，过期入口拒绝继续展示', async () => {
  const app = await fixture();
  try {
    await app.login(); const p = await app.fund();
    const id = 'b'.repeat(64), csrf = 'other-user-csrf';
    app.db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(id, 'another-user', csrf, Date.now() + 60000);
    assert.equal((await app.request('/api/purchases/' + p.id + '/qr.svg', undefined, { Cookie: 'opcpay_example=' + id })).status, 404);
    const row = app.db.prepare('SELECT result FROM purchases WHERE id=?').get(p.id);
    app.db.prepare('UPDATE purchases SET result=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(row.result), expire_time: '2000-01-01 00:00:00' }), p.id);
    assert.equal((await app.request('/api/purchases/' + p.id + '/qr.svg')).status, 410);
  } finally { await app.close(); }
});

test('积分按服务端固定费用核销；买断 DENY 不放行', async () => {
  const db = openStore(':memory:'); const provider = mockProvider(db, 'http://localhost:3000');
  provider.product = async () => ({ billing_mode: 'QUANTITY', quota_unit: 'POINT' });
  provider.access = async () => ({ access_granted: true, requires_consumption: true, quota_unit: 'POINT', remaining: 5 });
  provider.consumption = async () => { throw Error('missing'); };
  provider.consume = async input => {
    assert.equal(input.amount, 1); assert.equal(input.reason, '示例报告生成');
    return { status: 'SUCCEEDED', confirmed: true, idempotency_key: input.idempotencyKey, consumed: 1, quota_unit: 'POINT' };
  };
  const app = await fixture({ db, provider });
  try {
    await app.login(); assert.equal((await app.request('/api/use', { actionId: randomUUID(), amount: 999, reason: 'forged' })).value.status, 'DELIVERED');
    provider.product = async () => ({ billing_mode: 'ONE_TIME' });
    provider.access = async () => ({ access_granted: true, decision: 'DENY' });
    assert.equal((await app.request('/api/use', { actionId: randomUUID() })).value.status, 'FAILED');
    assert.equal(db.prepare('SELECT count(*) AS n FROM receipts').get().n, 1);
  } finally { await app.close(); }
});

test('不把上游错误正文或凭证返回浏览器', async () => {
  const db = openStore(':memory:'); const provider = mockProvider(db, 'http://localhost:3000');
  provider.product = async () => { throw Object.assign(Error('private-upstream-diagnostic'), { status: 401, body: { token: 'secret-fixture' } }); };
  const app = await fixture({ db, provider });
  try {
    await app.login(); const r = await app.request('/api/state');
    assert.equal(r.status, 502); assert.doesNotMatch(JSON.stringify(r.value), /private-upstream|secret-fixture/);
  } finally { await app.close(); }
});


test('切换 mock/live 必须隔离已有演示数据库，不能恢复模拟核销为真实请求', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'opcpay-mode-'));
  const path = join(dir, 'data.sqlite');
  let app = await fixture({ db: openStore(path) });
  try {
    await app.login(); await app.fund();
    await app.close(); app = null;
    const db = openStore(path);
    try {
      assert.throws(() => createApp({ db, env: { PAYMENT_MODE: 'live', PUBLIC_ORIGIN: 'https://example.invalid', opcpay_api_key: 'fixture', DEMO_PASSWORD: 'private-long-password' } }), /DATABASE_PATH|mode|模式/);
    } finally { db.close(); }
  } finally { if (app) await app.close(); rmSync(dir, { recursive: true }); }
});

test('非法输入、过期会话、跨站请求、限流和回跳不能产生消费', async t => {
  const app = await fixture();
  try {
    await app.login();
    const cases = [
      ['短业务号', '/api/use', { actionId: 'short' }, {}, 400],
      ['无业务号', '/api/use', {}, {}, 400],
      ['数组请求体', '/api/use', [], {}, 400],
      ['过大请求体', '/api/use', { data: 'x'.repeat(9000) }, {}, 413],
      ['错误内容类型', '/api/use', {}, { 'Content-Type': 'text/plain' }, 415],
      ['错误Host', '/api/use', {}, { Host: 'evil.invalid' }, 400],
      ['缺少Origin', '/api/use', {}, { Origin: '' }, 403],
      ['无效CSRF', '/api/use', {}, { 'X-CSRF-Token': '' }, 403],
      ['无效套餐类型', '/api/purchase', { actionId: randomUUID(), skuId: 3 }, {}, 400],
      ['未知API', '/api/does-not-exist', {}, {}, 404],
    ];
    for (const [name, path, body, headers, status] of cases) await t.test(name, async () => assert.equal((await app.request(path, body, headers)).status, status));
    assert.equal((await app.request('/return')).status, 200);
    assert.equal(app.db.prepare('SELECT count(*) AS n FROM jobs').get().n, 0);
    assert.equal(app.db.prepare('SELECT count(*) AS n FROM purchases').get().n, 0);
    app.db.prepare('UPDATE sessions SET expires=0').run();
    assert.equal((await app.request('/api/state')).status, 401);
    await app.session();
    for (let i = 0; i < 9; i++) assert.equal((await app.request('/api/login', { password: 'wrong' })).status, 401);
    assert.equal((await app.request('/api/login', { password: 'wrong' })).status, 429);
  } finally { await app.close(); }
});

test('额度耗尽、失败重放与不同操作并发不会超扣', async () => {
  const app = await fixture();
  try {
    await app.login(); const empty = randomUUID();
    const failed = await app.request('/api/use', { actionId: empty });
    assert.equal(failed.value.purchaseRequired, true);
    assert.equal(app.db.prepare('SELECT count(*) AS n FROM mock_consumed').get().n, 0);
    await app.fund();
    assert.equal((await app.request('/api/use', { actionId: empty })).value.status, 'FAILED');
    const results = await Promise.all(Array.from({ length: 8 }, () => app.request('/api/use', { actionId: randomUUID() })));
    assert.equal(results.filter(r => r.value.status === 'DELIVERED').length, 3);
    assert.equal((await app.request('/api/state')).value.access.remaining, 0);
    assert.equal(app.db.prepare('SELECT count(*) AS n FROM receipts').get().n, 3);
  } finally { await app.close(); }
});

test('各种不可信核销结果均不交付且阻止换号', async t => {
  const variants = [
    ['未确认', { status: 'SUCCEEDED', confirmed: false }], ['处理中', { status: 'PROCESSING' }],
    ['未知结果', { status: 'UNKNOWN' }], ['请求编号不同', { idempotency_key: 'different' }],
    ['核销单位不同', { quota_unit: 'POINT' }], ['核销量不同', { consumed: 2 }],
  ];
  for (const [name, override] of variants) await t.test(name, async () => {
    const db = openStore(':memory:'); const provider = mockProvider(db, 'http://localhost:3000');
    provider.consume = async input => ({ status: 'SUCCEEDED', confirmed: true, idempotency_key: input.idempotencyKey, consumed: 1, quota_unit: 'COUNT', ...override });
    const app = await fixture({ db, provider });
    try {
      await app.login(); await app.fund(); const actionId = randomUUID();
      assert.equal((await app.request('/api/use', { actionId })).value.status, 'UNKNOWN');
      assert.equal((await app.request('/api/use', { actionId: randomUUID() })).status, 409);
      assert.equal(db.prepare('SELECT count(*) AS n FROM receipts').get().n, 0);
    } finally { await app.close(); }
  });
});

test('权限、套餐与收费模式异常时不调用核销', async t => {
  const variants = [
    ['无上游配置', { provider_configured: false }, null, null],
    ['未开权益查询', { provider_configured: true, capabilities: {} }, null, null],
    ['未开核销', null, { billing_mode: 'QUANTITY', quota_unit: 'COUNT' }, null],
    ['未知收费模式', null, { billing_mode: 'UNKNOWN' }, null],
    ['未知数量单位', null, { billing_mode: 'QUANTITY', quota_unit: 'OTHER' }, null],
    ['次数无余额', null, null, { access_granted: false, remaining: 0 }],
    ['次数单位不符', null, null, { access_granted: true, requires_consumption: true, quota_unit: 'POINT', remaining: 9 }],
    ['买断无授权', null, { billing_mode: 'ONE_TIME' }, { access_granted: false, decision: 'ALLOW' }],
    ['时长已到期', null, { billing_mode: 'ONE_TIME_DURATION' }, { access_granted: false, decision: 'PURCHASE_REQUIRED' }],
    ['买断缺少决策', null, { billing_mode: 'ONE_TIME' }, { access_granted: true }],
  ];
  for (const [name, caps, product, access] of variants) await t.test(name, async () => {
    const db = openStore(':memory:'); const provider = mockProvider(db, 'http://localhost:3000'); let consumes = 0;
    if (caps) provider.capabilities = async () => caps;
    if (product) provider.product = async () => product;
    if (name === '未开核销') provider.capabilities = async () => ({ provider_configured: true, capabilities: { entitlement_query: true, consumption: false } });
    if (access) provider.access = async () => access;
    provider.consume = async () => { consumes++; throw Error('unexpected consume'); };
    const app = await fixture({ db, provider });
    try { await app.login(); const r = await app.request('/api/use', { actionId: randomUUID() }); assert.ok(r.status === 409 || r.value.status === 'FAILED'); assert.equal(consumes, 0); }
    finally { await app.close(); }
  });
});

test('购买恢复冻结原参数；未知结果阻止新购买，终态不重新写上游', async () => {
  const db = openStore(':memory:'); const provider = mockProvider(db, 'http://localhost:3000'); const inputs = [];
  provider.purchase = async input => { inputs.push(input); return { status: inputs.length === 1 ? 'UNKNOWN' : 'FAILED', idempotency_key: input.idempotencyKey }; };
  const app = await fixture({ db, provider });
  try {
    await app.login(); const original = { actionId: randomUUID(), skuId: 'mock-small' };
    assert.equal((await app.request('/api/purchase', original)).value.status, 'UNKNOWN');
    const blocked = await app.request('/api/purchase', { actionId: randomUUID(), skuId: 'mock-large' });
    assert.equal(blocked.status, 409); assert.equal(blocked.value.pendingActionId, original.actionId);
    assert.equal((await app.request('/api/purchase', original)).value.status, 'FAILED');
    assert.equal((await app.request('/api/purchase', original)).value.status, 'FAILED');
    assert.equal(inputs.length, 2); assert.deepEqual(inputs[0], inputs[1]);
    assert.equal(inputs[0].callbackURL, 'http://localhost:3000/return');
  } finally { await app.close(); }
});

test('拒绝无效购买URL，不展示外站HTTP、脚本或凭证URL', async t => {
  for (const purchase_url of ['javascript:alert(1)', 'http://evil.invalid/pay', 'https://user:password@example.invalid/pay', 'data:text/html,hello', 'not a URL']) await t.test(purchase_url.split(':')[0], async () => {
    const db = openStore(':memory:'); const provider = mockProvider(db, 'http://localhost:3000');
    provider.purchase = async ({ idempotencyKey }) => ({ status: 'READY', idempotency_key: idempotencyKey, purchase_url });
    const app = await fixture({ db, provider });
    try { await app.login(); const r = await app.request('/api/purchase', { actionId: randomUUID(), skuId: 'mock-small' }); assert.equal(r.value.status, 'UNKNOWN'); assert.equal((await app.request('/api/purchases/' + r.value.id + '/qr.svg')).status, 404); }
    finally { await app.close(); }
  });
});

test('UNKNOWN和已扣减未交付的任务在进程重启后恢复原核销与交付', async t => {
  for (const stage of ['UNKNOWN', 'CONFIRMED']) await t.test(stage, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opcpay-interrupted-')); const path = join(dir, 'data.sqlite');
    const db = openStore(path); const provider = mockProvider(db, 'http://localhost:3000');
    if (stage === 'UNKNOWN') { const consume = provider.consume; provider.consume = async input => { await consume(input); throw Error('lost response'); }; }
    let app = await fixture({ db, provider });
    try {
      await app.login(); await app.fund(); const actionId = randomUUID();
      if (stage === 'CONFIRMED') db.exec("CREATE TRIGGER block_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'interrupted'); END;");
      await app.request('/api/use', { actionId });
      assert.equal(db.prepare('SELECT status FROM jobs').get().status, stage);
      if (stage === 'CONFIRMED') db.exec('DROP TRIGGER block_receipt');
      await app.close(); app = await fixture({ db: openStore(path) }); await app.login();
      assert.equal((await app.request('/api/state')).value.pendingActionId, actionId);
      assert.equal((await app.request('/api/use', { actionId })).value.status, 'DELIVERED');
      assert.equal((await app.request('/api/state')).value.access.remaining, 2);
      assert.equal(app.db.prepare('SELECT count(*) AS n FROM mock_consumed').get().n, 1);
      assert.equal(app.db.prepare('SELECT count(*) AS n FROM receipts').get().n, 1);
    } finally { await app.close(); rmSync(dir, { recursive: true }); }
  });
});

test('启动配置错误明确拒绝，无隐式真实模式或不受信回跳地址', async t => {
  for (const [name, env] of [
    ['未知模式', { PAYMENT_MODE: 'production' }],
    ['Origin带路径', { PUBLIC_ORIGIN: 'https://merchant.invalid/path' }],
    ['Origin带查询', { PUBLIC_ORIGIN: 'https://merchant.invalid/?x=1' }],
    ['真实模式HTTP', { PAYMENT_MODE: 'live', PUBLIC_ORIGIN: 'http://merchant.invalid' }],
    ['真实模式无Key', { PAYMENT_MODE: 'live', PUBLIC_ORIGIN: 'https://merchant.invalid' }],
    ['真实模式演示密码', { PAYMENT_MODE: 'live', PUBLIC_ORIGIN: 'https://merchant.invalid', opcpay_api_key: 'fixture', DEMO_PASSWORD: 'local-demo-password' }],
    ['密码过短', { DEMO_PASSWORD: 'short' }],
  ]) await t.test(name, () => assert.throws(() => createApp({ env })));
});


test('中文密码跨网络分片时保持 UTF-8 原文', async () => {
  const password = '中文测试密码十二个字符-123456';
  const app = await fixture({ env: { DEMO_PASSWORD: password } });
  try {
    await app.session();
    const raw = Buffer.from(JSON.stringify({ password }));
    const split = raw.indexOf(Buffer.from('中')) + 1;
    const r = await app.request('/api/login', { password }, {}, [raw.subarray(0, split), raw.subarray(split)]);
    assert.equal(r.status, 200);
  } finally { await app.close(); }
});
