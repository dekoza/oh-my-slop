import { selectRoute } from "../worker/dispatch.mjs";

/**
 * §9.4/§9.9: reserve a pooled attempt before minting its decision. A failed
 * CAS reselects, never pins the loser to a busy class. A fully memo-blocked
 * order returns unchanged to the pipeline's existing routes-exhausted row.
 * The returned slot is a capability and must never enter a route record.
 */
export async function reserveModelRoute({ capacity, ticket, now = Date.now, ...selection }) {
	for (;;) {
		capacity.assertActive();
		const route = await selectRoute({ ...selection, at: now(), capacity, exhaustion: capacity.exhaustion, pooled: true });
		capacity.assertActive();
		if (route.profile !== null) {
			// No attempt-scoped event may precede its mint (§6.4). The grant
			// names the ticket; recovery derives its worker from the journal.
			const slot = capacity.acquireModel({ ticket, resourceClass: route.class });
			if (slot !== null) return { route, slot };
		} else if (!route.considered.some((seen) => seen.state === "busy")) {
			return { route, slot: null };
		} else {
			for (const seen of route.considered.filter((entry) => entry.state === "busy")) {
				capacity.exhaustion.wait({ ticket, resourceClass: seen.class });
			}
		}
		await capacity.wait();
	}
}
