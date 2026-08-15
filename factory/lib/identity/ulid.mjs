import { randomBytes } from "node:crypto";

/**
 * ULIDs, because §2.1 wants identities that are orderable by the time they were
 * minted. The legacy `factory-YYYYMMDD-<6hex>` was date-only, so two runs on one
 * day had no order at all — and a run id is what the monitor sorts its index by.
 *
 * 48 bits of millisecond timestamp then 80 bits of randomness, Crockford
 * base32, upper case: 26 characters inside §2.1's `[0-9A-Za-z-]` charset.
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;
const RANDOM_CEILING = 1n << 80n;

let lastMilliseconds = -1;
let lastRandom = 0n;

/**
 * @param {number} [milliseconds] the mint time, for tests that pin it
 * @returns {string} a 26-character ULID
 */
export function newUlid(milliseconds = Date.now()) {
	// Within one millisecond the timestamp half cannot order two ids, so the
	// random half is incremented instead of redrawn: two runs started in the same
	// millisecond still sort in the order they were minted.
	if (milliseconds === lastMilliseconds) {
		lastRandom = (lastRandom + 1n) % RANDOM_CEILING;
	} else {
		lastMilliseconds = milliseconds;
		lastRandom = BigInt(`0x${randomBytes(10).toString("hex")}`);
	}

	return encode(BigInt(milliseconds), TIME_CHARS) + encode(lastRandom, RANDOM_CHARS);
}

/** @param {string} value @returns {boolean} */
export function isUlid(value) {
	return typeof value === "string" && value.length === 26 && [...value].every((c) => CROCKFORD.includes(c));
}

function encode(value, width) {
	let out = "";
	let rest = value;
	for (let index = 0; index < width; index += 1) {
		out = CROCKFORD[Number(rest % 32n)] + out;
		rest /= 32n;
	}
	return out;
}
