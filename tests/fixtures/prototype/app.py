"""Acme account settings: a small server-rendered app (Python standard library only).

Run: python3 app.py --env development|production [--port 8000]
The first stdout line announces the loopback address.
"""
import argparse
import html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from settings_logic import load_settings, sections, security_warning

LAYOUT = """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>{title} · Acme</title>
<style>body{{font-family:sans-serif;margin:0}} header{{background:#223;color:#fff;padding:12px}}
main{{padding:16px}} .warning{{color:#a00}}</style></head>
<body><header>Acme · <a href="/settings" style="color:#fff">Settings</a></header>
{content}
</body></html>"""


def render_settings() -> str:
    settings = load_settings()
    parts = ["<main><h1>Settings</h1>"]
    warning = security_warning(settings)
    if warning:
        parts.append(f'<p class="warning">{html.escape(warning)}</p>')
    for title, rows in sections(settings):
        parts.append(f"<h2>{html.escape(title)}</h2><dl>")
        parts.extend(f"<dt>{html.escape(label)}</dt><dd>{html.escape(value)}</dd>" for label, value in rows)
        parts.append("</dl>")
    parts.append("</main>")
    return LAYOUT.format(title="Settings", content="".join(parts))


ROUTES = {"/settings": render_settings}


def make_handler(config: dict):
    """Build the request handler; `config` is the startup configuration every route may read."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            route = ROUTES.get(urlsplit(self.path).path)
            if route is None:
                self.send_error(404)
                return
            body = route().encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", required=True, choices=["development", "production"])
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    config = {"env": args.env}
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(config))
    print(f"serving on http://127.0.0.1:{server.server_port} ({args.env})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
