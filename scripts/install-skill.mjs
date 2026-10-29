#!/usr/bin/env node
import { cp, mkdir, lstat, realpath, rename, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export async function installSkill({ project, agent, force = false }) {
  if (!['codex', 'claude', 'both'].includes(agent)) throw Error('--agent must be codex, claude or both');
  if (!project) throw Error('--project must point to an existing project directory');
  const root = await realpath(resolve(project));
  if (!(await lstat(root)).isDirectory()) throw Error('Project must be a directory');
  const source = new URL('../skills/opcpay/', import.meta.url);
  const targets = agent === 'both' ? ['.agents', '.claude'] : [agent === 'codex' ? '.agents' : '.claude'];
  // Preflight all targets before changing any existing skill.
  for (const parent of targets) for (const relative of [parent, parent + '/skills', parent + '/skills/opcpay', parent + '/opcpay-skill-backups']) {
    try { const s = await lstat(join(root, relative)); if (s.isSymbolicLink() || !s.isDirectory()) throw Error('Refusing non-directory/symlink destination: ' + relative); if (relative.endsWith('/opcpay') && !force) throw Error('Skill already exists: ' + relative + '; use --force to keep a backup and replace it'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const result = [];
  for (const parent of targets) {
    const directory = join(root, parent, 'skills'); await mkdir(directory, { recursive: true });
    const destination = join(directory, 'opcpay'); let backup;
    try { await readdir(destination); backup = join(root, parent, 'opcpay-skill-backups', String(Date.now())); await mkdir(join(root, parent, 'opcpay-skill-backups'), { recursive: true }); await rename(destination, backup); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await cp(source, destination, { recursive: true, errorOnExist: true, force: false }); }
    catch (error) { if (backup) { /* Keep both paths for manual recovery rather than delete user files. */ error.message += '; original skill backup: ' + backup; } throw error; }
    result.push({ destination, ...(backup ? { backup } : {}) });
  }
  return result;
}
if (process.argv[1] && existsSync(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log('Usage: opcpay-skill --agent codex|claude|both --project /path/to/project [--force]'); }
  else {
    try {
      const values = {}; for (let i = 0; i < args.length; i++) { if (args[i] === '--force') values.force = true; else if (['--project', '--agent'].includes(args[i]) && args[i+1]) values[args[i].slice(2)] = args[++i]; else throw Error('Unknown/incomplete argument: ' + args[i]); }
      console.log(JSON.stringify(await installSkill(values), null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
