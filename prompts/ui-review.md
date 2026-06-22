---
description: Critique UI/UX with data-driven recommendations
argument-hint: "<product type> <keywords>"
---
Critique the UI/UX with concrete, data-driven recommendations. Run the bundled search tool from the skill directory.

## Workflow

### 1. Identify the design problem

Extract from the prompt or repository:
- Product type
- Industry or domain
- User constraints: accessibility, light mode, dense data, trust, conversion, motion limits
- Delivery goal: direction, critique, implementation guidance, or page override
- Visible stack, if any

### 2. Start with design-system search

```bash
python3 /home/minder/.pi/agent/git/github.com/dekoza/oh-my-slop/skills/ui-design-direction/scripts/search.py "$@" --design-system -p "Project"
```

### 3. Add targeted searches for gaps

```bash
python3 /home/minder/.pi/agent/git/github.com/dekoza/oh-my-slop/skills/ui-design-direction/scripts/search.py "<keyword>" --domain <domain>
```

| Need | Domain |
|------|--------|
| Style options | `style` |
| Accessibility / interaction | `ux` |
| Typography | `typography` |
| Landing-page structure | `landing` |
| Chart choice | `chart` |
| Color direction | `color` |
| Icons | `icons` |

### 4. Stack guidance (if known)

```bash
python3 /home/minder/.pi/agent/git/github.com/dekoza/oh-my-slop/skills/ui-design-direction/scripts/search.py "<keyword>" --stack <stack>
```

Supported: `html-tailwind`, `react`, `nextjs`, `astro`, `vue`, `nuxtjs`, `nuxt-ui`, `svelte`, `swiftui`, `react-native`, `flutter`, `shadcn`, `jetpack-compose`

## Response format

1. **Design direction** — product type, page pattern, style system, typography, color
2. **Why this fits** — 2-4 reasons grounded in search output
3. **UX risks and anti-patterns** — accessibility, contrast, motion, layout shift, trust/conversion problems
4. **Stack notes** — only if stack is known
5. **Next implementation step** — concrete next action

## High-confidence requirements

- Maintain readable contrast, especially in light mode
- Keep focus states visible for keyboard users
- Respect `prefers-reduced-motion`
- Avoid motion-heavy decorative animation in serious/regulated products
- Use color as reinforcement, not the only signal
- Prefer real icons and verified brand marks over improvised visuals
