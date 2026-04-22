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
    createReadOnlyTools,
    createCodingTools,
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

  const loader = new DefaultResourceLoader({
    cwd: effectiveCwd,
    agentsFilesOverride: (current) => ({
      agentsFiles: [
        ...current.agentsFiles,
        { path: '/virtual/ROLE.md', content: systemPrompt },
      ],
    }),
  });
  await loader.reload();

  let tools;
  if (toolNames) {
    // Let the session discover defaults; setActiveTools is called after creation.
    tools = undefined;
  } else {
    tools = createReadOnlyTools(effectiveCwd);
  }

  const { session } = await createAgentSession({
    model,
    thinkingLevel,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
    cwd: effectiveCwd,
    tools,
    resourceLoader: loader,
  });

  if (toolNames) {
    session.agent.state.tools = session.agent.state.tools.filter((t) =>
      toolNames.includes(t.name),
    );
  }

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
 * }} options
 * @returns {Promise<string>}
 */
export async function spawnCodingAgent({ modelId, systemPrompt, userPrompt, thinkingLevel, cwd, signal }) {
  const {
    createAgentSession,
    AuthStorage,
    ModelRegistry,
    SessionManager,
    DefaultResourceLoader,
    createCodingTools,
  } = await import('@mariozechner/pi-coding-agent');

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  const [provider, ...rest] = modelId.split('/');
  const id = rest.join('/');
  const model = modelRegistry.find(provider, id);
  if (!model) {
    throw new Error(`Model not found for coding agent: ${modelId}`);
  }

  const loader = new DefaultResourceLoader({
    cwd,
    agentsFilesOverride: (current) => ({
      agentsFiles: [
        ...current.agentsFiles,
        { path: '/virtual/ROLE.md', content: systemPrompt },
      ],
    }),
  });
  await loader.reload();

  const { session } = await createAgentSession({
    model,
    thinkingLevel,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
    cwd,
    tools: createCodingTools(cwd),
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
