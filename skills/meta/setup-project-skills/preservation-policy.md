# Clean-cut policy and launch-retirement gate

Use only for Section E's owner-approved, no-preservation-obligations branch. The
policy and its retirement gate are one setup change, not independent options.

## Bind the pair

1. Resolve the project instruction file using Step 4 of `SKILL.md`. Use that actual
   path throughout the ticket, including when the existing file is `CLAUDE.md`.
2. Read the existing launch-governing ticket, including comments, on the **agent work
   tracker**. Propose the acceptance criteria below in its body, not only a comment.
3. If no such ticket exists, ask to create a named launch-execution gate through the
   configured tracker. A local-markdown tracker uses its ticket-file convention;
   do not invent a remote URL or publish on the intake tracker. If the owner declines
   a gate, leave the exemption inactive. Unrelated setup can still proceed.
4. Show the proposed paragraph, real ticket link or approved creation proposal, and
   both sets of changes before writing. Reuse existing sections on re-sync.

## Instruction paragraph

Adapt project names and the gate reference to confirmed facts. Keep this outside the
`## Agent skills` pointer block; it is an app-change rule, not a consumer-doc binding.
Replace the placeholders with the resolved file and ticket references before activation.

> ## Pre-production: clean-cut changes
>
> The owner confirms that this project has no real users, non-disposable data,
> integration compatibility obligations, or contractual/payment commitments to
> preserve. While this paragraph remains applicable, make any app change as a clean
> cut: replace obsolete code, schemas, interfaces and behavior directly instead of
> retaining backward compatibility, legacy fallbacks, transitional adapters, dual
> paths or staged transitions for prior versions. There is no historical data to
> inventory, migrate, preserve, backfill or reconcile. Keep fresh-install schema
> setup and current tests/fixtures working; leave already completed migrations alone.
> Future runtime correctness still matters: recovery, idempotency, security, backups
> and obligations created after launch are not historical migration work. This rule
> does not authorize deleting unrelated user work or untracked files.
>
> **Mandatory retirement:** [launch gate reference] must remove this exemption from
> [instruction file] and replace it with the actual preservation/compatibility
> obligations before accepting real users, non-disposable data, or contractual/payment
> commitments, including qualifying beta releases. Verify the release commit before
> GO. If real obligations already exist, this exemption is no longer applicable;
> surface the conflict and establish preservation rules before further changes.

## Mandatory launch acceptance criteria

Insert these unchecked criteria into the launch-governing ticket's body, naming the
actual instruction-file path. Do not mark them complete during setup: the exemption
remains active for eligible pre-launch development.

- [ ] Before accepting real users, non-disposable data, or contractual/payment
  commitments, including qualifying beta releases, remove the clean-cut exemption
  from the named instruction file and replace it with the actual data-preservation,
  API/integration compatibility and commitment-protection obligations. Their scope
  follows the release's real use, not its label as beta or production.
- [ ] Verify the **release commit** contains that replacement and cite the commit and
  instruction-file change in the go/no-go checklist. An unchecked criterion means
  **NO-GO for real use**; a planning decision or local working-tree edit is insufficient.
- [ ] If this planning ticket closes before release execution, carry every unchecked
  retirement criterion into a **named launch-execution gate**, link it from this ticket
  and the active exemption, and keep it blocking GO. Closing planning is not retirement.

Retirement documents obligations from the point real use begins; it does not demand
historical-data investigations, migrations, backfills or reopening completed migratory
work. Keep clean-cut development active until that boundary, rather than removing it
merely because planning finished.

## Persist and verify

Persist the launch-ticket update or creation first and read it back. Confirm the exact
criteria, resolved instruction-file path and a reachable gate reference. Only then
write the approved instruction paragraph with that reference; read back both artifacts
and verify their links and retirement conditions agree.

If tracker authorization, creation, update or verification fails, **leave the exemption
inactive** and report the failed step; do not claim the pair is installed. Preserve
existing files and completed artifacts. If the ticket succeeded but the file write
failed, report the partial state and retry only the missing write after checking for
concurrent edits. An existing standalone exemption discovered during re-sync needs
an approved gate or replacement, not a silent declaration that setup is complete.

On re-sync, preserve the owner's explicit answer and local edits; repair the existing
pair in place. A declined or retired exemption stays absent unless the owner explicitly
reassesses eligibility. Changed real obligations require a new decision, not automatic
restoration of the template.

**Complete when:** both approved artifacts are persisted, read back and cross-linked;
the report names the policy file, gate and retirement boundary. Otherwise name the
blocked portion while completing any unrelated setup that remains safe.
