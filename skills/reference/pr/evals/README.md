# PR presentation evals

[Functional/retrieval definitions](evals.json) cover the three real presentation
owners: implement's standalone body/branch-only handoff, implement-spec's combined
delivery, and fix-pr's existing repair comment. Use operator-supplied disposable
filesystem/Git fixtures, their exact templates and metadata, configured custom
language, committed candidates and actual read-only check outputs. Preserve
unrelated/untracked work; only authorized local draft artifacts may be written.
Forge, approval and CI facts supplied by fixtures are simulations, not live evidence.

Compare one trial for each of three cases with the no-pr baseline first and candidate
second (six initial CLI executions maximum). Preserve complete pre-edit owner/support
bodies and evals. Keep prompt, inputs, tools, model/thinking, fixture and deadlines
matched; baseline omits pr, candidate includes it. Read actual handoff bodies rather
than count requires metadata as consultation. Grade draft contents and tool/filesystem
and Git effects separately from static source assertions. Strong baselines may tie;
no lift, reliability or efficiency claim follows from this small sanity comparison.

[Trigger queries](trigger-evals.json) use the existing query/should_trigger format:
ten natural positives and ten adjacent near-misses, three serial trials each, sixty
initial executions maximum, candidate-only and threshold 0.5. Advertise the natural
candidate description through the installed pi CLI; do not force its name or append
its body. Use the declared isolated JSON-stream executor and existing provider/model,
not the skill-creator OpenCode detector. A genuine consultation correlates an actual
read start/end by toolCallId and canonical path, successful returned instruction body,
and inspected offset/limit. Frontmatter-only, failed or claimed reads are not positives.
A valid trial requires exit0, agent_settled and terminal assistant message_end stop.
Backend errors, aborts, missing events, failed reads and timeouts are incomplete,
not negative triggers. Split raw JSONL on LF. Process300/outer600; no automatic retries
or extra optimization batch. Changed/unavailable resources block the affected gate.

Keep full raw stdout, separate stderr, command/cwd/source/input hashes, timings,
objective grades and standard Outputs/Benchmark and trigger-set viewers durably
outside installable skills. The operator owns future qualitative acceptance after
seeing outputs; source tests and collector qualification do not establish it.
Definitions are not passing measurements. Both independent candidate-bound review
axes and required repository checks remain separate completion gates.
