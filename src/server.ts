/// <reference types="@citizenfx/server" />
import type {
	ClientToServerRpc,
	RpcError,
	RpcPayload,
	RpcResult,
	ServerToClientRpc,
} from "./types.ts";
import { generateCallId } from "./utils.ts";

type ClientToServerHandler = (
	source: number,
	args: unknown,
) => Promise<unknown>;

type ServerToClientPending = {
	resolve: (value: RpcResult<unknown>) => void;
	timer: ReturnType<typeof globalThis.setTimeout>;
};

// Tracks active channel names to prevent double-initialization.
const activeChannels = new Set<string>();

type InitializeRpcOptions = {
	/**
	 * Channel name used to scope RPC events.
	 * Must match the `channel` passed to `initializeRpc` on the client.
	 * @default "default"
	 */
	channel?: string;
	/**
	 * Timeout for S2C RPC responses in milliseconds.
	 * @default 10000
	 */
	timeout?: number;
};

/**
 * Initializes a server-side RPC channel.
 *
 * Each channel is isolated. Calling with the same channel name twice throws.
 *
 * @example
 * const core = initializeRpc({ channel: "core" });
 * core.onClientRpc("core:ping", async (source) => ({ pong: true }));
 */
export const initializeRpc = ({
	channel = "default",
	timeout = 10_000,
}: InitializeRpcOptions = {}) => {
	if (activeChannels.has(channel)) {
		throw new Error(`RPC channel already initialized: "${channel}"`);
	}
	activeChannels.add(channel);

	const request = `__rpc_c2s_${channel}__`;
	const response = `__rpc_c2s_response_${channel}__`;

	// Handlers for this channel, keyed by procedure name.
	const clientToServerHandlers = new Map<string, ClientToServerHandler>();

	// Listens for C2S RPC requests on this channel.
	const onRpcRequest = (
		handler: (callId: string, procedure: string, args: unknown) => void,
	) => onNet(request, handler);

	// Sends an RpcResult back to the requesting client.
	const emitRpcResponse = ({
		target,
		callId,
		result,
	}: {
		target: number;
		callId: string;
		result: RpcResult<unknown>;
	}) => emitNet(response, target, callId, result);

	onRpcRequest(async (callId, procedure, args) => {
		// Capture before any await; source is a mutable global that changes between ticks.
		const playerId = source;
		const handler = clientToServerHandlers.get(procedure);
		if (!handler) {
			emitRpcResponse({
				target: playerId,
				callId,
				result: {
					success: false,
					error: { code: "ERR_NO_HANDLER", procedure } satisfies RpcError,
				},
			});
			return;
		}
		try {
			const data = await handler(playerId, args);
			emitRpcResponse({
				target: playerId,
				callId,
				result: { success: true, data },
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			emitRpcResponse({
				target: playerId,
				callId,
				result: {
					success: false,
					error: { code: "ERR_HANDLER", message } satisfies RpcError,
				},
			});
		}
	});

	// Pending server-to-client calls waiting for a client response.
	const serverToClientPending = new Map<string, ServerToClientPending>();

	onNet(
		`__rpc_s2c_response_${channel}__`,
		(callId: string, result: RpcResult<unknown>) => {
			const pending = serverToClientPending.get(callId);
			if (!pending) return;
			serverToClientPending.delete(callId);
			clearTimeout(pending.timer);
			pending.resolve(result);
		},
	);

	return {
		/**
		 * Registers a handler for a client-to-server RPC procedure.
		 *
		 * Registering the same procedure again overwrites the previous handler.
		 *
		 * @example
		 * onClientRpc("player:getData", async (source) => ({
		 *   name: GetPlayerName(String(source)),
		 * }));
		 */
		onClientRpc: <Key extends keyof ClientToServerRpc>(
			procedure: Key,
			handler: (
				source: number,
				...args: ClientToServerRpc[Key] extends RpcPayload<
					infer Req,
					infer _Res
				>
					? Req extends undefined
						? []
						: [Req]
					: never
			) => Promise<
				ClientToServerRpc[Key] extends RpcPayload<infer _Req, infer Res>
					? Res
					: never
			>,
		) => {
			clientToServerHandlers.set(
				procedure,
				handler as unknown as ClientToServerHandler,
			);
		},

		/**
		 * Removes a handler for a client-to-server RPC procedure.
		 * If `handler` is provided, only removes it if it is the currently registered handler.
		 */
		offClientRpc: <Key extends keyof ClientToServerRpc>(
			procedure: Key,
			handler?: (
				source: number,
				...args: ClientToServerRpc[Key] extends RpcPayload<
					infer Req,
					infer _Res
				>
					? Req extends undefined
						? []
						: [Req]
					: never
			) => Promise<
				ClientToServerRpc[Key] extends RpcPayload<infer _Req, infer Res>
					? Res
					: never
			>,
		) => {
			if (
				!handler ||
				clientToServerHandlers.get(procedure) ===
					(handler as unknown as ClientToServerHandler)
			) {
				clientToServerHandlers.delete(procedure);
			}
		},

		/**
		 * Calls a procedure on a specific client. Always resolves; inspect `result.success` to branch.
		 */
		callClientRpc: <Key extends keyof ServerToClientRpc>(
			playerId: number,
			procedure: Key,
			...args: ServerToClientRpc[Key] extends RpcPayload<infer Req, infer _Res>
				? Req extends undefined
					? []
					: [Req]
				: never
		): Promise<
			RpcResult<
				ServerToClientRpc[Key] extends RpcPayload<infer _Req, infer Res>
					? Res
					: never
			>
		> => {
			const callId = generateCallId({ procedure, channel });
			return new Promise((resolve) => {
				const timer = setTimeout(() => {
					serverToClientPending.delete(callId);
					resolve({
						success: false,
						error: { code: "ERR_TIMEOUT", procedure },
					});
				}, timeout);
				serverToClientPending.set(callId, {
					resolve: resolve as (v: RpcResult<unknown>) => void,
					timer,
				});
				emitNet(
					`__rpc_s2c_${channel}__`,
					playerId,
					callId,
					procedure,
					args[0] ?? null,
				);
			});
		},
	};
};
