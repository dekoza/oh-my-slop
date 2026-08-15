/**
 * The human rendering of a verb's report (§10.2).
 *
 * **Both renderings come from one structured value**, so a fact cannot reach
 * `--json` and miss the screen. That is why this is a walk rather than a
 * hand-written template: a section added to the value appears here the same
 * day, instead of the day somebody notices it is missing.
 *
 * Order is the value's own key order, which is the order each report builds its
 * sections in — the operator reads it top to bottom.
 */

const INDENT = "  ";

/**
 * @param {object} report the verb's structured report
 * @param {string} [prefix] the leading indent for this level
 * @returns {string[]} one line per entry
 */
export function renderReport(report, prefix = INDENT) {
	return Object.entries(report).flatMap(([key, value]) => renderEntry(key, value, prefix));
}

function renderEntry(key, value, prefix) {
	if (Array.isArray(value)) return renderList(key, value, prefix);

	if (isRecord(value)) {
		const nested = renderReport(value, prefix + INDENT);
		return nested.length === 0 ? [`${prefix}${key}: (empty)`] : [`${prefix}${key}:`, ...nested];
	}

	return [`${prefix}${key}: ${renderScalar(value)}`];
}

function renderList(key, entries, prefix) {
	if (entries.length === 0) return [`${prefix}${key}: (none)`];

	const bullet = `${prefix}${INDENT}- `;
	const lines = [`${prefix}${key}:`];

	for (const entry of entries) {
		if (!isRecord(entry)) {
			lines.push(`${bullet}${renderScalar(entry)}`);
			continue;
		}

		// The record's first field shares the bullet's line, so a list of records
		// reads as a list rather than as a wall of indentation.
		const nested = renderReport(entry, bullet.replace(/./g, " "));
		lines.push(bullet + nested[0].trimStart(), ...nested.slice(1));
	}

	return lines;
}

function renderScalar(value) {
	if (value === null || value === undefined) return "—";
	return String(value);
}

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
