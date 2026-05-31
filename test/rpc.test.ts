import { describe, expect, it } from "vitest";
import { initializeRpc as initializeClientRpc } from "../src/client.ts";
import { initializeRpc as initializeServerRpc } from "../src/server.ts";
import type { RpcPayload } from "../src/types.ts";
import { dispatchNuiCallback } from "./setup.ts";

declare module "../src/types.ts" {
	interface ClientToServerRpc {
		"test:echo": RpcPayload<{ message: string }, { message: string }>;
		"test:noArgs": RpcPayload<undefined, { ok: boolean }>;
		"test:throws": RpcPayload<undefined, { ok: boolean }>;
	}
	interface ServerToClientRpc {
		"test:notify": RpcPayload<{ text: string }, { seen: boolean }>;
		"test:ping": RpcPayload<undefined, { pong: boolean }>;
	}
	interface NuiToClientRpc {
		"ui:getCounter": RpcPayload<undefined, { count: number }>;
		"ui:throws": RpcPayload<undefined, { ok: boolean }>;
	}
	interface ClientToNuiRpc {
		"ui:setColor": RpcPayload<{ color: string }, { applied: boolean }>;
		"ui:ping": RpcPayload<undefined, { pong: boolean }>;
	}
}

// Each test uses a unique channel name to avoid the module-level activeChannels
// dedup guard, since that Set persists for the lifetime of the module.
function* getUniqueChannel(): Generator<string, never, unknown> {
	let counter = 0;
	while (true) {
		yield `test-channel-${counter++}`;
	}
}

const channelGenerator = getUniqueChannel();

describe("RPC round-trip", () => {
	it("resolves with handler return value", async () => {
		const channel = channelGenerator.next().value;
		const { onClientRpc } = initializeServerRpc({ channel });
		const { callServerRpc } = initializeClientRpc({ channel });

		onClientRpc("test:echo", async (_source, args) => ({
			message: args.message,
		}));

		const result = await callServerRpc("test:echo", { message: "hello" });

		expect(result).toEqual({ success: true, data: { message: "hello" } });
	});

	it("passes the correct source player ID to the handler", async () => {
		const channel = channelGenerator.next().value;
		const { onClientRpc } = initializeServerRpc({ channel });
		const { callServerRpc } = initializeClientRpc({ channel });

		let capturedSource: number | undefined;
		onClientRpc("test:noArgs", async (source) => {
			capturedSource = source;
			return { ok: true };
		});

		await callServerRpc("test:noArgs");

		expect(capturedSource).toBe(1); // MOCK_PLAYER_ID
	});

	it("resolves success: false when the handler throws", async () => {
		const channel = channelGenerator.next().value;
		const { onClientRpc } = initializeServerRpc({ channel });
		const { callServerRpc } = initializeClientRpc({ channel });

		onClientRpc("test:throws", async () => {
			throw new Error("something went wrong");
		});

		const result = await callServerRpc("test:throws");

		expect(result).toEqual({
			success: false,
			error: { code: "ERR_HANDLER", message: "something went wrong" },
		});
	});

	it("resolves success: false when no handler is registered", async () => {
		const channel = channelGenerator.next().value;
		initializeServerRpc({ channel });
		const { callServerRpc } = initializeClientRpc({ channel });

		const result = await callServerRpc("test:noArgs");

		expect(result).toEqual({
			success: false,
			error: { code: "ERR_NO_HANDLER", procedure: "test:noArgs" },
		});
	});

	it("resolves success: false on timeout", async () => {
		const channel = channelGenerator.next().value;
		// No server initialized, so no handler will ever respond.
		const { callServerRpc } = initializeClientRpc({ channel, timeout: 50 });

		const result = await callServerRpc("test:noArgs");

		expect(result).toEqual({
			success: false,
			error: { code: "ERR_TIMEOUT", procedure: "test:noArgs" },
		});
	});
});

describe("Server to client RPC round-trip", () => {
	it("resolves with handler return value", async () => {
		const channel = channelGenerator.next().value;
		const { callClientRpc } = initializeServerRpc({ channel });
		const { onServerRpc } = initializeClientRpc({ channel });

		onServerRpc("test:notify", async ({ text }) => ({ seen: text.length > 0 }));

		const result = await callClientRpc(1, "test:notify", { text: "hello" });

		expect(result).toEqual({ success: true, data: { seen: true } });
	});

	it("resolves success: false when the handler throws", async () => {
		const channel = channelGenerator.next().value;
		const { callClientRpc } = initializeServerRpc({ channel });
		const { onServerRpc } = initializeClientRpc({ channel });

		onServerRpc("test:ping", async () => {
			throw new Error("client error");
		});

		const result = await callClientRpc(1, "test:ping");

		expect(result).toEqual({
			success: false,
			error: { code: "ERR_HANDLER", message: "client error" },
		});
	});

	it("resolves success: false on timeout", async () => {
		const channel = channelGenerator.next().value;
		// No client initialized, so no handler will ever respond.
		const { callClientRpc } = initializeServerRpc({ channel, timeout: 50 });

		const result = await callClientRpc(1, "test:ping");

		expect(result).toEqual({
			success: false,
			error: { code: "ERR_TIMEOUT", procedure: "test:ping" },
		});
	});
});

describe("NUI to client RPC (onNuiRpc / dispatchNuiCallback)", () => {
	it("resolves with handler return value", async () => {
		const channel = channelGenerator.next().value;
		const { onNuiRpc } = initializeClientRpc({ channel });

		onNuiRpc("ui:getCounter", async () => ({ count: 42 }));

		const result = await dispatchNuiCallback(`__rpc_nui2c_${channel}__`, {
			procedure: "ui:getCounter",
			args: null,
		});

		expect(result).toEqual({ success: true, data: { count: 42 } });
	});

	it("resolves success: false when the handler throws", async () => {
		const channel = channelGenerator.next().value;
		const { onNuiRpc } = initializeClientRpc({ channel });

		onNuiRpc("ui:throws", async () => {
			throw new Error("nui handler error");
		});

		const result = await dispatchNuiCallback(`__rpc_nui2c_${channel}__`, {
			procedure: "ui:throws",
			args: null,
		});

		expect(result).toEqual({
			success: false,
			error: { code: "ERR_HANDLER", message: "nui handler error" },
		});
	});

	it("resolves success: false when no handler is registered", async () => {
		const channel = channelGenerator.next().value;
		initializeClientRpc({ channel });

		const result = await dispatchNuiCallback(`__rpc_nui2c_${channel}__`, {
			procedure: "ui:getCounter",
			args: null,
		});

		expect(result).toEqual({
			success: false,
			error: { code: "ERR_NO_HANDLER", procedure: "ui:getCounter" },
		});
	});
});

describe("Client to NUI RPC (callNuiRpc / window.message)", () => {
	it("resolves with handler return value", async () => {
		const channel = channelGenerator.next().value;
		const { callNuiRpc } = initializeClientRpc({ channel });

		// Simulate the NUI side: listen for the SendNuiMessage dispatch, handle it,
		// then call back via the __rpc_c2nui_response__ NUI callback.
		window.addEventListener("message", async (event: MessageEvent) => {
			const data = event.data as {
				type?: string;
				callId?: string;
				procedure?: string;
				args?: unknown;
			};
			if (data.type !== `__rpc_c2nui_${channel}__`) return;
			const result = { success: true as const, data: { applied: true } };
			await dispatchNuiCallback(`__rpc_c2nui_response_${channel}__`, {
				callId: data.callId,
				result,
			});
		});

		const result = await callNuiRpc("ui:setColor", { color: "red" });

		expect(result).toEqual({ success: true, data: { applied: true } });
	});

	it("resolves success: false on timeout", async () => {
		const channel = channelGenerator.next().value;
		// No NUI listener, so no response ever comes.
		const { callNuiRpc } = initializeClientRpc({ channel, timeout: 50 });

		const result = await callNuiRpc("ui:ping");

		expect(result).toEqual({
			success: false,
			error: { code: "ERR_TIMEOUT", procedure: "ui:ping" },
		});
	});
});

describe("offClientRpc (server)", () => {
	it("offClientRpc(procedure) removes the handler", async () => {
		const channel = channelGenerator.next().value;
		const { onClientRpc, offClientRpc } = initializeServerRpc({ channel });
		const { callServerRpc } = initializeClientRpc({ channel });

		onClientRpc("test:echo", async (_source, args) => ({
			message: args.message,
		}));
		offClientRpc("test:echo");

		const result = await callServerRpc("test:echo", { message: "hi" });
		expect(result).toEqual({
			success: false,
			error: { code: "ERR_NO_HANDLER", procedure: "test:echo" },
		});
	});

	it("offClientRpc(procedure, handler) removes only when handler matches", async () => {
		const channel = channelGenerator.next().value;
		const { onClientRpc, offClientRpc } = initializeServerRpc({ channel });
		const { callServerRpc } = initializeClientRpc({ channel });

		const handlerA = async (_source: number) => ({ ok: true });
		const handlerB = async (_source: number) => ({ ok: true });

		onClientRpc("test:noArgs", handlerA);
		offClientRpc("test:noArgs", handlerB); // wrong handler, so should NOT remove

		const result = await callServerRpc("test:noArgs");
		expect(result).toEqual({ success: true, data: { ok: true } });
	});

	it("offClientRpc(procedure, handler) removes when handler matches", async () => {
		const channel = channelGenerator.next().value;
		const { onClientRpc, offClientRpc } = initializeServerRpc({ channel });
		const { callServerRpc } = initializeClientRpc({ channel });

		const handler = async (_source: number) => ({ ok: true });
		onClientRpc("test:noArgs", handler);
		offClientRpc("test:noArgs", handler);

		const result = await callServerRpc("test:noArgs");
		expect(result).toEqual({
			success: false,
			error: { code: "ERR_NO_HANDLER", procedure: "test:noArgs" },
		});
	});
});

describe("offServerRpc (client)", () => {
	it("offServerRpc(procedure) removes the handler", async () => {
		const channel = channelGenerator.next().value;
		const { callClientRpc } = initializeServerRpc({ channel });
		const { onServerRpc, offServerRpc } = initializeClientRpc({ channel });

		onServerRpc("test:ping", async () => ({ pong: true }));
		offServerRpc("test:ping");

		const result = await callClientRpc(1, "test:ping");
		expect(result).toEqual({
			success: false,
			error: { code: "ERR_NO_HANDLER", procedure: "test:ping" },
		});
	});

	it("offServerRpc(procedure, handler) only removes when handler matches", async () => {
		const channel = channelGenerator.next().value;
		const { callClientRpc } = initializeServerRpc({ channel });
		const { onServerRpc, offServerRpc } = initializeClientRpc({ channel });

		const handler = async () => ({ pong: true });
		onServerRpc("test:ping", handler);
		offServerRpc("test:ping", async () => ({ pong: false })); // different ref, so no removal

		const result = await callClientRpc(1, "test:ping");
		expect(result).toEqual({ success: true, data: { pong: true } });
	});
});

describe("offNuiRpc (client)", () => {
	it("offNuiRpc(procedure) removes the handler", async () => {
		const channel = channelGenerator.next().value;
		const { onNuiRpc, offNuiRpc } = initializeClientRpc({ channel });

		onNuiRpc("ui:getCounter", async () => ({ count: 1 }));
		offNuiRpc("ui:getCounter");

		const result = await dispatchNuiCallback(`__rpc_nui2c_${channel}__`, {
			procedure: "ui:getCounter",
			args: null,
		});
		expect(result).toEqual({
			success: false,
			error: { code: "ERR_NO_HANDLER", procedure: "ui:getCounter" },
		});
	});

	it("offNuiRpc(procedure, handler) only removes when handler matches", async () => {
		const channel = channelGenerator.next().value;
		const { onNuiRpc, offNuiRpc } = initializeClientRpc({ channel });

		const handler = async () => ({ count: 7 });
		onNuiRpc("ui:getCounter", handler);
		offNuiRpc("ui:getCounter", async () => ({ count: 0 })); // different ref, so no removal

		const result = await dispatchNuiCallback(`__rpc_nui2c_${channel}__`, {
			procedure: "ui:getCounter",
			args: null,
		});
		expect(result).toEqual({ success: true, data: { count: 7 } });
	});
});
