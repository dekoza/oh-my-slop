# Provider failover extension for pi

This extension adds a synthetic `failover/...` provider that retries the same prompt on backup providers when the current backend fails with a rate-limit style error (`429`, `529`, `rate limit`, `overloaded`, `quota exceeded`).

The point is simple: you select one failover model once, and pi keeps working even when your primary provider starts rejecting heavy traffic.

## What it does

- routes one prompt across a configured provider chain
- falls through to the next provider only when the current provider fails before producing output
- keeps the successful backup provider sticky by default, so the next prompt does not keep hammering the same throttled primary
- exposes `/failover-reset` to clear the sticky route and try the primary first again
- generates `config.json` automatically if it does not exist yet

It does **not** splice two model outputs together. If a provider already started streaming text and then errors, the extension stops there and preserves the real failure instead of mixing partial output from one model with fresh output from another.

## Install

Copy this directory to one of pi's auto-discovered extension locations:

- `~/.pi/agent/extensions/provider-failover/`
- `.pi/extensions/provider-failover/`

Then reload pi with `/reload`.

## Configure

The extension expects exactly one config file:

- `config.json` in the same directory as `index.ts`

Typical paths:

- project-local install: `.pi/extensions/provider-failover/config.json`
- global install: `~/.pi/agent/extensions/provider-failover/config.json`

If `config.json` does not exist, the extension generates it automatically on startup by:

1. listing models currently available in your pi setup
2. inferring the active provider plan from that set
3. taking every `github-copilot` model
4. matching each Copilot model by normalized name against providers in this plan:
   - active routing providers first: `openrouter`, `zai`
   - then original providers: `openai-codex`, `anthropic`, `google`, `xai`
5. writing the result to `config.json`

Only matched models are included. Unmatched Copilot models are skipped.

This means if you are currently using routing providers like OpenRouter or ZAI, the generated config prefers them over the direct original providers.

### Important

Do **not** guess provider or model IDs when you edit the generated file.

Use pi itself to inspect the exact IDs available in your setup:

- `/model`
- `pi --list-models`

All listed providers must already be authenticated through `/login` or API keys, otherwise they will not appear in the generated config.

## Example flow

1. Install the extension in `.pi/extensions/provider-failover/`.
2. Reload pi.
3. Let the extension generate `.pi/extensions/provider-failover/config.json`.
4. Open `/model` and select one of the generated `failover/...` models.
5. Work normally.
6. If the Copilot route responds with a 429-style failure before streaming output, the extension retries the same prompt on the matched original provider.
7. When a backup succeeds, that backup becomes the first route for future prompts until you run `/failover-reset`.
8. If you later log into new providers or enable new models, run `/failover-show-plan` first to inspect the current routing plan, then `/failover-regenerate-config`.

## Config format

Generated configs look like this:

```json
{
  "models": [
    {
      "id": "copilot-claude-sonnet-4-5",
      "name": "Claude Sonnet 4.5",
      "strategy": [
        { "provider": "github-copilot", "model": "copilot-claude-sonnet-4-5" },
        { "provider": "anthropic", "model": "claude-sonnet-4-5-20250929" }
      ],
      "sticky": true
    }
  ]
}
```

### Fields

- `id`: wrapper model id shown under the synthetic `failover` provider
- `name`: label shown in pi's model selector
- `strategy`: ordered provider/model chain; first item is always the GitHub Copilot route
- `sticky`: when `true` (default), the most recent successful route stays first until reset

## Commands

- `/failover-reset` - clear sticky routes for all failover models
- `/failover-reset <model-id>` - clear the sticky route for one failover model
- `/failover-show-plan` - show the current provider preference order, matched Copilot models, and unmatched Copilot models before changing config
- `/failover-regenerate-config` - rebuild `config.json` from the models currently available in your pi setup and reload the failover provider

## Notes

- wrapper model capabilities are conservative: the extension uses the minimum context window/output limit and the shared input types across the configured backends
- default config generation prefers active routing providers (`openrouter`, `zai`) before the original providers (`openai-codex`, `anthropic`, `google`, `xai`)
- failover only happens before output starts; once a provider has begun streaming, the extension will not hop to another provider mid-answer
- non-rate-limit failures are passed through unchanged
