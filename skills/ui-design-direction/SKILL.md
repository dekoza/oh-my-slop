---
name: ui-design-direction
description: >-
  Use when the user wants UI/UX direction, design review,
  or interface critique for dashboards, landing pages, e-commerce pages, b2b
  admin tools, billing flows, SaaS/web/mobile apps, mental health products, or
  real-time logistics control panels; needs recommendations on
  professionalism, trust signals, conversion friction, readability,
  accessibility, hierarchy, data-display, color, typography, iconography,
  layout, CTA, or chart patterns; or wants a hostile design lead review or
  stack-aware guidance for healthcare, fintech, security, admin, Tailwind,
  React, SwiftUI, React Native, Flutter, or shadcn contexts. Not for
  illustration/image prompt generation or pure implementation/debugging work.
---

# UI Design Direction

Use this skill when generic design vibes are not enough and the agent needs concrete UI direction grounded in the bundled local reference data.

The bundle contains:
- 67 styles
- 96 color palettes
- 57 typography pairings
- 99 UX guidelines
- 25 chart patterns
- 13 stack-specific references

## Execution notes

1. Resolve the installed skill directory first.
2. Run the bundled search tool from `<skill-dir>/scripts/search.py`.
3. If the script cannot run in the current environment, say so and continue with manual design reasoning instead of bluffing.
4. Do not install Python, use `sudo`, or modify the user's machine just to run this skill.

## When to prefer this skill

Reach for this skill when the user asks for any of the following:
- a design system or visual direction
- a landing page, dashboard, SaaS UI, app UI, or mobile UI concept
- color palette, typography, icon, chart, or page-pattern recommendations
- a UI review focused on professionalism, usability, accessibility, or trustworthiness
- stack-specific UI guidance for supported frontend stacks

Do not use this skill for pure implementation debugging like broken CSS selectors, JavaScript runtime errors, or framework build failures, or for illustration/image prompt generation like Midjourney prompts, unless the user is also asking for design direction or UX review.

## Core workflow

### 1. Identify the design problem

Extract these facts from the prompt or repository:
- product type
- industry or domain
- user constraints: accessibility, light mode, dense data, trust, conversion, motion limits
- delivery goal: direction, critique, implementation guidance, or page override
- visible stack, if any

If the stack is not explicit and not visible in the repo, do not pretend to know it.

### 2. Start with the design-system command

Use `--design-system` first for almost all design-direction requests.

```bash
python3 <skill-dir>/scripts/search.py "<product type> <industry> <keywords>" --design-system -p "Project Name"
```

This is the default entry point because it combines product, style, color, landing, and typography guidance into one recommendation.

### 3. Add targeted searches only where the initial recommendation leaves gaps

Use domain searches for follow-up depth.

```bash
python3 <skill-dir>/scripts/search.py "<keyword>" --domain <domain> [-n <max_results>]
```

Typical follow-ups:

| Need | Domain | Example |
|---|---|---|
| More style options | `style` | `--domain style "glassmorphism dark"` |
| Accessibility or interaction concerns | `ux` | `--domain ux "focus states reduced motion"` |
| Alternate typography | `typography` | `--domain typography "trustworthy readable healthcare"` |
| Landing-page structure | `landing` | `--domain landing "social proof conversion"` |
| Chart choice | `chart` | `--domain chart "real-time dashboard trend"` |
| Color direction | `color` | `--domain color "fintech trust"` |
| Icon recommendations | `icons` | `--domain icons "payment security"` |

### 4. Use stack guidance only when justified

If the user names a stack or the repo proves one, use stack guidance.

```bash
python3 <skill-dir>/scripts/search.py "<keyword>" --stack <stack>
```

Supported stacks: `html-tailwind`, `react`, `nextjs`, `astro`, `vue`, `nuxtjs`, `nuxt-ui`, `svelte`, `swiftui`, `react-native`, `flutter`, `shadcn`, `jetpack-compose`

If the task is implementation-oriented and no stack evidence exists, `html-tailwind` is the fallback. Say explicitly that it is a fallback.

### 5. Persist only when the user needs reusable design rules

Use `--persist` when the user wants a reusable design system for later pages or iterations.

```bash
python3 <skill-dir>/scripts/search.py "<query>" --design-system --persist -p "Project Name"
python3 <skill-dir>/scripts/search.py "<query>" --design-system --persist -p "Project Name" --page "dashboard"
```

This creates:
- `design-system/<project-slug>/MASTER.md`
- `design-system/<project-slug>/pages/<page>.md`

When working on a page override, check the page file first. If it exists, it overrides the master file.

## Search reference

### Available domains

| Domain | Use for |
|---|---|
| `product` | Product-type recommendations |
| `style` | Style system, effects, visual language |
| `typography` | Font pairings and import hints |
| `color` | Product-specific palettes |
| `landing` | Landing-page structure and CTA placement |
| `chart` | Chart-type selection |
| `ux` | UX best practices and anti-patterns |
| `icons` | Icon recommendations |
| `react` | React and Next performance concerns |
| `web` | General web-interface guidance |

### Supported stacks

| Stack | Focus |
|---|---|
| `html-tailwind` | Tailwind utilities, responsive layout, accessibility |
| `react` | State, rendering, hooks, performance |
| `nextjs` | Routing, SSR, images, app structure |
| `astro` | Islands, content-heavy pages, static-first delivery |
| `vue` | Composition API, state, routing |
| `nuxtjs` | Nuxt app structure and rendering |
| `nuxt-ui` | Nuxt UI component usage |
| `svelte` | Runes, stores, SvelteKit |
| `swiftui` | Native Apple UI patterns |
| `react-native` | Mobile components and lists |
| `flutter` | Widgets, state, layout, theming |
| `shadcn` | Component composition, forms, theming |
| `jetpack-compose` | Android composables and recomposition |

## Response format

When using this skill, structure the answer like this:

1. **Design direction**
   - product type
   - page or product pattern
   - style system
   - typography direction
   - color direction

2. **Why this fits**
   - 2-4 reasons grounded in search output

3. **UX risks and anti-patterns**
   - accessibility
   - contrast
   - motion
   - layout shift
   - trust or conversion problems

4. **Stack notes**
   - only if the stack is known or explicitly marked as fallback

5. **Next implementation step**
   - concrete next action for the user or agent

## High-confidence guidance vs optional taste

Separate hard requirements from taste. Do not present preferences as laws.

### Accessibility and trust requirements

These are high-confidence requirements:
- maintain readable contrast, especially in light mode
- keep focus states visible for keyboard users
- respect `prefers-reduced-motion`
- avoid motion-heavy decorative animation in serious or regulated products
- use color as reinforcement, not the only signal
- prefer real icons and verified brand marks over improvised visuals

### Strong heuristics

These are usually right, but still depend on context:
- avoid hover effects that shift layout
- keep icon sizing consistent within one set
- use clear affordances for clickable cards or panels
- avoid weak borders and low-opacity surfaces in light mode
- keep container widths and spacing rhythm consistent

### Stack-specific implementation hints

Treat these as implementation hints, not universal UI law:
- Tailwind examples like `cursor-pointer`, `transition-colors`, or `max-w-7xl` apply only when the project is using Tailwind or a similar utility approach
- component-library guidance should match the actual stack

## Example commands

```bash
python3 <skill-dir>/scripts/search.py "healthcare service accessible light mode professional" --design-system -p "Clinic"
python3 <skill-dir>/scripts/search.py "focus states reduced motion" --domain ux
python3 <skill-dir>/scripts/search.py "pricing cards conversion" --domain landing
python3 <skill-dir>/scripts/search.py "dense analytics layout" --stack react
```

## Common mistakes

- jumping straight to visual taste without first identifying product type and constraints
- guessing a stack instead of verifying it from the prompt or repository
- giving a generic mood-board answer without anti-patterns or implementation consequences
- treating trend-heavy styles as automatically suitable for healthcare, finance, or admin workflows
- recommending persistence without telling the user which files will be created
- bluffing about stack support instead of checking the bundled references

## Pre-delivery checklist

Before finishing a UI recommendation or review, verify:
- [ ] the answer starts from the design-system workflow or explains why not
- [ ] the recommendation includes concrete color and typography direction
- [ ] accessibility concerns are explicit, not implied
- [ ] anti-patterns are called out plainly
- [ ] stack guidance is verified or clearly labeled as fallback
- [ ] persisted output paths, if mentioned, are exact
