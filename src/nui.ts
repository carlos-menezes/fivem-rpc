/// <reference types="@citizenfx/client" />
import type {
	ClientToNuiRpc,
	NuiToClientRpc,
	RpcError,
	RpcPayload,
	RpcResult,
} from "./types.ts";

type ClientToNuiHandler = (args: unknown) => Promise<unknown>;

/** Tracks initialized channel names to prevent double-initialization. */
const activeChannels = new Set<string>();

type InitializeRpcOptions = {
	/**
	 * Channel name used to scope RPC events.
	 * Must match the `channel` passed to `initializeRpc` on the client.
	 * @default "default"
	 */
	channel?: string;
	/**
	 * Milliseconds to wait for a response before resolving with ERR_TIMEOUT.
	 * @default 10000
	 */
	timeout?: number;
};

/**
 * Initializes a NUI-side RPC channel.
 *
 * - {@link callClientRpc} — calls a procedure on the client script (NuiToClientRpc).
 * - {@link onClientRpc} — registers a handler for client-initiated calls (ClientToNuiRpc).
 *
 * @example
 * const { callClientRpc, onClientRpc } = initializeRpc({ channel: "ui" });
 *
 * onClientRpc("ui:showNotification", async ({ message }) => {
 *     showToast(message);
 *     return { seen: true };
 * });
 *
 * const result = await callClientRpc("ui:getPlayerInfo");
 * if (result.success) setName(result.data.name);
 */
export const initializeRpc = ({
	channel = "default",
	timeout = 10_000,
}: InitializeRpcOptions = {}) => {
	if (activeChannels.has(channel)) {
		throw new Error(`RPC channel already initialized: "${channel}"`);
	}
	activeChannels.add(channel);

	const resourceName = GetCurrentResourceName();
	const nuiToClientEndpoint = `https://${resourceName}/__rpc_nui2c_${channel}__`;
	const clientToNuiResponseEndpoint = `https://${resourceName}/__rpc_c2nui_response_${channel}__`;

	// Handlers for client-initiated calls (ClientToNuiRpc).
	const clientToNuiHandlers = new Map<string, ClientToNuiHandler>();

	// Listen for client calls via SendNuiMessage.
	window.addEventListener("message", async (event: MessageEvent) => {
		const data = event.data as {
			type?: string;
			callId?: string;
			procedure?: string;
			args?: unknown;
		};
		if (data.type !== `__rpc_c2nui_${channel}__`) return;
		const { callId, procedure, args } = data;
		if (!callId || !procedure) return;

		const handler = clientToNuiHandlers.get(procedure);
		const result: RpcResult<unknown> = handler
			? await handler(args).then(
					(d) => ({ success: true as const, data: d }),
					(e) => ({
						success: false as const,
						error: {
							code: "ERR_HANDLER" as const,
							message: e instanceof Error ? e.message : String(e),
						} satisfies RpcError,
					}),
				)
			: {
					success: false,
					error: { code: "ERR_NO_HANDLER", procedure } satisfies RpcError,
				};

		// Send the result back to the client via a NUI callback fetch.
		await fetch(clientToNuiResponseEndpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ callId, result }),
		});
	});

	return {
		/**
		 * Calls a procedure on the client script and returns a typed Promise.
		 * Always resolves; inspect `result.success` to branch.
		 */
		callClientRpc: async <Key extends keyof NuiToClientRpc>(
			procedure: Key,
			...args: NuiToClientRpc[Key] extends RpcPayload<infer Req, infer _Res>
				? Req extends undefined
					? []
					: [Req]
				: never
		): Promise<
			RpcResult<
				NuiToClientRpc[Key] extends RpcPayload<infer _Req, infer Res>
					? Res
					: never
			>
		> => {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeout);
			try {
				const response = await fetch(nuiToClientEndpoint, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ procedure, args: args[0] ?? null }),
					signal: controller.signal,
				});
				clearTimeout(timer);
				if (!response.ok) {
					return {
						success: false,
						error: {
							code: "ERR_HANDLER",
							message: `NUI fetch failed: ${response.status}`,
						},
					};
				}
				return (await response.json()) as RpcResult<
					NuiToClientRpc[Key] extends RpcPayload<infer _Req, infer Res>
						? Res
						: never
				>;
			} catch (e) {
				clearTimeout(timer);
				if (e instanceof DOMException && e.name === "AbortError") {
					return { success: false, error: { code: "ERR_TIMEOUT", procedure } };
				}
				return {
					success: false,
					error: {
						code: "ERR_HANDLER",
						message: e instanceof Error ? e.message : String(e),
					},
				};
			}
		},

		/** Registers a handler for a client-to-NUI RPC procedure. */
		onClientRpc: <Key extends keyof ClientToNuiRpc>(
			procedure: Key,
			handler: (
				...args: ClientToNuiRpc[Key] extends RpcPayload<infer Req, infer _Res>
					? Req extends undefined
						? []
						: [Req]
					: never
			) => Promise<
				ClientToNuiRpc[Key] extends RpcPayload<infer _Req, infer Res>
					? Res
					: never
			>,
		) => {
			clientToNuiHandlers.set(
				procedure as string,
				handler as unknown as ClientToNuiHandler,
			);
		},

		/** Removes a handler for a client-to-NUI RPC procedure. */
		offClientRpc: <Key extends keyof ClientToNuiRpc>(
			procedure: Key,
			handler?: (
				...args: ClientToNuiRpc[Key] extends RpcPayload<infer Req, infer _Res>
					? Req extends undefined
						? []
						: [Req]
					: never
			) => Promise<
				ClientToNuiRpc[Key] extends RpcPayload<infer _Req, infer Res>
					? Res
					: never
			>,
		) => {
			if (
				!handler ||
				clientToNuiHandlers.get(procedure as string) ===
					(handler as unknown as ClientToNuiHandler)
			) {
				clientToNuiHandlers.delete(procedure as string);
			}
		},
	};
};
