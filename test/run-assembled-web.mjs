// Copyright (c) 2026 foo-hao. SPDX-License-Identifier: MIT
import { mkdtemp, copyFile, rm, realpath, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { 'dsh-root': { type: 'string' } } });
if (!values['dsh-root']) throw new Error('Pass --dsh-root pointing to a built DeepSeek Harness checkout.');
const dsh = await realpath(values['dsh-root']);
const revision = spawnSync('git', ['-C', dsh, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
const supported = 'c291e7961a515f6d7af9304e7fd1d257929aef26';
if (revision.status !== 0 || revision.stdout.trim() !== supported) {
  throw new Error('Build the documented DSH baseline ' + supported + ' before running this suite.');
}
const changes = spawnSync('git', ['-C', dsh, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' });
if (changes.status !== 0 || changes.stdout.trim() !== '') {
  throw new Error('The DSH baseline must have a clean tracked working tree.');
}
const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(dsh, 'apps/web/tests/quote-followup-integration-'));
try {
  const scenario = join(temporary, 'quote-followup.ts');
  await copyFile(join(plugin, 'test/integration/assembled-web.ts'), scenario);
  const overlay = join(temporary, 'plugin.overlay.yml');
  await writeFile(overlay, '- insert:\n    - id: quote-followup\n      name: ' + JSON.stringify(join(plugin, 'lib/index.js')) + '\n');
  // Keep interrupted runs outside DSH's broad *.e2e.ts discovery glob.
  // Each invocation selects only its own scenario through an inherited config.
  const config = join(temporary, 'vitest.config.mjs');
  await writeFile(config, 'import base from ' + JSON.stringify('../../../../vitest.web.config.ts') + ';\n' +
    'export default { ...base, test: { ...base.test, include: [' + JSON.stringify(relative(dsh, scenario).split(sep).join('/')) + '] } };\n');
  const child = spawn(process.execPath, [join(dsh, 'node_modules/vitest/vitest.mjs'), 'run', '--reporter=verbose', '--config',
    config, scenario], {
    cwd: dsh,
    env: { ...process.env, DSH_SNAPSHOT: 'replay', DSH_QUOTE_PLUGIN_ROOT: plugin, DSH_QUOTE_OVERLAY: overlay },
    stdio: 'inherit',
  });
  const forward = signal => child.kill(signal);
  const interrupt = () => forward('SIGINT');
  const terminate = () => forward('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    await new Promise((done, fail) => {
      child.once('error', fail);
      child.once('close', (code, signal) => {
        process.exitCode = signal ? 1 : code ?? 1;
        done();
      });
    });
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
