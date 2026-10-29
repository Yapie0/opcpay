import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { opcpay, opcpayError } = await import(process.env.SDK_MODULE ? pathToFileURL(process.env.SDK_MODULE).href : '../../index.mjs');
const client = new opcpay({ apiKey: 'transport-fixture-only', baseURL: process.env.TEST_ORIGIN });
const user = 'user / 中文', id = 'original-operation';
const lists = { user_id: user, limit: 2, before_id: 'cursor' };
const cases = [
  ['capabilities', [], '/capabilities', 'GET'], ['product', [], '/product', 'GET'],
  ['access', [user, 2], '/access', 'POST', { user_id: user, amount: 2 }],
  ['purchase', [{ userId: user, idempotencyKey: id, skuId: 'sku', callbackURL: 'https://merchant.invalid/return' }], '/purchase', 'POST', { user_id: user, idempotency_key: id, sku_id: 'sku', callback_url: 'https://merchant.invalid/return' }],
  ['purchaseQuery', [user, id], '/purchase/query', 'POST', { user_id: user, idempotency_key: id }],
  ['purchases', [lists], '/purchases/list', 'POST', lists],
  ['consume', [{ userId: user, idempotencyKey: id, amount: 2, reason: 'report' }], '/consume', 'POST', { user_id: user, idempotency_key: id, amount: 2, reason: 'report' }],
  ['consumption', [user, id], '/consumption', 'POST', { user_id: user, idempotency_key: id }],
  ['consumptions', [lists], '/consumptions/list', 'POST', lists],
  ['webhook', [], '/webhook', 'GET'],
  ['saveWebhook', ['https://merchant.invalid/hook', false], '/webhook', 'PUT', { url: 'https://merchant.invalid/hook', enabled: false }],
  ['rotateWebhook', [], '/webhook/rotate', 'POST', {}], ['events', [lists], '/events/list', 'POST', lists],
  ['retryEvent', ['event / 中文'], '/events/event%20%2F%20%E4%B8%AD%E6%96%87/retry', 'POST', {}],
];
for (const [method, args, path, verb, body] of cases) {
  const result = await client[method](...args);
  assert.deepEqual(result, { path, method: verb, body: body ?? null, authorized: true });
}
for (const method of ['transactionQuery', 'transactions', 'refund', 'refundQuery', 'bills']) {
  await assert.rejects(() => client[method]({ fixture: true }), e => e instanceof opcpayError && e.status === 501 && e.code === 'CAPABILITY_NOT_AVAILABLE');
}
for (const [path, status, code, retryable] of [
  ['/unauthorized', 401, 'INVALID_API_KEY', false], ['/limited', 429, 'RATE_LIMITED', true],
  ['/gateway', 502, 'INVALID_RESPONSE', true], ['/malformed', 200, 'INVALID_RESPONSE', false], ['/null', 200, 'INVALID_RESPONSE', false],
]) {
  await assert.rejects(() => client.request(path), e => e instanceof opcpayError && e.status === status && e.code === code && e.retryable === retryable && e.requestId === 'transport-request' && !e.message.includes('private'));
}
await assert.rejects(() => client.request('/redirect'));
await assert.rejects(() => client.request('/disconnect'));
const originalTimeout = AbortSignal.timeout;
AbortSignal.timeout = ms => { assert.equal(ms, 60000); return originalTimeout(80); };
try { await assert.rejects(() => client.request('/slow')); } finally { AbortSignal.timeout = originalTimeout; }
console.log(JSON.stringify({ sdkMethods: cases.length + 5, transportFailures: 8 }));
