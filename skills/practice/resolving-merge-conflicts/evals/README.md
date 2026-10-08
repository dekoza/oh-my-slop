# Resolving merge conflicts evaluation

## Closing decisions through grilling — #265

Case 4 is a direct user invocation. The authorized merge is complete, and two choices
remain: a timeout value that now disagrees with the docs, and the optional deletion of
the merged branch. Method, limits and the full table are in the
[shared #265 record](../../../workflow/grilling/evals/README.md#decision-handoffs-ask-through-grilling--265).

Over 3 trials per arm in the package-level comparison, where the supporting `grilling`
text also differs between arms, baseline asked both choices as numbered questions with
recommendations in 1/3 runs. Two runs left branch deletion as a status line ("Tell me if
you want it deleted"). The candidate did so in 3/3 runs. No run changed the timeout,
deleted the branch, pushed or aborted.

With `grilling` held at the candidate text (the shared record's
[matched-support comparison](../../../workflow/grilling/evals/README.md#matched-support-comparison)),
the base wording also asked both choices in 3/3 runs. This scenario therefore shows no
effect of the conflicts wording itself.

The caller-return branch, used when another skill such as `fix-pr` invokes this one, was
not measured separately. The worker-to-caller control is
[implement case 18](../../../workflow/implement/evals/README.md#closing-decisions-through-grilling--265).

These figures are measurements pending owner direction, not a claimed lift. The shared
record explains why.
