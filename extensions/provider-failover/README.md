# Provider failover extension for pi

This extension adds a synthetic `failover/...` provider that retries the same prompt on backup providers when the current backend fails with a rate-limit style error (`429`, `529`, `rate limit`, `overloaded`, `quota exceeded`).

The point is simple: you select one failover model once, and pi keeps working even when your primary provider starts rejecting heavy traffic.

## What it does

- routes one prompt across a configured provider chain
- falls through to the next provider only when the current one fails before producing output
- keeps the successful backup provider sticky by default, so the next prompt does not keep hammering the same throttled primary
- exposes `/failover-reset` to clear the sticky route and try the primary first again

It does **not** splice two model outputs together. If a provider already started streaming text and then errors, the extension stops there and preserves the real failure instead of mixing partial output from one model with fresh output from another.

## Install

Copy this directory to one of pi's auto-discovered extension locations:

- `~/.pi/agent/extensions/provider-failover/`
- `.pi/extensions/provider-failover/`

Then reload pi with `/reload`.

## Configure

Create one of these files:

- project-local: `.pi/provider-failover.json`
- global: `~/.pi/agent/provider-failover.json`

Project-local wins over global.

Start from [`provider-failover.example.json`](./provider-failover.example.json).

### Important

Do **not** guess provider/model IDs.

Use pi itself to inspect the exact IDs available in your setup:

- `/model`
- `pi --list-models`

Then copy those exact `provider` and `model` values into the config.

All listed providers must already be authenticated through `/login` or API keys.

## Example flow

1. Configure a failover model whose strategy is:
   1. GitHub Copilot model
   2. OpenAI backup
   3. Anthropic backup
2. Reload pi.
3. Open `/model` and select `failover/copilot-coder`.
4. Work normally.
5. If Copilot responds with a 429-style failure before streaming output, the extension retries the same prompt on OpenAI, then Anthropic.
6. When a backup succeeds, that backup becomes the first route for future prompts until you run `/failover-reset`.

## Config format

```json
{
  "models": [
    {
      "id": "copilot-coder",
      "name": "Copilot coder with automatic failover",
      "strategy": [
        { "provider": "github-copilot", "model": "...exact model id..." },
        { "provider": "openai", "model": "...exact model id..." },
        { "provider": "anthropic", "model": "...exact model id..." }
      ],
      "sticky": true
    }
  ]
}
```

### Fields

- `id`: wrapper model id shown under the synthetic `failover` provider
- `name`: label shown in pi's model selector
- `strategy`: ordered provider/model chain; first item is the primary route
- `sticky`: when `true` (default), the most recent successful route stays first until reset

## Command

- `/failover-reset` - clear sticky routes for all failover models
- `/failover-reset <model-id>` - clear the sticky route for one failover model

## Notes

- wrapper model capabilities are conservative: the extension uses the minimum context window/output limit and the shared input types across the configured backends
- failover only happens before output starts; once a provider has begun streaming, the extension will not hop to another provider mid-answer
- non-rate-limit failures are passed through unchanged
