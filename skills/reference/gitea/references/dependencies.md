# Issue Dependencies (Blocked-By / Blocks)

Gitea supports native issue dependencies. **`tea` exposes no command for them** — they are reachable only through `tea api`. This is the single most common reason to drop to the API.

## The two directions

| Endpoint | Meaning |
|---|---|
| `/repos/{owner}/{repo}/issues/{index}/dependencies` | Issues that **{index} depends on** — i.e. what blocks it |
| `/repos/{owner}/{repo}/issues/{index}/blocks` | Issues that **{index} blocks** — i.e. what waits on it |

They are two views of one edge. Adding `#1` to `#2`'s *dependencies* automatically makes `#2` appear in `#1`'s *blocks*.

## Reading

```sh
tea api '/repos/minder/oh-my-slop/issues/24/dependencies'
tea api '/repos/minder/oh-my-slop/issues/24/blocks'
```

Returns a JSON array of full issue objects (empty `[]` when none). Extract just the numbers:

```sh
tea api '/repos/minder/oh-my-slop/issues/24/dependencies' \
  | python3 -c "import sys,json;print([i['number'] for i in json.load(sys.stdin)])"
```

## Writing

The body is a Gitea `IssueMeta`: **`index`, `owner`, and `repo` — all three required**, even when the dependency is in the same repo.

```sh
# Make #2 blocked by #1
tea api -X POST '/repos/minder/myrepo/issues/2/dependencies' \
  -F index=1 -f owner=minder -f repo=myrepo

# Remove that dependency
tea api -X DELETE '/repos/minder/myrepo/issues/2/dependencies' \
  -F index=1 -f owner=minder -f repo=myrepo
```

`-F` sends `index` as a typed integer; `-f` sends the strings. A raw body works equally well:

```sh
tea api -X POST '/repos/minder/myrepo/issues/2/dependencies' \
  -d '{"owner":"minder","repo":"myrepo","index":1}'
```

Both succeed with `201 Created` — note that **DELETE also returns `201`**, though swagger documents `200`. Do not assert on `200`.

Re-adding an existing dependency returns **HTTP 500**, not a benign conflict:

```json
{"message":"issue dependency does already exist [issue id: 383, dependency id: 373]"}
```

Those are internal **database IDs**, not issue indices — do not try to map them back to `#numbers`. Make dependency creation idempotent by checking the current `/dependencies` list first.

### The misleading 404

Omitting `owner`/`repo` does not produce a validation error. It produces:

```json
{"message":"repository does not exist [id: 0, uid: 0, owner_name: , name: ]"}
```

with status `404`. The empty `owner_name`/`name` in that message is the tell: the body was incomplete, not the URL wrong. Because `tea api` exits `0` on 404, a script that ignores the body will believe the dependency was created.

The `201` response body echoes the **blocked issue** (the one in the URL), not the dependency you just added — so `.number` in the response is the URL's index. Verify with a follow-up GET rather than trusting the echo.

## Closing is enforced server-side

An issue with open dependencies cannot be closed:

```console
$ tea issues close --repo minder/myrepo 2
Error: cannot close this issue or pull request because it still has open dependencies
```

The issue stays `open`, and `tea` exits `1`.

**No list output reveals blocked-ness.** The `--fields` set for `tea issues list` has no dependency column, so a blocked ticket is indistinguishable from a ready one in any table or `-o json` output. Before treating an issue as actionable, query its `/dependencies` explicitly.

## Cross-repo dependencies

Point `owner`/`repo` at the other repository; the URL still names the blocked issue's repo:

```sh
# minder/app#5 is blocked by minder/infra#12
tea api -X POST '/repos/minder/app/issues/5/dependencies' \
  -F index=12 -f owner=minder -f repo=infra
```
