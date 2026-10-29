"""User journeys against a real local server; only the payment provider is simulated."""
import os
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
    for engine in (pw.chromium, pw.webkit):
        for width in (390, 1440):
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            origin = f'http://127.0.0.1:{port}'
            with tempfile.TemporaryDirectory(prefix='opcpay-user-errors-') as temp:
                env = {**os.environ, 'PAYMENT_MODE': 'mock', 'PORT': str(port), 'PUBLIC_ORIGIN': origin, 'DATABASE_PATH': str(Path(temp) / 'state.sqlite'), 'DEMO_PASSWORD': 'local-demo-password'}
                proc = subprocess.Popen(['node', 'examples/node/server.mjs'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                browser = None
                try:
                    for _ in range(60):
                        try:
                            urllib.request.urlopen(origin, timeout=.2).close()
                            break
                        except Exception:
                            if proc.poll() is not None:
                                raise RuntimeError('server stopped')
                            time.sleep(.1)
                    browser = engine.launch()
                    page = browser.new_page(viewport={'width': width, 'height': 900})
                    errors = []
                    page.on('pageerror', lambda e: errors.append(str(e)))
                    page.goto(origin)
                    page.get_by_label('示例账号密码').fill('wrong-password')
                    page.get_by_role('button', name='登录示例账号').click()
                    expect(page.locator('#status')).to_have_text('密码不正确')
                    page.get_by_label('示例账号密码').fill('local-demo-password')
                    page.get_by_role('button', name='登录示例账号').click()
                    expect(page.locator('#balance')).to_have_text('剩余 0 次')
                    page.locator('#use').click()
                    expect(page.locator('#status')).to_contain_text('额度不足')
                    expect(page.locator('#receipts li')).to_have_count(0)

                    # A failed checkout request can be retried without abandoning the saved intent.
                    page.route('**/api/purchase', lambda route: route.abort())
                    page.locator('.plan button').first.click()
                    expect(page.locator('#checkout-status')).not_to_have_text('正在打开…')
                    expect(page.locator('#qr')).not_to_be_visible()
                    page.get_by_role('button', name='关闭', exact=True).click()
                    page.unroute('**/api/purchase')
                    page.locator('.plan button').first.click()
                    expect(page.locator('#qr')).to_be_visible()
                    page.locator('#mock-pay').click()
                    expect(page.locator('#balance')).to_have_text('剩余 3 次')

                    # The use succeeds on the server but its HTTP response never reaches the browser.
                    def lose_response(route):
                        route.fetch()
                        route.abort()
                    page.route('**/api/use', lose_response)
                    page.locator('#use').click()
                    expect(page.locator('#use')).to_be_enabled()
                    page.unroute('**/api/use')
                    page.reload()
                    expect(page.locator('#balance')).to_have_text('剩余 2 次')
                    expect(page.locator('#receipts li')).to_have_count(1)
                    page.locator('#use').click()  # Original action: delivery recovery, not another charge.
                    expect(page.locator('#status')).to_have_text('示例报告已生成')
                    expect(page.locator('#balance')).to_have_text('剩余 2 次')
                    expect(page.locator('#receipts li')).to_have_count(1)

                    # A slow older refresh must not overwrite the balance after a successful use.
                    held = []
                    def stale_state(route):
                        if not held:
                            held.append((route, route.fetch()))
                        else:
                            route.continue_()
                    page.route('**/api/state', stale_state)
                    page.locator('#refresh').click()
                    for _ in range(50):
                        if held:
                            break
                        page.wait_for_timeout(20)
                    assert held
                    page.locator('#use').click()
                    expect(page.locator('#balance')).to_have_text('剩余 1 次')
                    held[0][0].fulfill(response=held[0][1])
                    page.wait_for_timeout(150)
                    expect(page.locator('#balance')).to_have_text('剩余 1 次')
                    page.unroute('**/api/state')
                    page.locator('#use').click()
                    expect(page.locator('#balance')).to_have_text('剩余 0 次')
                    expect(page.locator('#receipts li')).to_have_count(3)
                    page.locator('#use').click()
                    expect(page.locator('#status')).to_contain_text('额度不足')
                    expect(page.locator('#receipts li')).to_have_count(3)

                    # Gateway HTML is not exposed as a parser stack/error to the person using the page.
                    page.route('**/api/state', lambda route: route.fulfill(status=502, content_type='text/html', body='<html>private gateway details</html>'))
                    page.locator('#refresh').click()
                    expect(page.locator('#status')).to_have_text('服务暂时不可用，请稍后重试')
                    page.unroute('**/api/state')
                    page.locator('#refresh').click()
                    expect(page.locator('#status')).to_have_text('权益已刷新')
                    page.locator('#logout').click()
                    expect(page.locator('#login')).to_be_visible()
                    expect(page.locator('#account')).not_to_be_visible()
                    page.reload()
                    expect(page.locator('#login')).to_be_visible()
                    assert not errors, errors
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                    print(engine.name, width, 'PASS wrong login, empty quota, offline checkout, lost use response, stale refresh, exhaustion, gateway error, logout')
                finally:
                    if browser:
                        browser.close()
                    proc.terminate()
                    proc.wait(timeout=10)
