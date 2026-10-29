import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm, symlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { installSkill } from '../scripts/install-skill.mjs';

test('安装到两种工具的项目目录；已有内容需显式更新且保留备份', async () => {
  const project = await mkdtemp(join(tmpdir(), 'opcpay-skill-'));
  try {
    const installed = await installSkill({ project, agent: 'both' });
    assert.equal(installed.length, 2);
    for (const item of installed) assert.match(await readFile(join(item.destination, 'SKILL.md'), 'utf8'), /name: opcpay/);
    await writeFile(join(installed[0].destination, 'custom.txt'), 'original-user-file');
    await assert.rejects(() => installSkill({ project, agent: 'both' }), /already exists/);
    const updated = await installSkill({ project, agent: 'codex', force: true });
    assert.equal(await readFile(join(updated[0].backup, 'custom.txt'), 'utf8'), 'original-user-file');
    assert.deepEqual(await readdir(join(project, '.agents', 'skills')), ['opcpay']);
    assert.ok((await readFile(join(updated[0].destination, 'references', 'integration.md'), 'utf8')).includes('purchaseQuery'));
  } finally { await rm(project, { recursive: true }); }
});

test('不沿目标符号链接写入，也不修改无关应用文件', async () => {
  const project = await mkdtemp(join(tmpdir(), 'opcpay-link-'));
  const outside = await mkdtemp(join(tmpdir(), 'opcpay-outside-'));
  try {
    await writeFile(join(project, 'app.txt'), 'unchanged'); await symlink(outside, join(project, '.claude'));
    await assert.rejects(() => installSkill({ project, agent: 'both' }), /symlink/);
    assert.deepEqual(await readdir(outside), []);
    assert.equal(await readFile(join(project, 'app.txt'), 'utf8'), 'unchanged');
    await assert.rejects(() => installSkill({ project, agent: 'unknown' }), /agent/);
  } finally { await rm(project, { recursive: true }); await rm(outside, { recursive: true }); }
});

// npm exposes bin commands through a symlink; the CLI must still run.
test('通过 npm 风格符号链接运行 CLI 仍实际安装技能', async () => {
  const project = await mkdtemp(join(tmpdir(), 'opcpay-cli-'));
  try {
    const bin = join(project, 'opcpay-skill');
    await symlink(fileURLToPath(new URL('../scripts/install-skill.mjs', import.meta.url)), bin);
    const { stdout } = await promisify(execFile)(process.execPath, [bin, '--agent', 'both', '--project', project]);
    assert.equal(JSON.parse(stdout).length, 2);
    for (const agent of ['.agents', '.claude']) assert.match(await readFile(join(project, agent, 'skills/opcpay/SKILL.md'), 'utf8'), /name: opcpay/);
  } finally { await rm(project, { recursive: true }); }
});
