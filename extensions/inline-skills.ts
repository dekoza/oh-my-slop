/**
 * Inline Skill References
 *
 * Makes bare `/skillname` references in natural-language input resolve to
 * `/skill:skillname`, matching Claude Code behaviour.
 *
 * Usage:
 *   "I need you to /triage #123 and /prototype the alert notification mechanics."
 *
 * Place in ~/.pi/agent/extensions/ for global use, or .pi/extensions/ for
 * project-local. Then /reload to activate.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Built-in pi commands that should NOT be rewritten to /skill:
const BUILTIN_COMMANDS = new Set([
  "login",
  "logout",
  "llama",
  "model",
  "scoped-models",
  "settings",
  "resume",
  "new",
  "name",
  "session",
  "tree",
  "trust",
  "fork",
  "clone",
  "compact",
  "copy",
  "export",
  "import",
  "share",
  "reload",
  "hotkeys",
  "changelog",
  "quit",
]);

// Regex: matches /word (followed by space, punctuation, or end-of-string)
const SKILL_REF_RE = /\/(\w+)/g;

export default function (pi: ExtensionAPI) {
  pi.on("input", async (event, ctx) => {
    // Don't re-process extension-injected messages (avoids infinite loop)
    if (event.source === "extension") {
      return { action: "continue" };
    }

    const text = event.text;

    // Walk the text and rewrite bare /skillname → /skill:skillname
    // Only rewrite segments that aren't known built-in commands
    const result = text.replace(SKILL_REF_RE, (match, word) => {
      if (BUILTIN_COMMANDS.has(word)) return match;
      return `/skill:${word}`;
    });

    // If nothing changed, pass through
    if (result === text) {
      return { action: "continue" };
    }

    return { action: "transform", text: result };
  });
}
