import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  resolvePiAgentDir,
  resolveProjectAgentsDir,
} from '../../subagent-bundled-agents/lib/project-agents.mjs';

export const DEFAULT_READ_ONLY_TOOL_NAMES = Object.freeze(['read', 'grep', 'find', 'ls']);
export const DEFAULT_CODING_TOOL_NAMES = Object.freeze(['read', 'bash', 'edit', 'write']);

const BUNDLED_AGENTS_DIR = fileURLToPath(new URL('../../../agents', import.meta.url));
const BUNDLED_UI_DESIGN_SKILL_PATH = fileURLToPath(new URL('../../../skills/ui-design-direction/SKILL.md', import.meta.url));

export function resolveAgentToolNames(toolNames = DEFAULT_READ_ONLY_TOOL_NAMES) {
  return [...toolNames];
}

export function getBundledUiDesignSkillContextFile() {
  return {
    path: BUNDLED_UI_DESIGN_SKILL_PATH,
    content: readFileSync(BUNDLED_UI_DESIGN_SKILL_PATH, 'utf8'),
  };
}

export function resolveNamedAgentDefinition({
  name,
  cwd,
  env = process.env,
  homeDir = homedir(),
  agentDir,
  bundledAgentDirs = [BUNDLED_AGENTS_DIR],
}) {
  const normalizedName = String(name ?? '').trim();
  if (!normalizedName) {
    return null;
  }

  const resolvedAgentDir = agentDir ?? resolvePiAgentDir(env, homeDir);
  const userDir = join(resolvedAgentDir, 'agents');
  const projectDir = resolveProjectAgentsDir(cwd, {
    env,
    homeDir,
    piAgentDir: resolvedAgentDir,
  });

  let resolved = null;

  for (const bundledDir of bundledAgentDirs) {
    const candidate = loadAgentFromDir(bundledDir, 'bundled', normalizedName);
    if (candidate) {
      resolved = candidate;
    }
  }

  for (const source of [
    { dir: userDir, type: 'user' },
    { dir: projectDir, type: 'project' },
  ]) {
    const candidate = loadAgentFromDir(source.dir, source.type, normalizedName);
    if (candidate) {
      resolved = candidate;
    }
  }

  return resolved;
}

/**
 * Spawn a sub-agent session with a specific model, system prompt, and tools.
 *
 * Sub-agents are ephemeral: they run in memory, produce structured output,
 * and are disposed when done. The caller is responsible for parsing the
 * returned text as structured JSON where applicable.
 *
 * @param {{
 *   modelId: string,
 *   systemPrompt: string,
 *   userPrompt: string,
 *   toolNames?: string[],
 *   thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh',
 *   cwd?: string,
 *   signal?: AbortSignal,
 *   onLogLine?: (line: string) => void,
 *   additionalContextFiles?: Array<{ path: string, content: string }>,
 * }} options
 * @returns {Promise<string>}
 */
export async function spawnAgent({
  modelId,
  systemPrompt,
  userPrompt,
  toolNames,
  thinkingLevel,
  cwd,
  signal,
  onLogLine,
  additionalContextFiles = [],
}) {
  // Imported here to avoid loading the SDK at module parse time when running
  // pure logic tests that don't need it.
  const {
    createAgentSession,
    AuthStorage,
    ModelRegistry,
    SessionManager,
    DefaultResourceLoader,
    getAgentDir,
  } = await import('@mariozechner/pi-coding-agent');

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  const [provider, ...rest] = modelId.split('/');
  const id = rest.join('/');
  const model = modelRegistry.find(provider, id);
  if (!model) {
    throw new Error(`Model not found for sub-agent: ${modelId}`);
  }

  const effectiveCwd = cwd ?? process.cwd();
  const agentDir = getAgentDir();

  const { buildSubagentLoaderOptions } = await import('./runtime-helpers.mjs');
  const loader = new DefaultResourceLoader(buildSubagentLoaderOptions({
    cwd: effectiveCwd,
    agentDir,
    systemPrompt,
    additionalContextFiles,
  }));
  await loader.reload();

  const { session } = await createAgentSession({
    model,
    thinkingLevel,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
    cwd: effectiveCwd,
    tools: resolveAgentToolNames(toolNames),
    resourceLoader: loader,
  });

  let lastAssistantText = '';
  const logTracker = createSessionLogTracker(onLogLine);
  session.subscribe((event) => {
    handleSessionLogEvent(logTracker, event);
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const parts = Array.isArray(event.message.content) ? event.message.content : [];
      lastAssistantText = parts
        .filter((content) => content.type === 'text')
        .map((content) => content.text)
        .join('\n')
        .trim();
    }
  });

  await session.prompt(userPrompt, { signal });
  session.dispose();

  return lastAssistantText;
}

/**
 * Spawn a named markdown agent definition, preserving its configured model,
 * tool allowlist, and prompt while adding stage-specific instructions.
 *
 * @param {{
 *   agentName: string,
 *   systemPrompt: string,
 *   userPrompt: string,
 *   thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh',
 *   cwd?: string,
 *   signal?: AbortSignal,
 *   onLogLine?: (line: string) => void,
 *   additionalContextFiles?: Array<{ path: string, content: string }>,
 * }} options
 * @returns {Promise<string>}
 */
export async function spawnNamedAgent({
  agentName,
  systemPrompt,
  userPrompt,
  thinkingLevel,
  cwd,
  signal,
  onLogLine,
  additionalContextFiles = [],
}) {
  const effectiveCwd = cwd ?? process.cwd();
  const agentDefinition = resolveNamedAgentDefinition({
    name: agentName,
    cwd: effectiveCwd,
  });

  if (!agentDefinition) {
    throw new Error(`Named agent not found: ${agentName}`);
  }

  if (!agentDefinition.model) {
    throw new Error(`Named agent ${agentName} is missing a configured model.`);
  }

  return spawnAgent({
    modelId: agentDefinition.model,
    systemPrompt,
    userPrompt,
    toolNames: agentDefinition.tools,
    thinkingLevel,
    cwd: effectiveCwd,
    signal,
    onLogLine,
    additionalContextFiles: [
      { path: agentDefinition.filePath, content: agentDefinition.systemPrompt },
      ...additionalContextFiles,
    ],
  });
}

/**
 * Spawn a coding agent (read + bash + edit + write) in a specific directory.
 * Used for workers operating inside the git worktree.
 *
 * @param {{
 *   modelId: string,
 *   systemPrompt: string,
 *   userPrompt: string,
 *   thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh',
 *   cwd: string,
 *   signal?: AbortSignal,
 *   onLogLine?: (line: string) => void,
 * }} options
 * @returns {Promise<string>}
 */
export async function spawnCodingAgent({ modelId, systemPrompt, userPrompt, thinkingLevel, cwd, signal, onLogLine }) {
  const {
    createAgentSession,
    AuthStorage,
    ModelRegistry,
    SessionManager,
    DefaultResourceLoader,
    getAgentDir,
  } = await import('@mariozechner/pi-coding-agent');

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  const [provider, ...rest] = modelId.split('/');
  const id = rest.join('/');
  const model = modelRegistry.find(provider, id);
  if (!model) {
    throw new Error(`Model not found for coding agent: ${modelId}`);
  }

  const agentDir = getAgentDir();
  const { buildSubagentLoaderOptions } = await import('./runtime-helpers.mjs');
  const loader = new DefaultResourceLoader(buildSubagentLoaderOptions({
    cwd,
    agentDir,
    systemPrompt,
  }));
  await loader.reload();

  const { session } = await createAgentSession({
    model,
    thinkingLevel,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
    cwd,
    tools: resolveAgentToolNames(DEFAULT_CODING_TOOL_NAMES),
    resourceLoader: loader,
  });

  let lastAssistantText = '';
  const logTracker = createSessionLogTracker(onLogLine);

  session.subscribe((event) => {
    handleSessionLogEvent(logTracker, event);
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const parts = Array.isArray(event.message.content) ? event.message.content : [];
      lastAssistantText = parts
        .filter((content) => content.type === 'text')
        .map((content) => content.text)
        .join('\n')
        .trim();
    }
  });

  await session.prompt(userPrompt, { signal });
  session.dispose();

  return lastAssistantText;
}

/**
 * Parse a JSON block from a sub-agent's response.
 * Looks for ```json ... ``` fences first; falls back to direct JSON.parse.
 *
 * @param {string} text
 * @returns {unknown}
 * @throws {Error} if no valid JSON found.
 */
export function extractJson(text) {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : text.trim();
  return JSON.parse(candidate);
}

function loadAgentFromDir(dir, source, agentName) {
  if (!dir || !existsSync(dir)) {
    return null;
  }

  const candidateFiles = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.md'))
    .map((entry) => join(dir, entry.name))
    .sort();

  for (const filePath of candidateFiles) {
    const rawContent = readFileSync(filePath, 'utf8');
    const { frontmatter, body } = parseMarkdownFrontmatter(rawContent);
    if (frontmatter?.name !== agentName) {
      continue;
    }

    const tools = String(frontmatter.tools ?? '')
      .split(',')
      .map((tool) => tool.trim())
      .filter(Boolean);

    return {
      name: frontmatter.name,
      description: frontmatter.description,
      model: frontmatter.model,
      tools: tools.length > 0 ? tools : undefined,
      systemPrompt: body.trim(),
      source,
      filePath,
    };
  }

  return null;
}

function parseMarkdownFrontmatter(content) {
  const source = String(content ?? '');
  if (!source.startsWith('---\n') && !source.startsWith('---\r\n')) {
    return { frontmatter: {}, body: source };
  }

  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: source };
  }

  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    frontmatter[key] = value;
  }

  return { frontmatter, body: match[2] };
}

function createSessionLogTracker(onLogLine) {
  return {
    assistantTextBuffer: '',
    toolOutputByCall: new Map(),
    toolLineBuffers: new Map(),
    onLogLine,
  };
}

function handleSessionLogEvent(tracker, event) {
  switch (event.type) {
    case 'message_update': {
      if (event.assistantMessageEvent.type === 'text_delta') {
        tracker.assistantTextBuffer = consumeBufferedLines({
          buffer: tracker.assistantTextBuffer,
          chunk: event.assistantMessageEvent.delta,
          onLine: (line) => emitLogLine(tracker, line),
        });
      }
      return;
    }
    case 'tool_execution_start': {
      tracker.assistantTextBuffer = consumeBufferedLines({
        buffer: tracker.assistantTextBuffer,
        force: true,
        onLine: (line) => emitLogLine(tracker, line),
      });
      emitLogLine(tracker, `▶ ${formatWorkerToolCall(event.toolName, event.args)}`);
      return;
    }
    case 'tool_execution_update': {
      const currentText = extractTextFromToolPayload(event.partialResult);
      const previousText = tracker.toolOutputByCall.get(event.toolCallId) ?? '';
      const delta = currentText.startsWith(previousText) ? currentText.slice(previousText.length) : currentText;
      tracker.toolOutputByCall.set(event.toolCallId, currentText);
      const currentBuffer = tracker.toolLineBuffers.get(event.toolCallId) ?? '';
      const nextBuffer = consumeBufferedLines({
        buffer: currentBuffer,
        chunk: delta,
        onLine: (line) => emitLogLine(tracker, `  ${line}`),
      });
      tracker.toolLineBuffers.set(event.toolCallId, nextBuffer);
      return;
    }
    case 'tool_execution_end': {
      const currentText = extractTextFromToolPayload(event.result);
      const previousText = tracker.toolOutputByCall.get(event.toolCallId) ?? '';
      const delta = currentText.startsWith(previousText) ? currentText.slice(previousText.length) : currentText;
      tracker.toolOutputByCall.set(event.toolCallId, currentText);
      const currentBuffer = tracker.toolLineBuffers.get(event.toolCallId) ?? '';
      consumeBufferedLines({
        buffer: currentBuffer,
        chunk: delta,
        force: true,
        onLine: (line) => emitLogLine(tracker, `  ${line}`),
      });
      tracker.toolLineBuffers.delete(event.toolCallId);
      emitLogLine(tracker, `${event.isError ? '✗' : '✓'} ${event.toolName}`);
      return;
    }
    case 'message_end': {
      if (event.message.role === 'assistant') {
        tracker.assistantTextBuffer = consumeBufferedLines({
          buffer: tracker.assistantTextBuffer,
          force: true,
          onLine: (line) => emitLogLine(tracker, line),
        });
      }
      return;
    }
    default:
      return;
  }
}

function emitLogLine(tracker, line) {
  if (typeof tracker.onLogLine === 'function') {
    tracker.onLogLine(line);
  }
}

function extractTextFromToolPayload(payload) {
  const parts = Array.isArray(payload?.content) ? payload.content : [];
  return parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function consumeBufferedLines({ buffer = '', chunk = '', force = false, onLine }) {
  let nextBuffer = buffer + String(chunk ?? '').replace(/\r\n/g, '\n');
  let newlineIndex = nextBuffer.indexOf('\n');

  while (newlineIndex !== -1) {
    onLine(nextBuffer.slice(0, newlineIndex));
    nextBuffer = nextBuffer.slice(newlineIndex + 1);
    newlineIndex = nextBuffer.indexOf('\n');
  }

  if (force && nextBuffer.length > 0) {
    onLine(nextBuffer);
    return '';
  }

  return nextBuffer;
}

function formatWorkerToolCall(toolName, args) {
  switch (toolName) {
    case 'bash':
      return truncateLogPreview(`bash ${args?.command ?? ''}`);
    case 'read':
    case 'edit':
    case 'write':
    case 'grep':
    case 'find':
    case 'ls':
      return truncateLogPreview(`${toolName} ${args?.path ?? args?.file_path ?? ''}`.trim());
    default:
      return truncateLogPreview(`${toolName} ${JSON.stringify(args ?? {})}`.trim());
  }
}

function truncateLogPreview(text, maxLength = 140) {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1)}…`;
}
