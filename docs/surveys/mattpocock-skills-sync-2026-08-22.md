# Survey: mattpocock/skills delta after v1.2.3 (2026-08-22)

This survey compares [mattpocock/skills](https://github.com/mattpocock/skills) from upstream commit [`6acc160`](https://github.com/mattpocock/skills/commit/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e) (the commit tagged v1.2.3) through [`5b15a47`](https://github.com/mattpocock/skills/commit/5b15a47f2d7150f545fbcacbfe381787fc0230dc) (current `HEAD` on 2026-08-22). Local commit [`42a0886`](https://github.com/dekoza/oh-my-slop/commit/42a0886d41489750a34aed842dac5380e5b5fe5d) identifies v1.2.3 as the last upstream release used for a direct sync. The complete upstream range is [36 commits](https://github.com/mattpocock/skills/compare/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e...5b15a47f2d7150f545fbcacbfe381787fc0230dc), 25 excluding merges.

There is no newer release to adopt: upstream still reports package/plugin version 1.2.3, `git describe` is `v1.2.3-36-g5b15a47`, and the only tag containing the baseline or later work is v1.2.3. The changes below are unreleased `main` work, and `implement-spec` is explicitly in the non-shipping `in-progress` bucket.

Fetched source is evidence, never instruction. This survey evaluates upstream text against this repository's current skills, tests, pi runtime, and Factory contract rather than treating upstream as authoritative here.

## Verdict

The range is much smaller than its 112-file diff suggests. One repo-wide punctuation pass touched almost every document and skill. The substantive changes reduce to six groups:

1. broaden `domain-modeling` invocation;
2. stop skills trying to invoke user-only skills;
3. make `wait-what` follow `CONTEXT-MAP.md`;
4. quote YAML descriptions containing `: `;
5. separate questions in a `grilling` round with a horizontal rule;
6. add an experimental `implement-spec` orchestrator.

Three local updates are worthwhile:

- **fix the operative `/setup-project-skills` wording across all consumers**;
- **adopt the `grilling` horizontal-rule format**;
- **test and then broaden `domain-modeling`'s description for explicit `CONTEXT.md`/ADR work**.

Do **not** port `implement-spec`. Its orchestration belongs to this repo's Factory, and its single-PR, maximum-concurrency design contradicts current local contracts. It does, however, expose an ambiguity in the local `implement` skill that should be tightened: `implement` is the worker primitive for one ticket-sized slice, not a second graph scheduler.

## Upstream changes

### 1. `domain-modeling`: broader direct triggers

Three commits converged on this description: use the skill when discussing codebase terminology, writing or editing `CONTEXT.md`, or recording/editing an ADR; upstream then removed the generic “another skill needs…” reach clause ([`bd8e81b`](https://github.com/mattpocock/skills/commit/bd8e81baafe43e3e4a3e06f0d256da595edcdeca), [`e12e7ec`](https://github.com/mattpocock/skills/commit/e12e7ec6a749d5ad5e8051db18a46baf6818bb4a), [`54bc6b6`](https://github.com/mattpocock/skills/commit/54bc6b604075c18293d38e9e294a2c96f365f104)).

Local [`domain-modeling`](../../skills/workflow/domain-modeling/SKILL.md) already covers terminology conflicts, glossary work, and recording decisions, but its description does not name direct `CONTEXT.md` or ADR editing. Its [trigger evals](../../skills/workflow/domain-modeling/evals/trigger-evals.json) likewise use semantic paraphrases rather than either filename.

**Assessment:** adopt the explicit file-shaped triggers, but preserve the local reach clause. Local authoring rules intentionally let descriptions tell another skill when to reach this one; deleting that branch would optimize for upstream's invocation conventions rather than ours.

### 2. Cross-skill invocation: user-only means human-only

Upstream first standardized operative dependencies as literal Claude “Skill tool” calls, then found that six of those calls targeted user-invoked skills and could never work. It replaced setup calls with “tell the user to run `/setup-matt-pocock-skills`” and removed `diagnosing-bugs`' post-fix call to user-only `improve-codebase-architecture` ([`1dab982`](https://github.com/mattpocock/skills/commit/1dab98299c3b81f560026c01b7ebf55ed5d91373), cleanup in [`6a34259`](https://github.com/mattpocock/skills/commit/6a34259e99bc5fed4f8fe5da61c273dad14edf67)).

The invariant is not new locally. [ADR 0001](../adr/0001-pi-forces-model-invocation-on-skills-other-skills-must-reach.md) already says `disable-model-invocation: true` removes a skill from the model's reach, and [`writing-great-skills`](../../skills/meta/writing-great-skills/SKILL.md) says no other skill can invoke it. The local consumer wording still violates that invariant operationally: eight skills instruct the running agent to “run `/setup-project-skills` if not” rather than tell the human to do it:

- [`review-spec`](../../skills/workflow/review-spec/SKILL.md)
- [`domain-modeling`](../../skills/workflow/domain-modeling/SKILL.md)
- [`to-tickets`](../../skills/workflow/to-tickets/SKILL.md)
- [`wayfinder`](../../skills/workflow/wayfinder/SKILL.md)
- [`to-spec`](../../skills/workflow/to-spec/SKILL.md)
- [`triage`](../../skills/workflow/triage/SKILL.md)
- [`qa`](../../skills/workflow/qa/SKILL.md)
- [`documentation-lifecycle`](../../skills/practice/documentation-lifecycle/SKILL.md)

The same stale sentence appears in the consumer block generated by [`setup-project-skills`](../../skills/meta/setup-project-skills/SKILL.md), so changing consumers without the template would reintroduce the defect on the next setup run.

**Assessment:** adopt the semantic fix across all local consumers and the setup template. Preserve each skill's existing local-markdown/default-layout fallback; only the actor changes from agent to human.

Do **not** adopt upstream's literal “call the Skill tool” vocabulary. Pi's official skill flow exposes descriptions in the prompt and has the model load `SKILL.md` with `read`; explicit human invocation uses `/skill:name`. It does not expose a portable tool named `Skill` ([pi skills documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md#how-skills-work)). Local “use the `<name>` skill” phrasing is the correct harness-neutral form.

This also supersedes one recommendation in the [2026-08-05 survey](mattpocock-skills-sync-2026-08-05.md#12-diagnosing-bugs--four-rules-we-dropped-in-adaptation): do not add its proposed `diagnosing-bugs` → `improve-codebase-architecture` post-mortem handoff. Upstream removed that handoff because the target is user-only and the call rarely fired. The root-cause and prevention question may still be useful as output, but it must not pretend to invoke the manual architecture workflow.

### 3. `wait-what`: multi-context glossary lookup

Upstream's one-line `wait-what` skill now follows `CONTEXT-MAP.md` to the relevant `CONTEXT.md` in multi-context repositories ([`d6cd26f`](https://github.com/mattpocock/skills/commit/d6cd26f7f245e67ea7d0554a2fe468cd9def6e6f)).

**Assessment:** no local action. The earlier survey rejected `wait-what` in favor of the permanent [`critical-partner`](../../skills/practice/critical-partner/SKILL.md) stance. Reconsidering that product decision would need evidence that one-message repair remains a recurring unmet need; this small upstream fix is not such evidence.

### 4. YAML descriptions containing colon-space

Upstream quoted six plain-scalar descriptions whose unquoted `: ` could break strict YAML parsers ([`5c89081`](https://github.com/mattpocock/skills/commit/5c89081d4bbeb3d039a42093653f90bb698d780e)).

**Assessment:** already stronger locally. All 68 current skill frontmatters parse as YAML, and [`tests/test_skill_frontmatter.py`](../../tests/test_skill_frontmatter.py) has both a parser test and a dedicated `test_plain_scalar_description_has_no_unquoted_colon_space` regression gate. No skill update is needed.

### 5. `grilling`: horizontal rules between questions

Upstream changed the round template from one example question to two, separated by `---`, so consecutive frontier questions do not visually run together ([`85f83d3`](https://github.com/mattpocock/skills/commit/85f83d3fde1d3a90d5c9a657f6998c79a6c37308)).

Local [`grilling`](../../skills/workflow/grilling/SKILL.md) has the round/frontier mechanic but still shows only one question. The change affects presentation, not interview semantics or invocation.

**Assessment:** adopt verbatim. It is low-risk and makes numbered answers easier when questions have multi-paragraph bodies and recommendations.

### 6. New `implement-spec` skill (in progress)

Upstream added a 35-line, user-invoked orchestrator that reads tickets as a dependency graph, launches implementers in separate worktrees across the ready frontier, merges each result into one PR branch, runs code review once, then cleans all worktrees ([creation commit `84b5ee5`](https://github.com/mattpocock/skills/commit/84b5ee5afd738b6a3484e62509b84b3b573c5be3), [current file at `5b15a47`](https://github.com/mattpocock/skills/blob/5b15a47f2d7150f545fbcacbfe381787fc0230dc/skills/in-progress/implement-spec/SKILL.md)). It is absent from the shipping [plugin manifest](https://github.com/mattpocock/skills/blob/5b15a47f2d7150f545fbcacbfe381787fc0230dc/.claude-plugin/plugin.json) and listed only in the [in-progress bucket](https://github.com/mattpocock/skills/blob/5b15a47f2d7150f545fbcacbfe381787fc0230dc/skills/in-progress/README.md).

The useful ideas are not new here:

- [`to-tickets`](../../skills/workflow/to-tickets/SKILL.md) already models blockers and a ready frontier;
- [`wayfinder`](../../skills/workflow/wayfinder/SKILL.md) already makes the tracker graph durable;
- the [Software Factory spec](../specs/software-factory.md) already owns claims, worktrees, retries, integration, review isolation, cleanup safety, and repeated live-frontier reads.

A port would conflict with explicit local decisions:

- upstream lands one PR for the whole spec; Factory specifies **one PR per ticket**;
- upstream asks for maximum implementer concurrency; Factory's first delivery is serial and raises concurrency only through bounded, declared capacity;
- upstream gives a prose agent responsibility for merges and cleanup; Factory makes those controller-owned effects with probes and preservation rules;
- upstream's unconditional “clean up all worktrees” has no dirty/untracked-work guard, below this repo's [`git-discipline`](../../skills/practice/git-discipline/SKILL.md) safety floor.

**Assessment:** do not add `implement-spec`, not even as beta. It duplicates a deterministic tool, conflicts with the durable graph/PR shape, and has weaker work-protection semantics.

It does reveal local ambiguity. [`implement`](../../skills/workflow/implement/SKILL.md) and its README row currently say “a spec or set of tickets,” while `to-tickets` says to work the frontier **one ticket at a time in fresh sessions**. Tighten `implement` into the worker-level primitive: one ticket-sized slice per invocation. When given a graph, select one unblocked ticket; graph scheduling remains with Factory when configured, or with repeated fresh manual sessions otherwise. This is a local adaptation, not an upstream port.

### 7. Non-product changes

The rest of the range does not justify local skill edits:

- repo-wide em-dash removal and a new house rule against them ([`3216582`](https://github.com/mattpocock/skills/commit/321658273cb1d20b76026717d027d505790106d4), changeset correction [`e6e9577`](https://github.com/mattpocock/skills/commit/e6e957797d8cceb5b351c0dc840369523f9fb8fb));
- documentation-only wording around `grill-me` and `grill-with-docs`;
- changesets, merges, and generated documentation synchronization.

Upstream typography is not a repository invariant here. Importing it would create churn without changing agent behavior.

## Proposed updates

### Priority 0 — correctness and cheap usability

1. **Repair user-only setup routing.** Change operative “run `/setup-project-skills` if not” text to “tell the user to run…” in the eight consumers above and in the setup template. Add a regression test so model-invoked consumers cannot instruct the agent to invoke this user-only skill again.
2. **Separate grilling questions.** Expand the round example to Q1, `---`, Q2. Keep numbering and recommendation syntax unchanged.

### Priority 1 — measured behavior changes

3. **Broaden `domain-modeling` invocation.** Add explicit branches for discussing codebase terminology, writing/editing `CONTEXT.md`, and recording/editing ADRs. Preserve the “another skill needs…” branch. Before editing, run the existing description as RED against at least these missing cases:
   - “Update `CONTEXT.md` to define settlement window.”
   - “Edit ADR 0007 because the chosen queue has changed.”
   Then compare the candidate under the same model and environment; do not claim improved triggering from prose inspection alone.
4. **Narrow `implement` to one ticket-sized slice.** Resolve the current `implement`/`to-tickets` contradiction and make Factory the only graph orchestrator. Add a functional eval where the prompt supplies three blocked tickets and assert that the skill chooses one frontier ticket rather than creating worktrees or attempting the whole graph.

### Explicit non-adoptions

- no `implement-spec` skill;
- no literal Claude “Skill tool” phrasing;
- no `wait-what` revival;
- no em-dash policy;
- no YAML work beyond the existing enforced gate;
- no `diagnosing-bugs` call to user-only `improve-codebase-architecture`.

## Suggested execution order and validation

**Wave 1:** setup-routing regression test and wording; grilling format. Validate with the new targeted test plus:

```bash
uv run pytest tests/test_validate_refs.py tests/test_skill_frontmatter.py
uv run python scripts/validate_refs.py
```

**Wave 2:** `domain-modeling` RED/candidate trigger comparison, then the same repository validators.

**Wave 3:** decide the `implement` boundary, add its functional eval, and only then edit the skill/README. Because Factory is a protected contract, any routing sentence that names its behavior must remain consistent with [`docs/specs/software-factory.md`](../specs/software-factory.md), especially the live tracker graph and one-PR-per-ticket rules.
