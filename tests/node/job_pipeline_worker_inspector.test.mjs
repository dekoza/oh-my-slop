import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBrowserOpenCommand,
  parseJobWorkersArgs,
} from '../../extensions/job-pipeline/lib/worker-inspector.mjs';

test('parseJobWorkersArgs defaults to all cycles when no args are provided', () => {
  assert.deepEqual(parseJobWorkersArgs(''), {
    cycleFilter: 'all',
  });
});

test('parseJobWorkersArgs parses job id and numeric cycle filter', () => {
  assert.deepEqual(parseJobWorkersArgs('job-2026-05-04-aaaa1111 --cycle 2'), {
    jobId: 'job-2026-05-04-aaaa1111',
    cycleFilter: 2,
  });
});

test('parseJobWorkersArgs accepts --cycle all explicitly', () => {
  assert.deepEqual(parseJobWorkersArgs('--cycle all'), {
    cycleFilter: 'all',
  });
});

test('parseJobWorkersArgs rejects missing or invalid cycle values', () => {
  assert.match(parseJobWorkersArgs('--cycle').error ?? '', /missing value/i);
  assert.match(parseJobWorkersArgs('--cycle nope').error ?? '', /invalid --cycle value/i);
  assert.match(parseJobWorkersArgs('--cycle 0').error ?? '', /invalid --cycle value/i);
});

test('parseJobWorkersArgs rejects unknown flags and extra positional arguments', () => {
  assert.match(parseJobWorkersArgs('--bogus').error ?? '', /unknown/i);
  assert.match(parseJobWorkersArgs('job-1 job-2').error ?? '', /unexpected extra argument/i);
});

test('buildBrowserOpenCommand uses xdg-open on linux', () => {
  assert.deepEqual(buildBrowserOpenCommand('/tmp/proof.html', { platform: 'linux' }), {
    command: 'xdg-open',
    args: ['/tmp/proof.html'],
  });
});

test('buildBrowserOpenCommand uses open on macOS', () => {
  assert.deepEqual(buildBrowserOpenCommand('/tmp/proof.html', { platform: 'darwin' }), {
    command: 'open',
    args: ['/tmp/proof.html'],
  });
});

test('buildBrowserOpenCommand uses cmd /c start on windows', () => {
  assert.deepEqual(buildBrowserOpenCommand('C:/temp/proof.html', { platform: 'win32' }), {
    command: 'cmd',
    args: ['/c', 'start', '', 'C:/temp/proof.html'],
  });
});
