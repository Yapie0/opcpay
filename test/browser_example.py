"""Real local example, mock provider only. Optional: pip install playwright."""
import os
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(tempfile.mkdtemp(prefix='opcpay-ui-'))
print('Screenshots:', OUTPUT)
with sync_playwright() as pw:
    for engine in (pw.chromium, pw.webkit):
        for width in (390, 1440):
            with socket.socket() as s:
                s.bind(('127.0.0.1', 0))
                port = s.getsockname()[1]
            origin = f'http://127.0.0.1:{port}'
            with tempfile.TemporaryDirectory(prefix='opcpay-browser-') as temp:
                env = {**os.environ, 'PAYMENT_MODE': 'mock', 'PORT': str(port), 'PUBLIC_ORIGIN': origin, 'DATABASE_PATH': str(Path(temp) / 'data.sqlite'), 'DEMO_PASSWORD': 'local-demo-password'}
                proc = subprocess.Popen(['node', 'examples/node/server.mjs'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                browser = None
                try:
                    for _ in range(50):
                        try:
                            urllib.request.urlopen(origin, timeout=0.2).close()
                            break
                        except Exception:
                            if proc.poll() is not None:
                                raise RuntimeError('Example server failed to start')
                            time.sleep(0.1)
                    browser = engine.launch()
                    page = browser.new_page(viewport={'width': width, 'height': 900})
                    errors = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.goto(origin)
                    expect(page.locator('#mode')).to_contain_text('模拟模式')
                    page.get_by_label('示例账号密码').fill('local-demo-password')
                    page.get_by_role('button', name='登录示例账号').click()
                    expect(page.locator('.plan')).to_have_count(2)
                    page.locator('.plan button').first.click()
                    expect(page.locator('dialog')).to_be_visible()
                    expect(page.locator('#qr')).to_be_visible()
                    page.wait_for_function('document.querySelector("#qr").naturalWidth > 0')
                    page.get_by_role('button', name='模拟付款（不扣真实资金）').click()
                    expect(page.locator('#balance')).to_have_text('剩余 3 次')
                    page.locator('#use').click()
                    expect(page.locator('#balance')).to_have_text('剩余 2 次')
                    expect(page.locator('#receipts li')).to_have_count(1)
                    page.reload()
                    expect(page.locator('#receipts li')).to_have_count(1)
                    expect(page.locator('#balance')).to_have_text('剩余 2 次')
                    page.screenshot(path=str(OUTPUT / f'{engine.name}-{width}.png'), full_page=True)
                    # Explicit new purchase replaces only the selected intent, and still works in the same dialog.
                    page.locator('.plan button').first.click()
                    expect(page.locator('#qr')).to_be_visible()
                    previous_qr = page.locator('#qr').get_attribute('src')
                    page.locator('#new-purchase').click()
                    page.wait_for_function('(old) => !document.querySelector("#qr").hidden && document.querySelector("#qr").getAttribute("src") !== old', arg=previous_qr)
                    page.locator('#mock-pay').click()
                    expect(page.locator('#balance')).to_have_text('剩余 5 次')
                    # Closing a checkout never reopens it when its slow response arrives.
                    def slow(route):
                        time.sleep(0.3)
                        route.continue_()
                    page.route('**/api/purchase', slow)
                    page.locator('.plan button').last.click()
                    page.get_by_role('button', name='关闭', exact=True).click()
                    page.wait_for_timeout(500)
                    expect(page.locator('dialog')).not_to_be_visible()
                    assert not errors, errors
                    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'horizontal overflow'
                    print(engine.name, width, 'PASS login, plans, QR, mock payment, use, persistence, close, layout')
                finally:
                    if browser:
                        browser.close()
                    proc.terminate()
                    proc.wait(timeout=10)
