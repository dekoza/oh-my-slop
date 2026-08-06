# Pragmatic practices guide

Read the section matching the ownership, volatility, automation, decay, or estimation pressure in
the current change. These practices adapt the distinct working habits from
`the-pragmatic-programmer` without duplicating this repository's TDD, debugging, design, or
production-resilience workflows.

## One authoritative owner per fact

Apply DRY to knowledge, not merely repeated text. A repeated string is harmless when its copies
mean different things; two different implementations are dangerous when they encode the same
business rule.

For each rule, schema, status meaning, mapping, calculation, configuration value, generated file,
or process step:

1. Name the authoritative owner.
2. Generate or derive secondary representations where possible.
3. Mechanically validate copies that cannot be derived.
4. Document the trace when a platform boundary forces duplication.
5. Reject synchronization that relies only on a maintainer remembering every copy.

Examples include generating client schemas from one contract, exporting infrastructure outputs to
deployment configuration, and checking documentation examples against executable fixtures.

## Reversible volatile decisions

Treat uncertainty and reversal cost separately. A likely vendor switch does not justify a universal
adapter framework. Route seam shape and interface minimalism to
[`codebase-design`](../../codebase-design/SKILL.md); this guide decides when reversal risk needs
protection.

- Keep provider construction and configuration in one outer location.
- Record capabilities that cannot be made portable without changing behavior.
- Delay irreversible data formats, identifiers, and API contracts until evidence requires them.
- State the migration path and cost instead of claiming that an adapter makes switching free.

Prefer a direct implementation when the decision is stable, cheap to reverse, or the proposed seam
would merely mirror the vendor API.

## Versioned automation and inspectable artifacts

Automate repeated, error-prone, ritualized, or easy-to-forget work. Put the automation under version
control and make it reproducible from declared inputs. Good candidates include setup, code
generation, formatting, validation, packaging, deployment, data migration, and release checks.

Prefer plain text, open formats, explicit serialization, and versioned configuration when humans or
tools must diff, migrate, audit, or interoperate with the artifact. Generated output should identify
its owner and generation command. Secrets remain in the repository's secret-management boundary,
not in otherwise inspectable config.

Keep a manual step when automation would be less reliable or when human judgment is the point. Name
the responsible role, required evidence, and failure path so "manual" does not mean folklore.

## Broken windows

Treat visible decay as a norm-setting signal. In the touched area:

- repair a small defect when the correction is cheap and verified;
- contain a risky defect when immediate repair would broaden scope;
- record a follow-up with owner and impact when neither is safe in the current change;
- keep temporary shortcuts visibly temporary with an upgrade or removal condition.

Do not turn the broken windows rule into opportunistic rewriting. The target is to stop decay from
becoming accepted practice, not to hide the requested change inside an unrelated cleanup campaign.

## Honest estimates

Express estimates as ranges tied to assumptions and evidence:

- name what is included and excluded;
- identify the largest unknowns and reversal risks;
- separate effort from elapsed time and coordination delay;
- state confidence or the conditions under which the range holds;
- name the next experiment, spike, or answered question that would narrow uncertainty;
- update the estimate when feedback invalidates an assumption.

A precise date without stable requirements, integration knowledge, or measured throughput is not a
better estimate. It is hidden uncertainty.
