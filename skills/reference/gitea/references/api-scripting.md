# `tea api` & Scripting

## Exit codes — the scripting trap

| Command class | Behaviour on failure |
|---|---|
| `tea issues`, `tea pulls`, `tea repos`, … | Exit `1`, message on stderr |
| **`tea api`** | **Exit `0` regardless of HTTP status** |

Verified:

```console
$ tea issues close --repo minder/does-not-exist 1 ; echo $?
Error: not found
1
$ tea api /repos/minder/does-not-exist/issues ; echo $?
{"message":"..."}
0
```

`tea api` reports whether the *request* completed, not whether it *succeeded*. Gate on the status line instead:

```sh
# -i writes status + headers to STDERR, body to stdout
if tea api -i '/repos/minder/app/issues/5/dependencies' 2>&1 >/dev/null | grep -q '^HTTP/1.1 2'; then
  echo ok
fi
```

Or check the body for an error envelope — Gitea errors are always `{"message": ..., "url": ...}`:

```sh
resp=$(tea api "$endpoint")
python3 -c "import sys,json;d=json.loads(sys.stdin.read());sys.exit(1 if isinstance(d,dict) and 'message' in d else 0)" <<<"$resp"
```

## Endpoint form

```
tea api [options] <endpoint>
```

- Prefixed with `/api/v1/` automatically unless the path already starts with `/api/` or `http(s)://`.
- `{owner}` and `{repo}` placeholders are substituted from repo context — which inherits the resolution problems in `references/repo-context.md`. **Write paths literally** (`/repos/minder/app/issues`) rather than relying on placeholders.
- **Quote any endpoint containing `?` or `&`** or the shell will mangle it: `tea api '/repos/{owner}/{repo}/issues?state=open'`.
- With no repo context, `{owner}`/`{repo}` are left **literal**, producing a bare `404 page not found` — at exit `0`. Pair placeholders with `--repo`, or write the path out.
- A leading slash is optional; `repos/o/r/...` and `/repos/o/r/...` behave identically.

`--debug/--vvv` is the only true global flag. Every other flag is per-command, so **position matters**: `tea api --repo X <endpoint>`, never `tea --repo X api <endpoint>`.

## Building request bodies

| Flag | Purpose |
|---|---|
| `-f key=value` | String field |
| `-F key=value` | Typed field — numbers, booleans, `null`; `[`/`{` parsed as JSON; `@file` / `@-` reads a file or stdin |
| `-d '<json>'` | Raw JSON body; `@file` / `@-` supported. **Cannot combine with `-f`/`-F`** |
| `-H 'key:value'` | Custom header |
| `-X METHOD` | `GET`/`POST`/`PUT`/`PATCH`/`DELETE` |
| `-i` | Include status + headers (to **stderr**) |
| `-o FILE` | Write body to a **file** (`-` for stdout) — *not* a format flag |

> **`-o` collision.** Everywhere else `-o` picks a format. On `tea api` it names an output file, so `tea api -o json /repos/...` creates a file called `json` in `$PWD` instead of formatting anything. `tea api` always emits raw JSON from the server; there is nothing to format.

**Method defaults to `POST` whenever a body is supplied** via `-f`/`-F`/`-d`. Set `-X` explicitly for `PUT`/`PATCH`/`DELETE` — a `DELETE` written without `-X` silently becomes a `POST` and creates instead of removes.

Force a string that looks like another type by quoting: `-F key="null"` sends the literal string.

```sh
tea api -X PATCH '/repos/minder/app/issues/5' -d '{"state":"closed"}'
echo '{"body":"long text"}' | tea api -X POST '/repos/minder/app/issues/5/comments' -d @-
```

## `-o json` is not the API

`--output json` on list commands serialises **the rendered table**, not the API response:

```json
[ { "index": "193", "title": "…", "state": "open", "owner": "minder", "repo": "nukem2_again" } ]
```

Two consequences:

1. **Only `--fields` columns appear.** Anything not selectable via `-f` (body, timestamps, dependencies, assignee objects) is unreachable this way.
2. **Every value is a string.** `"index": "193"`, not `193`. `jq 'select(.index > 100)'` compares strings and gives wrong answers; cast first, or use `tea api`.
3. **Long values are truncated with `…`.** Issue bodies and timestamps are rendered for display (`"created": "2026-07-17 18:27"`, not ISO-8601). Never treat `-o json` output as faithful data.

`tea` has no `--jq`/`--template` equivalent — pipe to `jq` or `python3`.

Available formats: `simple`, `table` (default), `csv`, `tsv`, `yaml`, `json`. `csv` quotes fields containing commas correctly. Use `simple` for unadorned lines when piping to `grep`/`awk` — `table` draws box-drawing borders that will confuse parsers.

Reach for `tea api` whenever you need typed values, full objects, or fields the table cannot express.

## Pagination

List commands default to `--limit 30` (`--lm`) and `--page 1` (`-p`). There is no auto-pagination — a bare list silently truncates at 30. For totals, `tea api` responses expose `X-Total-Count` and `Link` headers via `-i`:

```console
Link: <...page=2...>; rel="next", <...page=113...>; rel="last"
X-Total-Count: 113
```

## Stripping colour

`tea` emits ANSI escapes even when piped, which breaks naive parsing:

```sh
tea issues list --repo minder/app 2>&1 | sed -r 's/\x1B\[[0-9;]*[mK]//g'
```

## Debugging

`--debug` (`--vvv`) prints the resolved login, the matched remote URL, and every HTTP request — the definitive way to confirm which repo a command actually hit:

```sh
tea issues list --repo minder/app --debug 2>&1 | grep '^GET:'
```
