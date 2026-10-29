const $ = id => document.getElementById(id);
let session, state, checkoutId, checkoutAction, polling = false, checkoutGeneration = 0, checkoutPlan;
async function api(path, input) {
  const response = await fetch(path, { method: input === undefined ? 'GET' : 'POST', headers: input === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf }, body: input === undefined ? undefined : JSON.stringify(input) });
  const value = await response.json();
  if (!response.ok) throw Object.assign(Error(value.error || '请求失败'), { value });
  return value;
}
function message(text) { $('status').textContent = text; }
function actionKey(name) { return session.user.id + ':' + name; }
function savedAction(name) {
  const key = actionKey(name); let id = sessionStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(key, id); }
  return id;
}
async function refresh() {
  state = await api('/api/state');
  const { product: p, access: a } = state;
  $('balance').textContent = p.billing_mode === 'QUANTITY' ? `剩余 ${a.remaining ?? '未知'} ${p.quota_unit === 'POINT' ? '积分' : '次'}` : a.access_granted && a.decision === 'ALLOW' ? `权益可用${a.valid_until ? '，有效期至 ' + a.valid_until : ''}` : '尚无可用权益';
  if (state.pendingActionId) sessionStorage.setItem(actionKey('use'), state.pendingActionId);
  $('use').textContent = state.pendingActionId ? '恢复上一次报告' : `生成示例报告${p.billing_mode === 'QUANTITY' ? '（消耗 1 ' + (p.quota_unit === 'POINT' ? '积分' : '次') + '）' : ''}`;
  $('plans').replaceChildren();
  for (const plan of p.charging_options || []) {
    const card = document.createElement('article'); card.className = 'plan';
    const title = document.createElement('h3'); title.textContent = plan.display_name || '套餐';
    const price = document.createElement('p'); price.className = 'price'; price.textContent = `${plan.price ?? '以购买页为准'} ${plan.currency || ''}`;
    const detail = document.createElement('p'); detail.textContent = plan.quota_amount != null ? `${plan.quota_amount} ${plan.quota_unit === 'POINT' ? '积分' : '次'}` : plan.duration_period || '永久使用';
    const buy = document.createElement('button'); buy.textContent = '购买'; buy.disabled = p.capability_status !== 'ENABLED'; buy.onclick = () => checkout(plan);
    card.append(title, price, detail, buy); $('plans').append(card);
  }
  $('receipts').replaceChildren();
  for (const receipt of state.receipts) { const li = document.createElement('li'); li.textContent = `${receipt.text} · ${receipt.createdAt}`; $('receipts').append(li); }
}
async function boot() {
  session = await api('/api/session');
  $('mode').textContent = session.mode === 'mock' ? '模拟模式：套餐和付款均为演示数据，不会发生真实收款。' : '真实模式：点击购买后会进入支付宝，实际付款以支付宝页面为准。';
  $('login').hidden = Boolean(session.user); $('account').hidden = !session.user;
  if (session.user) await refresh();
}
async function checkout(plan) {
  checkoutPlan = plan; $('new-purchase').hidden = true; checkoutId = null; checkoutAction = 'purchase:' + plan.sku_id; const generation = ++checkoutGeneration;
  $('checkout-title').textContent = plan.display_name || '购买套餐'; $('checkout-status').textContent = '正在打开…';
  $('qr').hidden = true; $('payment-link').hidden = true; $('mock-pay').hidden = true;
  if (!$('checkout').open) $('checkout').showModal();
  try {
    const result = await api('/api/purchase', { actionId: savedAction(checkoutAction), skuId: plan.sku_id });
    if (generation !== checkoutGeneration || !$('checkout').open) return;
    if (['FAILED', 'EXPIRED'].includes(result.status)) { sessionStorage.removeItem(actionKey(checkoutAction)); throw Error('购买入口已失效，请关闭后重新选择套餐'); }
    if (result.status !== 'READY') throw Error('暂未确认购买入口，请关闭后点击同一套餐恢复');
    checkoutId = result.id; $('new-purchase').hidden = false;
    $('checkout-status').textContent = result.charging_option ? `套餐价：${result.charging_option.price} ${result.charging_option.currency || ''}；以支付宝确认页为准。` : '请在支付宝确认套餐与价格。';
    $('qr').src = '/api/purchases/' + encodeURIComponent(result.id) + '/qr.svg'; $('qr').hidden = false;
    $('payment-link').href = result.purchase_url; $('payment-link').hidden = session.mode === 'mock';
    $('mock-pay').hidden = session.mode !== 'mock';
  } catch (error) {
    if (error.value?.pendingActionId) sessionStorage.setItem(actionKey('purchase:' + error.value.skuId), error.value.pendingActionId);
    if (generation === checkoutGeneration && $('checkout').open) $('checkout-status').textContent = error.message;
  }
}
$('qr').onerror = () => { $('qr').hidden = true; $('checkout-status').textContent = '二维码暂不可用，请关闭后重试，或新建购买入口。'; };
$('new-purchase').onclick = () => { sessionStorage.removeItem(actionKey(checkoutAction)); checkout(checkoutPlan); };
$('checkout').addEventListener('close', () => { checkoutGeneration++; });
$('login').onsubmit = async event => { event.preventDefault(); try { await api('/api/login', { password: $('password').value }); $('password').value = ''; await boot(); message('已登录'); } catch (e) { message(e.message); } };
$('logout').onclick = async () => { try { await api('/api/logout', {}); await boot(); } catch (e) { message(e.message); } };
$('refresh').onclick = async () => { try { await refresh(); message('权益已刷新'); } catch (e) { message(e.message); } };
$('mock-pay').onclick = async () => { if (!checkoutId) return; try { await api('/api/mock/complete', { id: checkoutId }); await refresh(); $('checkout').close(); if (checkoutAction) sessionStorage.removeItem(actionKey(checkoutAction)); message('模拟付款完成，额度已增加'); } catch (e) { $('checkout-status').textContent = e.message; } };
$('paid').onclick = async () => {
  if (polling) return; polling = true; $('paid').disabled = true;
  try {
    // Bounded refresh is an entitlement check, never a paid-order confirmation.
    for (let i = 0; i < 3; i++) { await refresh(); if (state.access.access_granted) break; if (i < 2) await new Promise(r => setTimeout(r, 1500)); }
    $('checkout-status').textContent = state.access.access_granted ? '当前权益可用，可以关闭窗口继续使用。' : '暂未查到可用权益，请稍后手动刷新，勿重复付款。';
  } catch (e) { $('checkout-status').textContent = e.message; } finally { polling = false; $('paid').disabled = false; }
};
$('use').onclick = async () => {
  $('use').disabled = true;
  try {
    const result = await api('/api/use', { actionId: savedAction('use') });
    if (result.status === 'DELIVERED' || result.status === 'FAILED') sessionStorage.removeItem(actionKey('use'));
    message(result.status === 'DELIVERED' ? '示例报告已生成' : result.purchaseRequired ? '额度不足，请先购买套餐' : result.status === 'UNKNOWN' ? '本次使用尚待确认，请点击恢复上一次报告。' : '本次使用未完成，请刷新权益后重试');
    await refresh();
  } catch (e) { if (e.value?.pendingActionId) sessionStorage.setItem(actionKey('use'), e.value.pendingActionId); message(e.message); }
  finally { $('use').disabled = false; }
};
boot().catch(e => message(e.message));
