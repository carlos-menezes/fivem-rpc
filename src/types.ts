/**
 * Registry of client-to-server RPC procedures.
 *
 * @example
 * declare module "fivem-rpc/types" {
 *   interface ClientToServerRpc {
 *     "player:getData": RpcPayload<undefined, { name: string }>;
 *   }
 * }
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by module declarations
export interface ClientToServerRpc {}

/**
 * Registry of server-to-client RPC procedures.
 *
 * @example
 * declare module "fivem-rpc/types" {
 *   interface ServerToClientRpc {
 *     "player:showNotification": RpcPayload<{ message: string }, { seen: boolean }>;
 *   }
 * }
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by module declarations
export interface ServerToClientRpc {}

/**
 * Registry of NUI-to-client RPC procedures (NUI calls client script).
 *
 * @example
 * declare module "fivem-rpc/types" {
 *   interface NuiToClientRpc {
 *     "ui:getPlayerInfo": RpcPayload<undefined, { name: string }>;
 *   }
 * }
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by module declarations
export interface NuiToClientRpc {}

/**
 * Registry of client-to-NUI RPC procedures (client script calls NUI).
 *
 * @example
 * declare module "fivem-rpc/types" {
 *   interface ClientToNuiRpc {
 *     "ui:showNotification": RpcPayload<{ message: string }, { seen: boolean }>;
 *   }
 * }
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by module declarations
export interface ClientToNuiRpc {}

/**
 * Describes the request and response types for a single RPC procedure.
 *
 * @example
 * "player:setJob": RpcPayload<{ job: string }, { ok: boolean }>
 * "player:ping":   RpcPayload<undefined, undefined>
 */
export type RpcPayload<
	Request extends Record<string, unknown> | undefined = undefined,
	Response extends Record<string, unknown> | undefined = undefined,
> = { request: Request; response: Response };

/**
 * Returned by all RPC call functions. Narrow on `success` before accessing `data` or `error`.
 *
 * @example
 * const result = await callServerRpc("player:getData");
 * if (result.success) console.log(result.data.name);
 * else if (result.error.code === "ERR_TIMEOUT") console.warn("timed out");
 */
export type RpcResult<T> =
	| { success: true; data: T; error?: never }
	| { success: false; data?: never; error: RpcError };

/**
 * Discriminated error union returned in `RpcResult` on failure.
 *
 * - `ERR_NO_HANDLER`: no handler registered for the procedure
 * - `ERR_TIMEOUT`: response not received within the timeout
 * - `ERR_HANDLER`: handler threw at runtime
 */
export type RpcError =
	| { code: "ERR_NO_HANDLER"; procedure: string }
	| { code: "ERR_TIMEOUT"; procedure: string }
	| { code: "ERR_HANDLER"; message: string };
