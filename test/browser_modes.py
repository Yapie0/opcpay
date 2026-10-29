"""Actual HTTPS browser journeys in live configuration, with an isolated fake provider."""
import os
import socket
import sqlite3
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='opcpay-tls-modes-') as temp, sync_playwright() as pw:
    temp = Path(temp)
    (temp / 'cert.cnf').write_text('[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n')
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', str(temp / 'key.pem'), '-out', str(temp / 'cert.pem'), '-config', str(temp / 'cert.cnf')], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for engine in (pw.chromium, pw.webkit):
        for mode in ('COUNT', 'POINT', 'ONE_TIME', 'ONE_TIME_DURATION'):
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            origin = f'https://127.0.0.1:{port}'
            database = temp / f'{engine.name}-{mode}.sqlite'
            env = {**os.environ, 'PORT': str(port), 'PUBLIC_ORIGIN': origin, 'DATABASE_PATH': str(database), 'TEST_BILLING_MODE': mode, 'TEST_TLS_KEY': str(temp / 'key.pem'), 'TEST_TLS_CERT': str(temp / 'cert.pem'), 'NODE_EXTRA_CA_CERTS': str(temp / 'cert.pem')}
            proc = subprocess.Popen(['node', 'test/fixtures/live-example.mjs'], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            browser = None
            try:
                assert proc.stdout.readline().strip() == 'READY', proc.stderr.read() if proc.poll() is not None else 'server failed'
                browser = engine.launch()
                page = browser.new_page(ignore_https_errors=True, viewport={'width': 390 if engine.name == 'webkit' else 1440, 'height': 900})
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.goto(origin)
                expect(page.locator('#mode')).to_contain_text('真实模式')
                page.get_by_label('示例账号密码').fill('private-fixture-password')
                page.get_by_role('button', name='登录示例账号').click()
                expect(page.locator('.plan')).to_have_count(1)
                expect(page.locator('.price')).to_have_text('6.00 CNY')
                cookies = page.context.cookies()
                assert cookies[0]['secure'] and cookies[0]['httpOnly'] and cookies[0]['sameSite'] == 'Lax'
                page.locator('#use').click()
                expect(page.locator('#status')).to_contain_text('额度不足')
                page.locator('.plan button').click()
                expect(page.locator('#qr')).to_be_visible()
                page.wait_for_function('() => document.querySelector("#qr").naturalWidth > 0')
                expect(page.locator('#mock-pay')).not_to_be_visible()
                expect(page.locator('#payment-link')).to_be_visible()
                assert page.locator('#payment-link').get_attribute('href').startswith(origin)
                page.get_by_role('button', name='关闭', exact=True).click()
                page.goto(origin + '/return?forged_payment_status=PAID')
                expect(page.locator('#receipts li')).to_have_count(0)
                # Simulate provider-side entitlement activation without real payment.
                with sqlite3.connect(database) as db:
                    db.execute("INSERT INTO mock_balances(user_id,total,used) VALUES ('example-user-1',3,0)")
                page.locator('#refresh').click()
                if mode in ('COUNT', 'POINT'):
                    expect(page.locator('#balance')).to_have_text('剩余 3 ' + ('次' if mode == 'COUNT' else '积分'))
                else:
                    expect(page.locator('#balance')).to_contain_text('权益可用')
                page.locator('#use').click()
                expect(page.locator('#status')).to_have_text('示例报告已生成')
                expect(page.locator('#receipts li')).to_have_count(1)
                if mode in ('COUNT', 'POINT'):
                    expect(page.locator('#balance')).to_have_text('剩余 2 ' + ('次' if mode == 'COUNT' else '积分'))
                with sqlite3.connect(database) as db:
                    used = db.execute('SELECT used FROM mock_balances').fetchone()[0]
                    assert used == (1 if mode in ('COUNT', 'POINT') else 0)
                assert not errors, errors
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                print(engine.name, mode, 'PASS browser → server → SDK → HTTPS provider fixture; plans, secure cookie, callback cannot grant, access/use, correct quota behavior')
            finally:
                if browser:
                    browser.close()
                proc.terminate()
                proc.communicate(timeout=10)
