# Special Knowledge Base and Question Bases

## The `special` knowledge base

There is exactly one instance, named `special`. It provides four built-in
knowledge entities that do "something special" when proven/looked up. These
are referenced in `.krb` rules as `special.<name>(...)`.

### `special.claim_goal()`

No arguments. Acts like the Prolog cut operator. When a rule executes
`special.claim_goal()` in its `when` clause, none of the remaining rules for
that goal are tried on backtracking. This is used when a rule *must* be the
correct one — place `claim_goal()` after the premises that prove it, so
subsequent rules are only tried if those premises fail (and `claim_goal()` is
never executed).

Example:
```
one_dog
    use n_dogs(1, '1 dog')
    when
        special.claim_goal()

n_dogs
    use n_dogs($n, $phrase)
    when
        $phrase = "%d dogs" % $n
```

### `special.check_command(cmd, [cwd], [stdin])`

Runs a shell command. Returns success (proof succeeds) iff the command exits
with code 0. `cmd` is a pattern (string/tuple); `cwd` and `stdin` are optional
patterns.

### `special.command($out, cmd, [cwd], [stdin])`

Runs a command whose exit code must be 0; yields the stdout lines (stripped of
trailing newlines) as a tuple bound to `$out`.

### `special.general_command($result, cmd, [cwd], [stdin])`

Runs a command and yields `($retcode, stdout, stderr)` bound to `$result`.

All command entities use `subprocess.Popen` internally.

## Question bases (`.kqb`)

Question bases contain end-user questions. The answer to every question is
remembered (cached) so that if multiple rules ask the same question, the user
only sees it once. Answers are erased on `engine.reset()`.

A question has:
- a name and parameters;
- parametrized prompt text (PARAMETRIZED_TEXT, `string.Template`);
- an answer-parameter line `$ans = question_type` after a `---` separator;
- optional review text per answer value.

`question_type` is one of:
- `yn` — yes/no;
- `integer(m-n)` / `float(m-n)` — numeric range;
- `range(m,n)` — integer range;
- `regex(PATTERN)` — regex match;
- `select('a', 'b', ...)` — multiple choice;
- plain text (free form).

Review text follows the answer-line, e.g. `200000- ! Wow, that's a lot!`.

In rules, a question is used as a premise: `qbase.question($param, $ans)`.
Only the answer parameter may be unbound when a rule uses the question.

## Knowledge entity names

Within rules, a knowledge entity is referenced as `kb_name.entity_name(...)`.
If a single name is used in a premise, the current rule base's category is
assumed. If two names are used, the first is a category (or other KB) and the
second is the entity. For rule bases, the first name must be a category; the
currently active rule base for that category is used to prove the premise.
