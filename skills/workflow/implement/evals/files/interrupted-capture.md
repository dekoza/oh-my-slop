# Implementation pre-review exercise
Use the supplied workflow skill. Task-only source-inspection simulation: read only the named skill, its directly linked invariant-preflight reference if present, and this file. Do not run tools beyond these reads, edit, test, push, post, merge, install or spawn. Under 650 words, give remaining construction before independent review and a minimal meaningful test plan. Fixture facts are not executed proof.

One authorized ticket builds a durable capture flow. Existing committed candidate H2 at fixed base B1 has a happy-path unit selection green, no final review yet. Operator limits testing to affected selections; no full tiers/full E2E. Preparation UI must recover from interrupted delivery; admitted commands retain exact identity through ambiguous acknowledgement and replay, and must not report rejection when outcome is unknown. No new queues, recovery features or broad refactors allowed.

Relevant new seams:
```javascript
async function prepare(url) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 5000);
  const response = await fetch(url, {signal: abort.signal});
  clearTimeout(timer); // headers have arrived, response body may still stall
  return response.json();
}
async function submit(entry) {
  busy = true;
  const prepared = await prepare(entry.url);
  const command = await store.capture(prepared);
  const reply = await send(command.wire);
  await store.saveAnswer(command.id, reply); // may fail after server committed
  showAccepted(reply);
  busy = false;
}
submitButton.onclick = () => submit(entry).catch(() => showRejected());
```

Source facts: store.capture durably saves original wire; send retries pending originals on reload; a server acknowledgement does not prove local saveAnswer succeeded. Other unchanged shared presenter paths already have header-and-body request deadlines. Available seams: deterministic JS unit fault injection, real browser stalled-body and local-storage-failure cases, public server replay integration, PostgreSQL locking races. Choose by actual invariant, not a policy of running everything or replacing browser guarantees with mocks. No current test evidence covers the displayed failure paths.
