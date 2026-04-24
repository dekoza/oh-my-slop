export const DEFAULT_READ_ONLY_TOOL_NAMES = Object.freeze(['read', 'grep', 'find', 'ls']);
export const DEFAULT_CODING_TOOL_NAMES = Object.freeze(['read', 'bash', 'edit', 'write']);

export function resolveAgentToolNames(toolNames = DEFAULT_READ_ONLY_TOOL_NAMES) {
  return [...toolNames];
}

/**
 * Spawn a sub-agent session with a specific model, system prompt, and tools.
 *
 * Sub-agents are ephemeral: they run in memory, produce structured output,
 * and are disposed when done. The caller is responsible for parsing the
 * returned text as structured JSON where applicable.
 *
 * @param {{
 *   modelId: string,            "provider/id" string
 *   systemPrompt: string,       Role-specific instructions
 *   userPrompt: string,         Task description / input
 *   toolNames?: string[],       Subset of pi tools to enable (default: read-only)
 *   thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh',
 *   cwd?: string,               Working directory (default: process.cwd())
 *   signal?: AbortSignal,
 * }} options
 * @returns {Promise<string>}    Final assistant message text
 */
export async function spawnAgent({ modelId, systemPrompt, userPrompt, toolNames, thinkingLevel, cwd, signal }) {
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
  session.subscribe((event) => {
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const parts = Array.isArray(event.message.content) ? event.message.content : [];
      lastAssistantText = parts
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n')
        .trim();
    }
  });

  await session.prompt(userPrompt, { signal });
  session.dispose();

  return lastAssistantText;
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
  let assistantTextBuffer = '';
  const toolOutputByCall = new Map();
  const toolLineBuffers = new Map();
  const emitLogLine = (line) => {
    if (typeof onLogLine === 'function') {
      onLogLine(line);
    }
  };

  session.subscribe((event) => {
    switch (event.type) {
      case 'message_update': {
        if (event.assistantMessageEvent.type === 'text_delta') {
          assistantTextBuffer = consumeBufferedLines({
            buffer: assistantTextBuffer,
            chunk: event.assistantMessageEvent.delta,
            onLine: emitLogLine,
          });
        }
        return;
      }
      case 'tool_execution_start': {
        assistantTextBuffer = consumeBufferedLines({
          buffer: assistantTextBuffer,
          force: true,
          onLine: emitLogLine,
        });
        emitLogLine(`▶ ${formatWorkerToolCall(event.toolName, event.args)}`);
        return;
      }
      case 'tool_execution_update': {
        const currentText = extractTextFromToolPayload(event.partialResult);
        const previousText = toolOutputByCall.get(event.toolCallId) ?? '';
        const delta = currentText.startsWith(previousText) ? currentText.slice(previousText.length) : currentText;
        toolOutputByCall.set(event.toolCallId, currentText);
        const currentBuffer = toolLineBuffers.get(event.toolCallId) ?? '';
        const nextBuffer = consumeBufferedLines({
          buffer: currentBuffer,
          chunk: delta,
          onLine: (line) => emitLogLine(`  ${line}`),
        });
        toolLineBuffers.set(event.toolCallId, nextBuffer);
        return;
      }
      case 'tool_execution_end': {
        const currentText = extractTextFromToolPayload(event.result);
        const previousText = toolOutputByCall.get(event.toolCallId) ?? '';
        const delta = currentText.startsWith(previousText) ? currentText.slice(previousText.length) : currentText;
        toolOutputByCall.set(event.toolCallId, currentText);
        const currentBuffer = toolLineBuffers.get(event.toolCallId) ?? '';
        consumeBufferedLines({
          buffer: currentBuffer,
          chunk: delta,
          force: true,
          onLine: (line) => emitLogLine(`  ${line}`),
        });
        toolLineBuffers.delete(event.toolCallId);
        emitLogLine(`${event.isError ? '✗' : '✓'} ${event.toolName}`);
        return;
      }
      case 'message_end': {
        if (event.message.role === 'assistant') {
          assistantTextBuffer = consumeBufferedLines({
            buffer: assistantTextBuffer,
            force: true,
            onLine: emitLogLine,
          });
          const parts = Array.isArray(event.message.content) ? event.message.content : [];
          lastAssistantText = parts
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n')
            .trim();
        }
        return;
      }
      default:
        return;
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
