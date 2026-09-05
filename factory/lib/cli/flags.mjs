/**
 * The flags that belong to **no verb** — the ones every invocation may carry.
 *
 * Every other flag constant in this package lives beside the behaviour it
 * selects (`FOREGROUND_FLAG` in `controller/launch.mjs`, `PARENT_FLAG` in
 * `controller/scope.mjs`, `NEW_RUN_FLAG` in `controller/start.mjs`), and
 * `--json`'s behaviour lives in `cli/main.mjs`. It cannot be exported from
 * there: `main.mjs` imports the verb table, which imports the modules that would
 * have to read it back, and a constant reached through an import cycle is a
 * constant that is sometimes undefined.
 *
 * So it lives one level down, in a module that imports nothing. Two places need
 * it — the renderer that reads it, and the detached launcher that must *not*
 * re-type it onto the controller's line (§10.1, #213) — and one spelling per
 * place is how one of them comes to spell it differently.
 */

/** §10.2's machine rendering: the value is the same, the shape is not. */
export const JSON_FLAG = "--json";
