import { beforeEach } from "vitest";

export const MOCK_PLAYER_ID = 1;

const handlers = new Map<string, ((...args: unknown[]) => void)[]>();

(globalThis as Record<string, unknown>).onNet = (
	event: string,
	handler: (...args: unknown[]) => void,
) => {
	const existing = handlers.get(event) ?? [];
	handlers.set(event, [...existing, handler]);
};

/**
 * FiveM `emitNet` mock. Dispatches a net event.
 *
 * Server to client events (strip the leading target player ID arg):
 * - `__rpc_c2s_response_*`: server responding to a client-to-server call
 * - `__rpc_s2c_*` (excluding `__rpc_s2c_response_*`): server initiating a server-to-client call
 *
 * Client to server events (set `source` before dispatching):
 * - everything else, including `__rpc_c2s_*` and `__rpc_s2c_response_*`
 */
(globalThis as Record<string, unknown>).emitNet = (
	event: string,
	...args: unknown[]
) => {
	const targets = handlers.get(event) ?? [];
	const isServerToClient =
		event.startsWith("__rpc_c2s_response_") ||
		(event.startsWith("__rpc_s2c_") &&
			!event.startsWith("__rpc_s2c_response_"));
	if (isServerToClient) {
		// Server to client: strip the leading target player ID argument.
		const [, ...payload] = args;
		for (const h of targets) h(...payload);
	} else {
		// Client to server: set source before dispatching.
		(globalThis as Record<string, unknown>).source = MOCK_PLAYER_ID;
		for (const h of targets) h(...args);
	}
};

/** Reset the handler registry between tests to prevent cross-test bleed. */
beforeEach(() => {
	handlers.clear();
	nuiHandlers.clear();
});

/** Handlers registered via `RegisterNuiCallbackType` + `on('__cfx_nui:...')`. */
const nuiHandlers = new Map<
	string,
	(data: unknown, cb: (result: unknown) => void) => void
>();

/**
 * `RegisterNuiCallbackType(name)`: no-op; actual setup happens via `on`.
 * Exposed so tests can call it without errors.
 */
(globalThis as Record<string, unknown>).RegisterNuiCallbackType = (
	_name: string,
) => {
	// no-op — FiveM runtime would register the callback endpoint here
};

/**
 * `on(event, handler)`: general event bus, used here for `__cfx_nui:*`.
 * For other events falls through to the onNet/emitNet handler map.
 */
const existingOnNet = (globalThis as Record<string, unknown>).onNet as
	| ((event: string, handler: (...args: unknown[]) => void) => void)
	| undefined;

(globalThis as Record<string, unknown>).on = (
	event: string,
	handler: (...args: unknown[]) => void,
) => {
	if (event.startsWith("__cfx_nui:")) {
		nuiHandlers.set(
			event,
			handler as (data: unknown, cb: (result: unknown) => void) => void,
		);
	} else if (existingOnNet) {
		existingOnNet(event, handler);
	}
};

/**
 * `SendNuiMessage(json)`: simulates sending a message from the client script to
 * the NUI browser via `window.postMessage`.
 */
(globalThis as Record<string, unknown>).SendNuiMessage = (json: string) => {
	const data = JSON.parse(json) as unknown;
	// Dispatch via window.postMessage so nui.ts's `window.addEventListener('message')` picks it up.
	window.dispatchEvent(new MessageEvent("message", { data }));
};

/**
 * Simulates the NUI browser calling a client-side NUI callback registered
 * with `RegisterNuiCallbackType` + `on('__cfx_nui:...')`.
 *
 * Call this from tests to drive a NUI to Client round-trip.
 *
 * @returns the value passed back to the NUI by `cb(result)`
 */
export const dispatchNuiCallback = async (
	callbackType: string,
	data: unknown,
): Promise<unknown> => {
	return new Promise((resolve) => {
		const handler = nuiHandlers.get(`__cfx_nui:${callbackType}`);
		if (!handler) {
			resolve({
				success: false,
				error: { code: "ERR_NO_HANDLER", procedure: callbackType },
			});
			return;
		}
		handler(data, resolve);
	});
};
