# adaptive-routing

A clone of the upstream `adaptive-routing` extension from `oh-pi`, forked here to experiment with improved routing heuristics.

## Files

| File | Purpose |
|------|---------|
| `types.ts` | All shared types and interfaces |
| `defaults.ts` | Default config, intent policies, fallback groups |
| `normalize.ts` | Model → `NormalizedRouteCandidate` conversion + tag/tier derivation |
| `config.ts` | Config file reading, path resolution, normalization |
| `state.ts` | Persistent routing state (mode, lock, last decision) |
| `telemetry.ts` | Local telemetry: decision log, stats, feedback events |
| `engine.ts` | Core routing decision engine: candidate scoring → `RouteDecision` |
| `classifier.ts` | Prompt classification (heuristic + optional LLM fallback) |
| `init.ts` | Config generation from available models (`/route init`) |
| `index.ts` | Extension entry point — registers events and the `/route` command |
| `fixtures.route-corpus.json` | Prompt routing test corpus |

## Usage

Add to your pi config:

```json
{
  "extensions": ["path/to/adaptive-routing/index.ts"]
}
```

Or from this repo root:
```json
{
  "extensions": ["./extensions/adaptive-routing/index.ts"]
}
```

## Commands

- `/route status` — show current routing state
- `/route on` / `/route off` / `/route shadow` — change mode
- `/route explain` — show last routing decision details
- `/route lock` / `/route unlock` — pin to current model
- `/route feedback <good|bad|wrong-intent|overkill|underpowered|wrong-provider|wrong-thinking>` — record feedback
- `/route stats` — show telemetry stats
- `/route init` — generate a config from available models
- `/route refresh` — reload config and usage snapshot
