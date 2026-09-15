# `tea api` & scripting

## Contents

- Endpoint and output contracts
- File and stdin bodies
- Verify HTTP and application outcomes
- Pagination and complete exports
- CLI display data
- Debugging and recovery

Replace `OWNER/REPO`, `LOGIN`, `INDEX` and `COMMENT_ID` with the project's resolved
binding. Examples are not default accounts. For comments, also read `issues.md`.
Version coverage and probe limits are recorded in `verification.md`.

## Endpoint and output contracts

```sh
tea api --repo OWNER/REPO --login LOGIN -i '/repos/OWNER/REPO/issues/INDEX'
```

The first positional argument is the **endpoint**. Use `-X/--method` for a method,
not a positional verb such as `get`. The default is GET, or POST when a body is
supplied; set the method explicitly for mutations so a missing `-X DELETE` cannot
turn removal into creation.

- `/api/v1/` is prefixed unless the endpoint starts with `/api/` or `http(s)://`.
  A leading slash is optional. Use the configured instance; an absolute URL is not
  permission to send its credentials to another host.
- Write the owner/repo into paths explicitly. Automatic `{owner}`/`{repo}`
  substitutions depend on resolved context and can remain literal if unresolved.
- Quote endpoints containing `?` or `&`; otherwise the shell can change the request.
- Put flags after the subcommand: `tea api --repo OWNER/REPO <endpoint>`.
  `--debug/--vvv` is global; most flags are command-specific.

| Flag | Meaning |
|---|---|
| `-f key=value` | String field |
| `-F key=value` | Typed field: number, boolean, null, JSON array/object; `@file`/`@-` input |
| `-d '<json>'` | Complete raw JSON body; `@file`/`@-` input; cannot combine with `-f`/`-F` |
| `-X METHOD` | Explicit HTTP method |
| `-H 'key:value'` | Header; colon syntax, not `key=value` |
| `-i` | Status and response headers to **stderr**, body to stdout |
| `-o FILE` | Body to a **file**, not a format; `-` means stdout |

The API already returns API data. `tea api -o json` names a file literally `json`;
it does not request JSON formatting. Use stdout directly or name an intentional
output path. By contrast, list commands use `-o json` as a display format — and
`--output` is additionally inherited by subcommands from their parent, so it
**parses on commands whose help never lists it**: honored on `issues/pulls create`
(0.16.0+), silently ignored elsewhere (verified: `-o json` on `issues close` and
`issues edit` printed markdown, exit 0). Flag accepted ≠ flag honored.

Use `-f key=null` for the string `"null"`, and `-F key=null` for JSON null. Shell
quoting in `-F key="null"` is removed before tea sees the argument; it does not
force a string. This was checked with the real tea binary against a loopback fixture.

## File and stdin bodies

Prefer a plain file-backed call when a body contains Markdown, shell-looking text
or exact whitespace. Command substitution strips trailing newlines; it cannot
preserve an exact file body, even when quoted safely. A worktree guard may also
refuse complex substitutions. Keep the guard and use the file interface instead.

Since tea 0.16.0, issue and PR create/edit have a native file body
(`--description-file <path|->`, byte-exact — verified via logged request bodies);
`tea api` stays the route for comments and every other entity. Mind the asymmetry:
`tea api` with bare piped stdin sends **no body**, while `tea issues/pulls create`
with no description flag **consumes non-TTY stdin as the body** (hanging until EOF
on a silent open pipe).

| Input you have | Supply it as |
|---|---|
| Markdown/text for the comment's `body` field | `-F body=@review.md` |
| A complete JSON object, such as `{"body":"..."}` | `-d @payload.json` |
| Complete JSON on stdin | `-d @-` with stdin redirected or piped |
| One literal string field | `-f body='short text'` |

```sh
# The text file becomes one body field, retaining its contents.
tea api --repo OWNER/REPO --login LOGIN -i -X POST \
  '/repos/OWNER/REPO/issues/INDEX/comments' -F body=@review.md

# payload.json is already the complete API request object.
tea api --repo OWNER/REPO --login LOGIN -i -X POST \
  '/repos/OWNER/REPO/issues/INDEX/comments' -d @payload.json

# Stdin is explicit; redirection by itself supplies no request body.
tea api --repo OWNER/REPO --login LOGIN -i -X POST \
  '/repos/OWNER/REPO/issues/INDEX/comments' -d @- < payload.json

# Edit an existing comment by global comment ID.
tea api --repo OWNER/REPO --login LOGIN -i -X PATCH \
  '/repos/OWNER/REPO/issues/comments/COMMENT_ID' -F body=@review.md
```

Read existing comments for the workflow's marker **before** choosing add versus
edit; verify the persisted body afterwards. A returned comment ID identifies a
write response, not proof that the exact intended content survived.

`tea api -X POST <endpoint> < payload.json` sends no body. Adding Content-Type
cannot repair that omission. Use `-d @file` or `-d @-`; tea handles the JSON request
content type for supplied bodies. Serialize JSON with a JSON encoder when constructing
complete payloads, rather than interpolating Markdown into a JSON string.

## Verify HTTP and application outcomes

**Process success is not HTTP success.** Real tea 0.15.1 and 0.16.0 both returned
exit 0 for a fixture HTTP404. Historical Gitea observations include API HTTP500 at
exit 0 too. Transport failures exit nonzero — since 0.15.0 tea sets HTTP transport
timeouts, so a stalled server produces a client-side failure instead of hanging
forever. CLI entity commands normally report rejected operations nonzero, but an
invented verb can select a different operation and return a successful listing.

Capture the full result, retaining stdout separately from status/diagnostics:

```sh
tea api --repo OWNER/REPO --login LOGIN -i \
  '/repos/OWNER/REPO/issues/INDEX' > response.json 2> response.headers
```

Use fresh, intentional output files in a run workspace. Then:

1. Check the process result for a transport/CLI failure.
2. Parse the final HTTP status from stderr; accept the endpoint's successful 2xx
   statuses, not just a literal `HTTP/1.1 200`. HTTP/1.0 and HTTP/2 status lines are
   possible; a pattern such as `HTTP/\S+\s+(\d+)` avoids fixing the protocol version.
   A missing status is unverified, not implicit success.
3. Parse the body according to that endpoint's response contract. Plain-text/HTML
   errors and unexpected object/array shapes are failures to investigate. A generic
   `"message"` key alone is not a universal error test: valid API objects can have it.
   Successful no-content responses need no invented JSON body.
4. For writes, read the affected item/comment/edge and check the intended postcondition
   before claiming success or issuing a dependent write. After a timeout, inspect
   state before retrying: the first write may already have landed.

Preserve the full error body. Piping `-i`'s combined streams into a JSON parser, or
trimming them with `head`/`tail`, can hide the actual cause and create secondary parse
errors. An unexpected listing, empty stdout or parse error calls for command help
and the reference—not guessed flags and suppressed stderr.

## Pagination and complete exports

List commands default to page1 and limit30; there is no general automatic pagination.
API responses may expose `Link` and `X-Total-Count` via `-i`.

**An empty-page sentinel is not sufficient.** On the observed Gitea 1.27.1 comments
endpoint, total1/page1 returned one comment and page2 returned that same comment.
An export that increments until `[]` would stall. This is an endpoint/version
observation, not a claim that every Gitea endpoint behaves that way.

For an export:

1. Read the endpoint's pagination contract and capture its headers along with each
   page. Track unique item IDs and a bounded request budget.
2. Use consistent total/count evidence or documented Link semantics to establish
   completion. If the first page has one unique comment and total1, it is complete;
   do not demand an empty extra page. Follow a next Link only within the configured
   instance and endpoint scope.
3. When a total promises more records, keep fetching supported pages. A repeated
   page, missing expected records, contradictory headers, changing totals or budget
   exhaustion makes the export **incomplete**. Deduplication prevents duplicate rows;
   it is not proof that no rows are missing.
4. If neither total nor trustworthy links establish completion, verify the endpoint's
   paging/termination rules. A short page alone is insufficient when server-side
   limits or unsupported paging could explain it. Report unresolved completeness
   instead of publishing a partial result as the full discussion.

Keep partial data labelled incomplete when a later request fails. A contemporaneous
export is not a transactionally consistent snapshot of an actively changing tracker.

## CLI display data

`--output json` on list commands serializes the selected table fields. Numeric-looking
values such as `"index": "193"` are strings, not integers. Available fields and
rendering differ by command; display bodies/timestamps can be formatted or shortened.
Use typed API objects for numeric comparisons, full-fidelity bodies and fields the
CLI cannot expose. Convert explicitly when working with display strings.

`tea` has no `--jq`/`--template` equivalent. Parse stdout with `jq` or Python after
checking status. Formats include simple, table, csv, tsv, yaml and json. ANSI output
can also need stripping; table borders are not an API schema.

## Debugging and recovery

Use `--debug` on a read to inspect the selected login and exact request URL. Keep
diagnostics out of JSON stdout parsing. CLI help establishes supported flags;
`verification.md` records which behavior was actually tested. A live read can
revalidate context without replaying a mutation.
