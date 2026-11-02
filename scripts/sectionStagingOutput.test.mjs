import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cli = require.resolve('@playwright/test/cli');
test('Playwright efface son output par défaut mais conserve le manifeste avec output isolé', () => {
  const dir = mkdtempSync(join(tmpdir(), 'section-output-contract-'));
  try {
    const testModule = require.resolve('@playwright/test');
    writeFileSync(join(dir, 'probe.spec.cjs'), `const {test}=require(${JSON.stringify(testModule)});test('probe',()=>{});`);
    const run = outputDir => {
      writeFileSync(join(dir, 'playwright.config.cjs'), `module.exports={testDir:'.',testMatch:'probe.spec.cjs',workers:1,outputDir:${JSON.stringify(outputDir)},reporter:'dot'};`);
      const r = spawnSync(process.execPath, [cli,'test','--config',join(dir,'playwright.config.cjs')], {cwd:dir,encoding:'utf8',timeout:30000});
      assert.equal(r.status, 0, r.stderr);
    };
    run('test-results');
    const manifest = join(dir,'test-results','section-staging-manifest.json');
    writeFileSync(manifest,'{}'); run('test-results'); assert.equal(existsSync(manifest),false);
    writeFileSync(manifest,'{}'); run('test-results/playwright-section-output'); assert.equal(existsSync(manifest),true);
    assert.match(readFileSync(resolve('playwright.section-staging.config.mjs'),'utf8'), /outputDir: '\.\/test-results\/playwright-section-output'/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
