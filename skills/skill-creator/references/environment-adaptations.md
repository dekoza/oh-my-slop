# Environment adaptations

Use these adaptations when the main workflow's preferred tools are unavailable. Preserve the
same evidence standard; reduce claims rather than inventing missing proof.

## Subagents

**Subagents available:** run independent baseline/candidate configurations concurrently once
both are defined. Use separate output directories and capture each completion's timing metadata
immediately.

**No subagents:** run configurations sequentially with identical prompts and fixtures. The same
agent authored and evaluated the skill, so label the comparison as a sanity check rather than an
independent benchmark. Compensate with direct user review of outputs.

## Display and browser

**Display available:** generate `review.html` with `--static`, open it with the platform's
browser command, and import the downloaded `feedback.json` into the workspace.

**Headless:** generate the same static file and give the user its exact path.

**Browser command fails:** keep the generated artifact and print its path. Failure to auto-open
is not failure to generate.

## Writable paths

Installed skills may be read-only. Preserve the original name, copy the complete skill to a
writable temporary directory, edit and package the copy, then return the packaged artifact or
request the repository's normal installation path. Never overwrite an untracked destination.

Keep evaluation workspaces beside the skill directory or under a temporary workspace, not
inside the installable skill.

## Missing CLIs or tools

**No `opencode`:** perform the description preflight, save trigger evals, and report measured
optimization as deferred.

**No `present_files`:** skip packaging presentation and report the validated path. From the
`skill-creator` directory, packaging can still run with
`python -m scripts.package_skill <path>` when the script and dependencies exist.

**No package installer or network:** use installed dependencies only. Report the missing
requirement instead of silently substituting an unverified tool.

## Failed processes

Capture full command output with `tee`. Preserve completed run artifacts and retry only failed
stages after identifying a cause. If one side of a comparison cannot run, mark the comparison
incomplete and avoid improvement claims.
