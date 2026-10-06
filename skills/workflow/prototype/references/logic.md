# Logic Prototype

A tiny interactive terminal app that lets the user drive a state model by hand. Use this when the question is about **business logic, state transitions, or data shape** — the kind of thing that looks reasonable on paper but only feels wrong once you push it through real cases.

## When this is the right shape

- "I'm not sure if this state machine handles the edge case where X then Y."
- "Does this data model actually let me represent the case where..."
- "I want to feel out what the API should look like before writing it."
- Anything where the user wants to **press buttons and watch state change**.

If the question is "what should this look like" — wrong branch. Use [UI](ui.md).

## Process

### 1. State the question

Before writing code, write down what state model and what question you're prototyping. One paragraph, in the prototype's README or a comment at the top of the file. A logic prototype that answers the wrong question is pure waste — make the question explicit so it can be checked later, whether the user is watching now or returning to it AFK.

### 2. Pick the language

Use whatever the host project uses. If the project has no obvious runtime (e.g. a docs repo), ask.

Match the project's existing conventions for tooling — don't add a new package manager or runtime just for the prototype.

### 3. Isolate the logic in a portable module

Put the actual logic — the bit that's answering the question — behind a small, pure interface that could be lifted out and dropped into the real codebase later. The TUI around it is throwaway; the logic module shouldn't be.

The right shape depends on the question:

- **A pure reducer** — `(state, action) => state`. Good when actions are discrete events and state is a single value.
- **A state machine** — explicit states and transitions. Good when "which actions are even legal right now" is part of the question.
- **A small set of pure functions** over a plain data type. Good when there's no implicit current state — just transformations.
- **A class or module with a clear method surface** when the logic genuinely owns ongoing internal state.

Pick whichever shape best fits the question being asked, *not* whichever is easiest to wire to a TUI. Keep it pure: no I/O, no terminal code, no `print` for control flow. The TUI imports it and calls into it; nothing flows the other direction.

This is what makes the prototype useful past its own lifetime. When the question's been answered, a separately authorized implementation can lift the validated reducer / machine / function set into the real module; the TUI shell is never lifted.

### 4. Build the smallest TUI that exposes the state

Build it as a **lightweight TUI** — on every tick, clear the screen (`print("\033[2J\033[H")`) and re-render the whole frame. The user should always see one stable view, not an ever-growing scrollback.

Each frame has two parts, in this order:

1. **Current state**, pretty-printed and diff-friendly (one field per line, or formatted JSON). Use **bold** for field names or section headers and **dim** for less important context (timestamps, IDs, derived values). Native ANSI escape codes are fine — `\x1b[1m` bold, `\x1b[2m` dim, `\x1b[0m` reset. No need to pull in a styling library unless one is already in the project.
2. **Keyboard shortcuts**, listed at the bottom: `[a] add user  [d] delete user  [t] tick clock  [q] quit`. Bold the key, dim the description, or vice-versa — whatever reads cleanly.

Behaviour:

1. **Initialise state** — a single in-memory object/struct. Render the first frame on start.
2. **Read one keystroke (or one line)** at a time, dispatch to a handler that mutates state.
3. **Re-render** the full frame after every action — don't append, replace.
4. **Loop until quit.**

The whole frame should fit on one screen.

### 5. Or show the same logic in a browser — only when the audience needs it

The terminal stays the default: it is the fastest way for whoever wrote the logic to push it through cases. Reach for a browser view when the people judging the answer would rather click than type — a product owner, support, a stakeholder demo — or when the question is about what someone sees while the state changes.

The browser view is a second **shell**, not a second implementation. It imports the same pure module the terminal drives, from the project's own runtime: a few lines of the project's web stack, or the standard library's HTTP server when there is none. Each button sends an action to the server, the server calls the module, and the page re-renders the full state — exactly what the terminal frame shows. No logic lives in the page, so there is nothing to keep in step.

Do **not** build a standalone page that re-implements the logic in JavaScript: it tests a copy, and the answer you get is about the copy. Do not add a runtime or a JavaScript rewrite the project doesn't already have just to get buttons.

A complete example, three files next to each other — the logic under question, the terminal shell, and the optional browser shell over the same module:

```python
# orders_machine.py
"""Order cancellation logic under question (pure: no I/O, no printing)."""

TRANSITIONS = {
    ("new", "pay"): "paid",
    ("new", "cancel"): "cancelled",
    ("paid", "ship"): "shipped",
    ("paid", "cancel"): "refund_pending",
    ("refund_pending", "refund"): "cancelled",
}


def initial() -> dict:
    return {"status": "new", "history": []}


def actions(state: dict) -> list[str]:
    """The actions that are legal right now."""
    return sorted(action for (status, action) in TRANSITIONS if status == state["status"])


def step(state: dict, action: str) -> dict:
    if action not in actions(state):
        raise ValueError(f"{action!r} is not legal in {state['status']!r}")
    return {"status": TRANSITIONS[(state["status"], action)], "history": state["history"] + [action]}
```

```python
# prototype_orders.py
"""PROTOTYPE - drive the order logic by hand: python3 prototype_orders.py"""
import json

import orders_machine as machine

state = machine.initial()
while True:
    print("\033[2J\033[H" + json.dumps(state, indent=2))
    print("  ".join(f"[{a}]" for a in machine.actions(state)) + "  [q] quit")
    try:
        choice = input("> ").strip()
    except EOFError:
        break
    if choice == "q":
        break
    if choice in machine.actions(state):
        state = machine.step(state, choice)
```

```python
# prototype_orders_web.py
"""PROTOTYPE - the same order logic in a browser: python3 prototype_orders_web.py [--port 8000]"""
import argparse
import html
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

import orders_machine as machine

state = machine.initial()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/state.json":
            self.reply(200, json.dumps(state), "application/json")
        elif self.path == "/":
            buttons = "".join(
                f'<button name="action" value="{html.escape(a)}">{html.escape(a)}</button>'
                for a in machine.actions(state))
            page = (f'<!doctype html><title>PROTOTYPE orders</title><h1>PROTOTYPE: order logic</h1>'
                    f'<pre id="state">{html.escape(json.dumps(state, indent=2))}</pre>'
                    f'<form method="post" action="/action">{buttons}</form>')
            self.reply(200, page, "text/html; charset=utf-8")
        else:
            self.reply(404, "not found", "text/plain")

    def do_POST(self):
        global state
        length = int(self.headers.get("Content-Length", 0))
        action = parse_qs(self.rfile.read(length).decode()).get("action", [""])[0]
        if self.path != "/action" or action not in machine.actions(state):
            self.reply(400, "not a legal action", "text/plain")
            return
        state = machine.step(state, action)  # the project's own logic decides
        self.send_response(303)
        self.send_header("Location", "/")
        self.end_headers()

    def reply(self, status, body, content_type):
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    server = ThreadingHTTPServer(("127.0.0.1", parser.parse_args().port), Handler)
    print(f"serving on http://127.0.0.1:{server.server_port}", flush=True)
    server.serve_forever()
```

In a Node project the same split holds: the module stays the project's own JavaScript or TypeScript, the terminal shell reads lines with `node:readline`, and the browser shell is a few lines of `node:http` over that same module. In any language, check the claim the browser view makes: change one transition in the module and the page must follow.

### 6. Make it runnable in one command

Whatever the project's existing task runner supports:

- Python: `uv run scripts/prototype_<name>.py`
- Node: `node scripts/prototype_<name>.mjs`

No build step. No configuration. One command, one screen.

### 7. When done

Follow the prototype skill's When done: record the answer in `NOTES.md`, capture the logic module, its shells (the terminal one and any browser view) and the notes on a throwaway branch, leave a pointer, and only then clean up the files it wholly owns. Lifting the logic module into the real codebase is a separately authorized implementation.
