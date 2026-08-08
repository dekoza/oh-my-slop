# Pyke Syntax Overview

Pyke has three source-file kinds, each with its own suffix and knowledge-base
type:

| Suffix | Knowledge base | Compiled into |
|--------|----------------|---------------|
| `.kfb` | fact base | `.fbc` pickle |
| `.krb` | rule base | up to 3 `.py` files (`_fc`, `_bc`, `_plans`) |
| `.kqb` | question base | `.qbc` pickle |

Files are placed in a directory tree; the engine constructor recursively scans
the tree. The directory structure does not matter to Pyke. The name of each
knowledge base is the filename with the suffix removed (must be a legal Python
identifier).

Compilation only re-runs when source files have changed since the last
compilation.

## Syntax legend

- `Required` / `'literal'` — literal punctuation or keyword.
- `a \| b` — alternation.
- `[a]` — optional `a`.
- `{a}` — one or more `a`s.
- `IDENTIFIER` — any legal Python identifier (including `True`/`False`/`None`
  as data in KFB).
- `NUMBER` — integer or float literal.
- `STRING` — any Python string literal (`'...'`, `"..."`, `r'''...'''`, etc.).
- `TEXT` — any text (KQB only), delimited.
- `PARAMETRIZED_TEXT` — any text through end of line and indented continuation
  lines (KQB only); treated as `string.Template` with `$IDENT` / `${IDENT}`.
- `REGEXP_TEXT` — any text excluding an unescaped delimiter (KQB only).

## Lexical rules (KRB / KFB)

KRB and KFB share lexical structure. The lexer recognizes:
- Comments: `#` to end of line.
- `True`, `False`, `None` as boolean / null literals.
- Identifiers, numbers, strings.
- Parentheses, commas.
- Whitespace (newlines, spaces, tabs) is significant for indentation in KRB
  (used for `when`/`assert`/`fc_extras` blocks).

## KQB syntax (question base source files)

KQB uses a different lexical structure with `PARAMETRIZED_TEXT` (multi-line
indented text, `string.Template` substitution).

```
file ::= [NL] {question}

question ::= IDENTIFIER '(' [{parameter,}] ')' NL INDENT
               {PARAMETRIZED_TEXT NL}
               '---' NL
               parameter '=' question_type
            DEINDENT

parameter ::= '$' IDENTIFIER
```

Each question has a name, parameters, then `---`, then the answer-parameter line
`$ans = question_type`. `question_type` is one of:
- `yn` — yes/no (`$ans` ∈ {'yes','no'} or `True`/`False`);
- `integer(m-n)` — integer in range `[m,n]`;
- `float(m-n)` — float in range `[m,n]`;
- `range(m,n)` — integer range (returns the integer);
- `regex(PATTERN)` — regex match;
- `select('a', 'b', ...)` — multiple choice;
- plain `TEXT` / `PARAMETRIZED_TEXT` (free form).

After `---`, optional review text can follow per answer value, e.g.:
`200000- ! Wow, that's a lot of miles!`

The `context` object is available in `bc_extras`/`with`/`python` clauses and
provides `is_bound(variable)`, `lookup_data(name)`, `bind(name, value)`,
`mark()` / `undo_to_mark()`.
