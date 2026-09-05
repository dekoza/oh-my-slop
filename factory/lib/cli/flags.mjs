/**
 * The verb-independent flag names a module outside `cli/` has to know.
 *
 * **Not the whole global set.** `--help` and `-h` are read only where they are
 * answered, inside `cli/main.mjs`, and stay there; this module exists for the
 * ones a second reader needs, which today is one. A flag arrives here when it
 * gains that second reader, not because it is global.
 *
 * Every other flag constant in this package lives beside the behaviour it
 * selects — `FOREGROUND_FLAG` in `controller/launch.mjs`, `PARENT_FLAG` in
 * `controller/scope.mjs`, `NEW_RUN_FLAG` in `controller/start.mjs` — and
 * `--json`'s behaviour lives in `cli/main.mjs`. Exporting it from there would
 * make `controller/launch.mjs` import the binary's composition root, which
 * imports the verb table, which imports `launch.mjs`. That cycle would in fact
 * evaluate — nothing reads the constant at module scope — but the import
 * direction is the objection: the composition root reaches down into the
 * subsystems, and no subsystem reaches back up into it. A module that imports
 * nothing costs nothing to depend on.
 */

/** §10.2's machine rendering: the value is the same, the shape is not. */
export const JSON_FLAG = "--json";
