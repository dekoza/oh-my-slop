import { readFileSync } from "node:fs";
import { hostname } from "node:os";

/**
 * §4.6's **advisory** identity blob: host, boot id, pid, process start time.
 *
 * It is for the operator's eyes — §10.5's refusal names the holding run and
 * pane out of it — and it **never constitutes ownership proof**. The holder
 * token does that. `software-factory` recorded a pid and then trusted it,
 * which is how its live store ended up holding a lock naming dead pid 3852874
 * that only a hand-rename could clear.
 *
 * @param {{ run: string | null, pane: string | null, readBootId?: () => string | null }} where
 * @returns {Readonly<object>} a plain, canonically serialisable object
 */
export function processIdentity({ run, pane, readBootId = bootId }) {
	return Object.freeze({
		host: hostname(),
		boot_id: readBootId(),
		pid: process.pid,
		// The boot id plus this pair is what makes pid reuse detectable by eye.
		process_start_time: Math.round(Date.now() - process.uptime() * 1000),
		run,
		pane,
	});
}

/** Linux's per-boot uuid, or `null` where the kernel does not publish one. */
function bootId() {
	try {
		return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
	} catch {
		return null;
	}
}
