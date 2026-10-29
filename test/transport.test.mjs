import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);

test('实际 TLS 连接验证全部 19 个方法、HTTP 异常、超时、重定向和无自动重试', async t => {
  try { await exec('openssl', ['version']); } catch { return t.skip('TLS integration test requires openssl'); }
  const dir = await mkdtemp(join(tmpdir(), 'opcpay tls '));
  let server;
  try {
    await writeFile(join(dir, 'cert.cnf'), '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n');
    await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-config', join(dir, 'cert.cnf')]);
    const seen = [];
    server = createServer({ key: await readFile(join(dir, 'key.pem')), cert: await readFile(join(dir, 'cert.pem')) }, async (req, res) => {
      let raw = ''; for await (const chunk of req) raw += chunk;
      seen.push(req.url);
      res.setHeader('x-request-id', 'transport-request'); res.setHeader('content-type', 'application/json');
      if (req.url === '/disconnect') return req.socket.destroy();
      if (req.url === '/slow') return; // Child aborts; no real 60-second wait.
      if (req.url === '/redirect') { res.writeHead(302, { location: '/should-never-follow' }); return res.end(); }
      if (req.url === '/gateway') { res.writeHead(502, { 'content-type': 'text/html' }); return res.end('<html>private gateway diagnostics</html>'); }
      if (req.url === '/malformed') return res.end('{');
      if (req.url === '/null') return res.end('null');
      const status = req.url === '/unauthorized' ? 401 : req.url === '/limited' ? 429 : /^\/(transactions|refunds|bills)/.test(req.url) ? 501 : 200;
      res.writeHead(status);
      if (status !== 200) return res.end(JSON.stringify({ error: 'API rejected request', error_code: status === 401 ? 'INVALID_API_KEY' : status === 429 ? 'RATE_LIMITED' : 'CAPABILITY_NOT_AVAILABLE', retryable: status === 429 }));
      res.end(JSON.stringify({ path: req.url, method: req.method, body: raw ? JSON.parse(raw) : null, authorized: req.headers.authorization === 'Bearer transport-fixture-only' }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { stdout } = await exec(process.execPath, [fileURLToPath(new URL('./fixtures/https-consumer.mjs', import.meta.url))], {
      env: { ...process.env, TEST_ORIGIN: 'https://127.0.0.1:' + server.address().port, NODE_EXTRA_CA_CERTS: join(dir, 'cert.pem') }, timeout: 20000,
    });
    assert.equal(JSON.parse(stdout).sdkMethods, 19);
    assert.equal(seen.length, 27);
    assert.equal(seen.includes('/should-never-follow'), false);
    for (const path of ['/limited', '/gateway', '/disconnect', '/slow']) assert.equal(seen.filter(x => x === path).length, 1);
  } finally { if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } await rm(dir, { recursive: true }); }
});

test('SDK 的只读 CLI 经符号链接执行仍运行，不会静默退出', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opcpay cli '));
  try {
    const link = join(dir, 'read-product.mjs');
    await symlink(fileURLToPath(new URL('../index.mjs', import.meta.url)), link);
    const preload = join(dir, 'fixture.mjs');
    await writeFile(preload, 'globalThis.fetch = async () => new Response(JSON.stringify({provider_configured:true}), {status:200});');
    // The explicit import runner is supported on Node 18 without --import.
    const script = `await import(${JSON.stringify(new URL('file://' + preload).href)}); process.argv[1]=${JSON.stringify(link)}; process.argv[2]='capabilities'; await import(${JSON.stringify(new URL('file://' + link).href)});`;
    const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, opcpay_api_key: 'fixture' } });
    assert.equal(JSON.parse(stdout).provider_configured, true);
  } finally { await rm(dir, { recursive: true }); }
});

test('开发者通过 stdin 和 CommonJS 动态导入 SDK，不依赖脚本路径存在', async () => {
  const module = new URL('../index.mjs', import.meta.url).href;
  const run = exec(process.execPath, ['--input-type=module', '-']);
  run.child.stdin.end(`const {opcpay}=await import(${JSON.stringify(module)}); console.log(typeof opcpay);`);
  assert.equal((await run).stdout.trim(), 'function');
  const result = await exec(process.execPath, ['-e', `import(${JSON.stringify(module)}).then(m=>console.log(typeof m.opcpay));`]);
  assert.equal(result.stdout.trim(), 'function');
});
