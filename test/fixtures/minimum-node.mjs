import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { opcpay } from '../../index.mjs';
import { installSkill } from '../../scripts/install-skill.mjs';
const fetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(options.redirect, 'error');
  return new Response(JSON.stringify({ ok: true }));
};
try { assert.equal((await new opcpay({ apiKey: 'fixture' }).capabilities()).ok, true); }
finally { globalThis.fetch = fetch; }
const dir = await mkdtemp(join(tmpdir(), 'opcpay-node-min-'));
try {
  await installSkill({ project: dir, agent: 'both' });
  for (const agent of ['.agents', '.claude']) assert.match(await readFile(join(dir, agent, 'skills/opcpay/SKILL.md'), 'utf8'), /name: opcpay/);
} finally { await rm(dir, { recursive: true }); }
console.log(process.version, 'PASS SDK fetch and both skill installs');
