import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { startTrackedJob } from '../../extensions/job-pipeline/lib/job-lifecycle.mjs';
import { getJobSnapshotPath } from '../../extensions/job-pipeline/lib/job-store.mjs';
import { appendInterviewMessageAndPersist } from '../../extensions/job-pipeline/lib/interview-runtime.mjs';

function createExtensionHarnessWorkspace() {
  const workspace = mkdtempSync(join(tmpdir(), 'job-pipeline-extension-harness-'));
  const agentDir = join(workspace, 'agent');
  const extensionRoot = join(workspace, 'extensions', 'job-pipeline');
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(workspace, 'extensions'), { recursive: true });
  cpSync(join(process.cwd(), 'extensions', 'job-pipeline'), extensionRoot, { recursive: true });
  cpSync(
    join(process.cwd(), 'extensions', 'subagent-bundled-agents'),
    join(workspace, 'extensions', 'subagent-bundled-agents'),
    { recursive: true },
  );

  writeStubPackage(workspace, '@mariozechner/pi-coding-agent', `
export function getAgentDir() {
  return process.env.PI_AGENT_DIR;
}

export class DynamicBorder {
  constructor() {}
  render() {
    return [];
  }
}
`);

  writeStubPackage(workspace, '@mariozechner/pi-tui', `
export class Container {
  constructor() {
    this.children = [];
  }
  addChild(child) {
    this.children.push(child);
  }
}

export class Image {
  constructor(data, mediaType, theme, options) {
    this.data = data;
    this.mediaType = mediaType;
    this.theme = theme;
    this.options = options;
  }
}

export class SelectList {
  constructor() {}
}

export class Spacer {
  constructor(size) {
    this.size = size;
  }
}

export class Text {
  constructor(text, paddingX = 0, paddingY = 0) {
    this.text = text;
    this.paddingX = paddingX;
    this.paddingY = paddingY;
  }
  setText(text) {
    this.text = text;
  }
}

export function truncateToWidth(text, width) {
  return String(text).slice(0, width);
}

export function visibleWidth(text) {
  return String(text).length;
}
`);

  writeStubPackage(workspace, 'typebox', `
export const Type = {
  Object: (shape) => ({ type: 'object', properties: shape }),
  String: (options = {}) => ({ type: 'string', ...options }),
  Array: (items, options = {}) => ({ type: 'array', items, ...options }),
  Union: (items, options = {}) => ({ anyOf: items, ...options }),
  Literal: (value) => ({ const: value }),
  Optional: (schema) => ({ ...schema, optional: true }),
};
`);

  return { workspace, agentDir, extensionRoot };
}

function writeStubPackage(workspace, packageName, source) {
  const packageRoot = join(workspace, 'node_modules', ...packageName.split('/'));
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name: packageName,
    type: 'module',
    exports: './index.js',
  }, null, 2));
  writeFileSync(join(packageRoot, 'index.js'), `${source.trim()}\n`);
}

function createFakePi() {
  return {
    eventHandlers: new Map(),
    renderers: new Map(),
    tools: [],
    commands: [],
    on(eventName, handler) {
      if (!this.eventHandlers.has(eventName)) {
        this.eventHandlers.set(eventName, []);
      }
      this.eventHandlers.get(eventName).push(handler);
    },
    registerMessageRenderer(name, renderer) {
      this.renderers.set(name, renderer);
    },
    registerTool(definition) {
      this.tools.push(definition);
    },
    registerCommand(definition) {
      this.commands.push(definition);
    },
    sendMessage() {},
    sendUserMessage() {},
    setSessionName() {},
  };
}

function createTheme() {
  return {
    fg(_color, text) {
      return String(text);
    },
    bold(text) {
      return `**${text}**`;
    },
  };
}

test('job-pipeline package import registers renderers that can recover interview thumbnails from the event log', async () => {
  const { agentDir, extensionRoot } = createExtensionHarnessWorkspace();
  process.env.PI_AGENT_DIR = agentDir;

  const extensionModule = await import(`${pathToFileURL(join(extensionRoot, 'index.ts')).href}?t=${Date.now()}`);
  const fakePi = createFakePi();
  extensionModule.default(fakePi);

  assert.equal(fakePi.renderers.has('job-pipeline-interview-user'), true);
  assert.equal(fakePi.renderers.has('job-pipeline-interview'), true);

  const jobState = startTrackedJob(agentDir, {
    id: 'job-2026-05-04-harness0001',
    description: 'demo',
    cwd: '/tmp/harness-project',
    step: 'interview',
    cycleIndex: 1,
    replanCount: 0,
    jesterFlags: [],
    tokenCosts: {},
  }, { now: 1 });

  const persistedTurn = appendInterviewMessageAndPersist(agentDir, jobState, {
    role: 'user',
    content: 'Here is the broken screen.',
    images: [
      { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'broken-screen' } },
    ],
    now: 2,
  });

  unlinkSync(getJobSnapshotPath(agentDir, jobState.id));

  const renderer = fakePi.renderers.get('job-pipeline-interview-user');
  const component = renderer(persistedTurn.messagePayload, { expanded: false }, createTheme());

  assert.equal(component.children[0].text.includes('You'), true);
  assert.equal(component.children[0].text.includes('[1 image attached]'), true);
  assert.equal(component.children[2].mediaType, 'image/png');
  assert.equal(component.children[2].data, 'broken-screen');
});
