/**
 * Workflow Watchdog — Pure detection logic.
 * No pi runtime dependency; testable with plain node --test.
 */

// ── Message normalization ────────────────────────────────────────────────

/**
 * Normalize message text for similarity comparison.
 * Collapses all whitespace, lowercases, and truncates to maxLen.
 */
export function normalizeMessage(text, maxLen = 500) {
	return text.replace(/\s+/g, " ").trim().toLowerCase().slice(0, maxLen);
}

/**
 * Extract text content from an assistant message content array.
 */
export function extractAssistantText(content) {
	if (!content || !Array.isArray(content)) return "";
	return content
		.filter((block) => block && typeof block === "object" && block.type === "text")
		.map((block) => block.text)
		.join(" ");
}

// ── Loop detection ───────────────────────────────────────────────────────

/**
 * Check if the same message (or sequence) repeats in the recent window.
 *
 * @param {object} config - { windowSize, minRepetitions, sequenceLength }
 * @param {string[]} messages - normalized message texts, most recent last
 * @returns {{ detected: boolean, repeatCount: number }}
 */
export function detectLoop(config, messages) {
	if (messages.length < config.minRepetitions) {
		return { detected: false, repeatCount: 0 };
	}

	const recent = messages.slice(-config.windowSize);
	const last = recent[recent.length - 1];
	if (!last || last.length < 10) {
		return { detected: false, repeatCount: 0 };
	}

	// Single-message repeats
	const singleCount = countMatchesFromEnd(recent, last);
	if (singleCount >= config.minRepetitions) {
		return { detected: true, repeatCount: singleCount };
	}

	// Sequence repeats (e.g., A→B→A→B pattern)
	if (config.sequenceLength >= 2 && recent.length >= config.sequenceLength * config.minRepetitions) {
		const seqLen = config.sequenceLength;
		const lastSeq = recent.slice(-seqLen);
		const seqCount = countSequenceFromEnd(recent, lastSeq, seqLen);

		if (seqCount >= config.minRepetitions) {
			return { detected: true, repeatCount: seqCount };
		}
	}

	return { detected: false, repeatCount: 0 };
}

/**
 * Count how many times `target` appears consecutively scanning backwards from the end.
 */
function countMatchesFromEnd(recent, target) {
	let count = 0;
	for (let i = recent.length - 1; i >= 0; i--) {
		if (recent[i] === target) {
			count++;
		} else {
			break;
		}
	}
	return count;
}

/**
 * Count how many times `targetSeq` repeats consecutively scanning backwards from the end
 * of `recent`, stepping by `seqLen` each time.
 */
function countSequenceFromEnd(recent, targetSeq, seqLen) {
	let count = 0;
	for (let i = recent.length - seqLen; i >= 0; i -= seqLen) {
		let match = true;
		for (let j = 0; j < seqLen; j++) {
			if (recent[i + j] !== targetSeq[j]) {
				match = false;
				break;
			}
		}
		if (match) {
			count++;
		} else {
			break;
		}
	}
	return count;
}

// ── Mistake detection ────────────────────────────────────────────────────

/**
 * Check if any tool results in the batch contain errors.
 */
export function checkToolErrors(toolResults) {
	if (!toolResults || !Array.isArray(toolResults)) return false;
	return toolResults.some((r) => r?.isError === true);
}

// ── Intervention helpers ─────────────────────────────────────────────────

/**
 * Build the intervention message sent to the model when a loop is detected.
 */
export function buildLoopIntervention(repeatCount) {
	return [
		"[WORKFLOW WATCHDOG — Loop Detected]",
		"",
		`You have repeated the same pattern ${repeatCount} times. You are going in circles.`,
		"",
		"STOP. Before taking any more actions:",
		"1. Read the last few turns carefully to understand what's going wrong.",
		"2. Identify the root cause — is it a misunderstanding, a tool error, or a bad approach?",
		"3. Try a DIFFERENT strategy. If approach A failed repeatedly, do not try approach A again.",
		"4. If you're unsure what's wrong, ask the user for clarification.",
		"",
		"Do NOT repeat the same action. Take a step back and re-assess.",
	].join("\n");
}

/**
 * Build the intervention message sent to the model after repeated errors.
 */
export function buildMistakeIntervention(consecutiveErrorTurns) {
	return [
		"[WORKFLOW WATCHDOG — Repeated Mistakes]",
		"",
		`You have had tool errors in ${consecutiveErrorTurns} consecutive turns.`,
		"",
		"Before continuing:",
		"1. Re-read the error messages — what do they actually say?",
		"2. Check that tool arguments are correct (paths exist, commands are valid).",
		"3. Verify assumptions — is the file in the location you think it is? Does the API accept those parameters?",
		"4. Try a simpler, incremental approach instead of one big change.",
		"5. If stuck, explain the situation to the user and ask for guidance.",
	].join("\n");
}

/**
 * Build a text summary of recent context for the supervisor model.
 */
export function buildRecentContext(messages, consecutiveErrorTurns, totalTurns) {
	const lines = [];
	lines.push(`Total turns in session: ${totalTurns}`);
	lines.push(`Consecutive error turns: ${consecutiveErrorTurns}`);
	lines.push("");
	lines.push("Recent assistant messages:");
	const start = Math.max(0, messages.length - 8);
	for (let i = start; i < messages.length; i++) {
		const label = i === messages.length - 1 ? "LATEST" : `turn -${messages.length - 1 - i}`;
		lines.push(`  [${label}] ${messages[i].slice(0, 300)}`);
	}
	return lines.join("\n");
}