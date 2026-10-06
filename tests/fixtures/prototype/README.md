# Acme account settings (test fixture)

Input for the prototype skill's UI evaluation (#258). A small server-rendered app using
only the Python standard library; there is no package manager or build step.

- Start: `python3 app.py --env development` or `python3 app.py --env production`,
  optionally with `--port N` (`--port 0` picks a free port). The first stdout line
  announces the loopback address.
- `--env` is the project's only configuration and must be given explicitly.
- `settings_logic.py` holds the project's logic over stub data; `app.py` renders pages
  and routes requests. The account settings page lives at `/settings`.
