# Gitea skill reliability and tracker scaffold migration

## Evidence

A local session survey paired 185 distinct comment-related tool calls with
`Error: no comment content provided`: 8 in pi and 177 in Claude Code. These are
observed errors, not comparative harness failure rates. Two Claude sessions loaded
the Gitea skill body immediately before using the add shorthand to read comments;
the applicable issues reference was not explicitly read first. A pi session
corrected its issue syntax after loading the skill, then repeated invented syntax
after compaction. The private transcript paths and raw survey artifacts are not
part of this package.

The recurring mistakes include `tea comments <index>` for reading, invented
`tea issues view` / `tea issues comment` / `tea api get` verbs, CLI `--body`, API
`-o json`, and stdin redirection without an explicit request body flag. The update
keeps the existing `gitea` name and separates reference retrieval from registration.

## Consumer migration

The Gitea scaffold and this repository's tracker document now scope repository
commands with `--repo owner/name`. `--remote` is a login-discovery option, not a
substitute for repo scope. The dependency recipe supplies `index`, `owner` and
`repo`, checks HTTP success and reads back the edge. Comment creation and issue
closure are separately verified outcomes. PR creation pushes to the configured
Gitea remote, not an assumed GitHub `origin`.

Existing consumer repositories must **re-sync with `/setup-project-skills`** to
replace old command scaffolding. Preserve their tracker bindings, login choices,
labels, authority rules and local edits; show the proposed diff before writing.
The protected tracker headings and `## Agent skills` pointer contract do not change.
No other repository is edited automatically by this update.

## Validation scope

Functional/retrieval comparisons, static regression checks and API observations
are recorded separately. Model outputs require human review; a passing Markdown
validator is not evidence of correct agent behavior. The versioned operational
observations and eval instructions live with the Gitea skill.
