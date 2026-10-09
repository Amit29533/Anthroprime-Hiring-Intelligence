import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { linkedinCommand } from '../src/linkedinCommand.js';
const manifest = JSON.parse(
  readFileSync(new URL('../public/linkedin-local-extractor-manifest.json', import.meta.url)),
);

test('one command normalizes only a member URL, pins the archive and uses normal local login', () => {
  const script = linkedinCommand(
    'https://linkedin.com/in/Amit29533/?trk=test',
    manifest.archiveSha256,
  );
  assert.ok(script.includes("$anthroProfile = 'https://www.linkedin.com/in/amit29533/'"));
  assert.ok(script.includes(manifest.archiveSha256));
  assert.ok(script.indexOf('Get-FileHash') < script.indexOf('Expand-Archive'));
  assert.match(script, /--login --browser \$anthroBrowser --no-raw --out/);
  assert.match(script, /Set-Clipboard -Value \$anthroJson/);
  assert.match(script, /\[guid\]::NewGuid/);
  assert.ok(!/LI_AT|JSESSIONID|ExecutionPolicy|Invoke-Expression|Remove-Item/i.test(script));
  assert.ok(script.includes('https://pypi.org/simple'));
  assert.ok(script.includes("Write-Output ('ERROR during '"));
});

test('commands reject missing profiles, provider IDs, injection and invalid checksum input', () => {
  for (const profile of [
    '',
    '12345678',
    "amit'; Start-Process calc; '",
    'https://example.invalid/in/amit29533',
    'https://www.linkedin.com/in/amit29533/../../feed',
  ])
    assert.throws(() => linkedinCommand(profile, manifest.archiveSha256));
  assert.throws(() => linkedinCommand('amit29533', "'; bad"));
});

test(
  'dependency probe runs correctly in Windows PowerShell 5.1 and PowerShell 7',
  {
    skip:
      process.platform !== 'win32' ||
      !existsSync(
        join(process.env.LOCALAPPDATA || '', 'AnthroPrime/LinkedIn/runtime/Scripts/python.exe'),
      ),
  },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'anthro-probe-test-'));
    try {
      const path = join(root, 'probe.ps1');
      const probe = linkedinCommand('amit29533', manifest.archiveSha256)
        .split('\n')
        .find((line) => line.includes('importlib.util'));
      writeFileSync(
        path,
        "$ErrorActionPreference='Stop'\n$anthroPython=Join-Path $env:LOCALAPPDATA 'AnthroPrime/LinkedIn/runtime/Scripts/python.exe'\n" +
          probe +
          '\nWrite-Output $LASTEXITCODE',
      );
      for (const shell of [
        'pwsh',
        join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ]) {
        const result = spawnSync(shell, ['-NoProfile', '-File', path], {
          encoding: 'utf8',
          timeout: 20000,
        });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout.trim(), /^[01]$/);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'PowerShell command syntax, cached success, checksum refusal and extraction failure are verified without browser or network',
  { skip: process.platform !== 'win32' },
  () => {
    const root = mkdtempSync(join(tmpdir(), 'anthro-command-test-'));
    try {
      const path = join(root, 'command.ps1');
      writeFileSync(path, linkedinCommand('amit29533', manifest.archiveSha256));
      for (const scenario of [
        'success',
        'first-setup',
        'bad-hash',
        'extract-fail',
        'download-fail',
        'install-fail',
        'no-python',
      ]) {
        const result = spawnSync(
          'pwsh',
          [
            '-NoProfile',
            '-File',
            'tests/linkedin-command-harness.ps1',
            '-ScriptPath',
            path,
            '-ExpectedHash',
            manifest.archiveSha256,
            '-Scenario',
            scenario,
            '-FixtureRoot',
            root,
          ],
          { encoding: 'utf8', timeout: 20000 },
        );
        assert.equal(result.status, 0, result.stderr + result.stdout);
        assert.match(result.stdout, new RegExp(`PASS: ${scenario}`));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
