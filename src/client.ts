/// <reference types="@citizenfx/client" />
import type {
	ClientToServerRpc,
	ServerToClientRpc,
	NuiToClientRpc,
	ClientToNuiRpc,
	RpcPayload,
	RpcResult,
	RpcError,
} from "./types.js";
import { generateCallId } from "./utils.ts";

type PendingResponse = {
	resolve: (value: RpcResult<unknown>) => void;
	timer: ReturnType<typeof globalThis.setTimeout>;
};

type ServerToClientHandler = (args: unknown) => Promise<unknown>;
type NuiToClientHandler = (args: unknown) => Promise<unknown>;

const activeChannels = new Set<string>();

type InitializeRpcOptions = {
	/**
	 * Channel name used to scope RPC events.
	 * Must match the `channel` passed to `initializeRpc` on the server.
	 * @default "default"
	 */
	channel?: string;
	/**
	 * Timeout for RPC responses in milliseconds.
	 * @default 10000
	 */
	timeout?: number;
};

/**
 * Initializes a client-side RPC channel.
 *
 * Each channel is isolated. Calling with the same channel name twice throws.
 *
 * @example
 * const { callServerRpc } = initializeRpc({ channel: "core" });
 * const result = await callServerRpc("core:ping");
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

	// Pending calls waiting for a server response, keyed by call ID.
	const pendingResponses = new Map<string, PendingResponse>();

	// Listens for server responses on this channel.
	const onRpcResponse = (
		handler: (callId: string, result: RpcResult<unknown>) => void,
	) => onNet(response, handler);

	// Emits a C2S procedure call.
	const emitRpcRequest = (callId: string, procedure: string, args: unknown) =>
		emitNet(request, callId, procedure, args);

	onRpcResponse((callId, result) => {
		const pending = pendingResponses.get(callId);
		if (!pending) return;
		pendingResponses.delete(callId);
		clearTimeout(pending.timer);
		pending.resolve(result);
	});

	// Handlers for server-initiated calls, keyed by procedure name.
	const serverToClientHandlers = new Map<string, ServerToClientHandler>();
	// Handlers for NUI-initiated calls, keyed by procedure name.
	const nuiToClientHandlers = new Map<string, NuiToClientHandler>();
	// Pending client-to-NUI calls waiting for the NUI to respond via fetch.
	const clientToNuiPending = new Map<string, PendingResponse>();

	// NUI to Client: register callback type + event handler.
	RegisterNuiCallbackType(`__rpc_nui2c_${channel}__`);
	on(
		`__cfx_nui:__rpc_nui2c_${channel}__`,
		async (
			data: { procedure: string; args: unknown },
			cb: (result: unknown) => void,
		) => {
			const handler = nuiToClientHandlers.get(data.procedure);
			if (!handler) {
				cb({
					success: false,
					error: {
						code: "ERR_NO_HANDLER",
						procedure: data.procedure,
					} satisfies RpcError,
				});
				return;
			}
			try {
				cb({ success: true, data: await handler(data.args) });
			} catch (e) {
				cb({
					success: false,
					error: {
						code: "ERR_HANDLER",
						message: e instanceof Error ? e.message : String(e),
					} satisfies RpcError,
				});
			}
		},
	);

	// Client to NUI response: register callback type + event handler.
	RegisterNuiCallbackType(`__rpc_c2nui_response_${channel}__`);
	on(
		`__cfx_nui:__rpc_c2nui_response_${channel}__`,
		(
			data: { callId: string; result: RpcResult<unknown> },
			cb: (result: unknown) => void,
		) => {
			const pending = clientToNuiPending.get(data.callId);
			if (pending) {
				clientToNuiPending.delete(data.callId);
				clearTimeout(pending.timer);
				pending.resolve(data.result);
			}
			cb({});
		},
	);

	onNet(
		`__rpc_s2c_${channel}__`,
		async (callId: string, procedure: string, args: unknown) => {
			const handler = serverToClientHandlers.get(procedure);
			if (!handler) {
				emitNet(`__rpc_s2c_response_${channel}__`, callId, {
					success: false,
					error: { code: "ERR_NO_HANDLER", procedure } satisfies RpcError,
				});
				return;
			}
			try {
				const data = await handler(args);
				emitNet(`__rpc_s2c_response_${channel}__`, callId, {
					success: true,
					data,
				});
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				emitNet(`__rpc_s2c_response_${channel}__`, callId, {
					success: false,
					error: { code: "ERR_HANDLER", message } satisfies RpcError,
				});
			}
		},
	);

	return {
		/**
		 * Calls a server-side RPC procedure. Always resolves; inspect `result.success` to branch.
		 *
		 * @example
		 * const result = await callServerRpc("player:getData");
		 * if (result.success) console.log(result.data.name);
		 * else console.error(result.error.message);
		 */
		callServerRpc: <Key extends keyof ClientToServerRpc>(
			procedure: Key,
			...args: ClientToServerRpc[Key] extends RpcPayload<infer Req, infer _Res>
				? Req extends undefined
					? []
					: [Req]
				: never
		): Promise<
			RpcResult<
				ClientToServerRpc[Key] extends RpcPayload<infer _Req, infer Res>
					? Res
					: never
			>
		> => {
			const callId = generateCallId({ procedure, channel });
			return new Promise((resolve) => {
				const timer = setTimeout(() => {
					pendingResponses.delete(callId);
					resolve({
						success: false,
						error: { code: "ERR_TIMEOUT", procedure },
					});
				}, timeout);
				pendingResponses.set(callId, {
					resolve: resolve as (v: RpcResult<unknown>) => void,
					timer,
				});
				emitRpcRequest(callId, procedure, args[0] ?? null);
			});
		},

		/** Registers a handler for a server-to-client RPC procedure. */
		onServerRpc: <Key extends keyof ServerToClientRpc>(
			procedure: Key,
			handler: (
				...args: ServerToClientRpc[Key] extends RpcPayload<
					infer Req,
					infer _Res
				>
					? Req extends undefined
						? []
						: [Req]
					: never
			) => Promise<
				ServerToClientRpc[Key] extends RpcPayload<infer _Req, infer Res>
					? Res
					: never
			>,
		) => {
			serverToClientHandlers.set(
				procedure,
				handler as unknown as ServerToClientHandler,
			);
		},

		/** Removes a handler for a server-to-client RPC procedure. */
		offServerRpc: <Key extends keyof ServerToClientRpc>(
			procedure: Key,
			handler?: (
				...args: ServerToClientRpc[Key] extends RpcPayload<
					infer Req,
					infer _Res
				>
					? Req extends undefined
						? []
						: [Req]
					: never
			) => Promise<
				ServerToClientRpc[Key] extends RpcPayload<infer _Req, infer Res>
					? Res
					: never
			>,
		) => {
			if (
				!handler ||
				serverToClientHandlers.get(procedure) ===
					(handler as unknown as ServerToClientHandler)
			) {
				serverToClientHandlers.delete(procedure);
			}
		},

		/**
		 * Calls a NUI procedure and returns a typed Promise.
		 * The NUI must have a corresponding `onClientRpc` handler registered.
		 * Always resolves; inspect `result.success` to branch.
		 */
		callNuiRpc: <Key extends keyof ClientToNuiRpc>(
			procedure: Key,
			...args: ClientToNuiRpc[Key] extends RpcPayload<infer Req, infer _Res>
				? Req extends undefined
					? []
					: [Req]
				: never
		): Promise<
			RpcResult<
				ClientToNuiRpc[Key] extends RpcPayload<infer _Req, infer Res>
					? Res
					: never
			>
		> => {
			const callId = generateCallId({ procedure, channel });
			return new Promise((resolve) => {
				const timer = setTimeout(() => {
					clientToNuiPending.delete(callId);
					resolve({
						success: false,
						error: { code: "ERR_TIMEOUT", procedure },
					});
				}, timeout);
				clientToNuiPending.set(callId, {
					resolve: resolve as (v: RpcResult<unknown>) => void,
					timer,
				});
				SendNuiMessage(
					JSON.stringify({
						type: `__rpc_c2nui_${channel}__`,
						callId,
						procedure,
						args: args[0] ?? null,
					}),
				);
			});
		},

		/** Registers a handler for a NUI-to-client RPC procedure. */
		onNuiRpc: <Key extends keyof NuiToClientRpc>(
			procedure: Key,
			handler: (
				...args: NuiToClientRpc[Key] extends RpcPayload<infer Req, infer _Res>
					? Req extends undefined
						? []
						: [Req]
					: never
			) => Promise<
				NuiToClientRpc[Key] extends RpcPayload<infer _Req, infer Res>
					? Res
					: never
			>,
		) => {
			nuiToClientHandlers.set(
				procedure as string,
				handler as unknown as NuiToClientHandler,
			);
		},

		/** Removes a handler for a NUI-to-client RPC procedure. */
		offNuiRpc: <Key extends keyof NuiToClientRpc>(
			procedure: Key,
			handler?: (
				...args: NuiToClientRpc[Key] extends RpcPayload<infer Req, infer _Res>
					? Req extends undefined
						? []
						: [Req]
					: never
			) => Promise<
				NuiToClientRpc[Key] extends RpcPayload<infer _Req, infer Res>
					? Res
					: never
			>,
		) => {
			if (
				!handler ||
				nuiToClientHandlers.get(procedure as string) ===
					(handler as unknown as NuiToClientHandler)
			) {
				nuiToClientHandlers.delete(procedure as string);
			}
		},
	};
};
