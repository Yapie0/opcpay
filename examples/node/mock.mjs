import { atomic } from './store.mjs';
export function mockProvider(db, origin, productOverride) {
  const product = productOverride || { product_name: '示例写作助手', capability_status: 'ENABLED', billing_mode: 'QUANTITY', quota_unit: 'COUNT', charging_options: [
    { sku_id: 'mock-small', display_name: '体验套餐', price: '1.00', currency: 'CNY', quota_unit: 'COUNT', quota_amount: 3 },
    { sku_id: 'mock-large', display_name: '常用套餐', price: '4.00', currency: 'CNY', quota_unit: 'COUNT', quota_amount: 15 }
  ] };
  const api = {
    async capabilities() { return { provider_configured: true, capabilities: { purchase_entry: true, entitlement_query: true, consumption: true } }; },
    async product() { return product; },
    async purchase({ idempotencyKey, skuId }) { return { status: 'READY', idempotency_key: idempotencyKey, purchase_url: origin + '/?mockPurchase=' + encodeURIComponent(idempotencyKey), charging_option: product.charging_options.find(p => p.sku_id === skuId) }; },
    async purchaseQuery(userId, id) { const row = db.prepare('SELECT result FROM purchases WHERE id=? AND user_id=?').get(id, userId); return { response: row?.result ? JSON.parse(row.result) : null }; },
    async access(userId, amount = 1) { const b = db.prepare('SELECT * FROM mock_balances WHERE user_id=?').get(userId) || { total: 0, used: 0 }; return { access_granted: b.total - b.used >= amount, requires_consumption: true, quota_unit: 'COUNT', total: b.total, used: b.used, remaining: b.total - b.used }; },
    async consume({ userId, idempotencyKey, amount }) {
      return atomic(db, () => {
        const old = db.prepare('SELECT result FROM mock_consumed WHERE id=?').get(idempotencyKey);
        if (old) return JSON.parse(old.result);
        const b = db.prepare('SELECT * FROM mock_balances WHERE user_id=?').get(userId) || { total: 0, used: 0 };
        const ok = b.total - b.used >= amount;
        const result = { status: ok ? 'SUCCEEDED' : 'FAILED', confirmed: ok, idempotency_key: idempotencyKey, quota_unit: 'COUNT', consumed: ok ? amount : 0, remaining: b.total - b.used - (ok ? amount : 0) };
        if (ok) db.prepare('UPDATE mock_balances SET used=used+? WHERE user_id=?').run(amount, userId);
        db.prepare('INSERT INTO mock_consumed VALUES (?,?)').run(idempotencyKey, JSON.stringify(result));
        return result;
      });
    },
    async consumption(userId, id) { const r = db.prepare('SELECT result FROM mock_consumed WHERE id=?').get(id); if (!r) throw Error('not found'); return JSON.parse(r.result); },
    complete(userId, id) {
      return atomic(db, () => {
        const p = db.prepare('SELECT * FROM purchases WHERE id=? AND user_id=?').get(id, userId);
        if (!p) throw Error('purchase missing');
        const plan = product.charging_options.find(x => x.sku_id === p.sku);
        if (!plan) throw Error('plan missing');
        if (db.prepare('INSERT OR IGNORE INTO mock_paid VALUES (?)').run(id).changes) {
          db.prepare('INSERT INTO mock_balances(user_id,total,used) VALUES (?,?,0) ON CONFLICT(user_id) DO UPDATE SET total=total+excluded.total').run(userId, plan.quota_amount);
        }
      });
    }
  };
  return api;
}
