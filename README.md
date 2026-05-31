# fivem-rpc

Typed RPC for FiveM. Replaces raw `emitNet`/`onNet` calls with typed, Promise-based procedures between server, client and NUI.

## Installation

```sh
pnpm add fivem-rpc
```

## Setup

Declare your procedures once by augmenting the registry interfaces from `fivem-rpc/types`. Both sides import the same declarations.

```ts
import type { RpcPayload } from "fivem-rpc/types";

declare module "fivem-rpc/types" {
  interface ClientToServerRpc {
    "foo:getData": RpcPayload<{ id: number }, { name: string }>;
    "foo:ping":    RpcPayload<undefined, undefined>;
  }

  interface ServerToClientRpc {
    "bar:notify": RpcPayload<{ message: string }, { seen: boolean }>;
  }

  interface NuiToClientRpc {
    "ui:getInfo": RpcPayload<undefined, { name: string }>;
  }

  interface ClientToNuiRpc {
    "ui:show": RpcPayload<{ text: string }, { ok: boolean }>;
  }
}
```

`RpcPayload<Request, Response>` describes the argument and return value of a procedure. Use `undefined` for no argument or no return value.

## Client to Server

On the server, register a handler:

```ts
import { initializeRpc } from "fivem-rpc/server";

const { onClientRpc } = initializeRpc();

onClientRpc("foo:getData", async (source, { id }) => {
  return { name: "bar" };
});
```

On the client, call the procedure:

```ts
import { initializeRpc } from "fivem-rpc/client";

const { callServerRpc } = initializeRpc();

const result = await callServerRpc("foo:getData", { id: 1 });
if (result.success) {
  console.log(result.data.name);
}
```

## Server to Client

On the client, register a handler:

```ts
const { onServerRpc } = initializeRpc();

onServerRpc("bar:notify", async ({ message }) => {
  console.log(message);
  return { seen: true };
});
```

On the server, call the procedure:

```ts
const { callClientRpc } = initializeRpc();

const result = await callClientRpc(playerId, "bar:notify", { message: "hello" });
if (result.success) {
  console.log(result.data.seen);
}
```

## NUI ↔ Client

### NUI to Client

On the client, register a handler:

```ts
// client script
const { onNuiRpc } = initializeRpc();

onNuiRpc("ui:getInfo", async () => {
  return { name: GetPlayerName("-1") };
});
```

In NUI, call the procedure:

```ts
// browser (fivem-rpc/nui)
import { initializeRpc } from "fivem-rpc/nui";

const { callClientRpc } = initializeRpc();

const result = await callClientRpc("ui:getInfo");
if (result.success) {
  document.title = result.data.name;
}
```

### Client to NUI

In NUI, register a handler:

```ts
// browser (fivem-rpc/nui)
const { onClientRpc } = initializeRpc();

onClientRpc("ui:show", async ({ text }) => {
  showNotification(text);
  return { ok: true };
});
```

On the client, call the procedure:

```ts
// client script
const { callNuiRpc } = initializeRpc();

const result = await callNuiRpc("ui:show", { text: "hello" });
if (result.success) {
  console.log(result.data.ok);
}
```

## Removing handlers

All `onXxxRpc` functions have a corresponding `offXxxRpc`. Call it with just the procedure name to unconditionally remove the handler, or pass the original handler reference to only remove it if it is still the currently registered one.

```ts
const handler = async () => ({ name: "bar" });

onClientRpc("foo:getData", handler);

// Remove unconditionally:
offClientRpc("foo:getData");

// Remove only if this is still the registered handler:
offClientRpc("foo:getData", handler);
```

| Entry point | Register | Unregister |
| --- | --- | --- |
| `fivem-rpc/server` | `onClientRpc` | `offClientRpc` |
| `fivem-rpc/client` | `onServerRpc`, `onNuiRpc` | `offServerRpc`, `offNuiRpc` |
| `fivem-rpc/nui` | `onClientRpc` | `offClientRpc` |

## Error handling

All call functions always resolve. Check `result.success` before accessing `result.data`.

On failure, `result.error` is a discriminated union:

```ts
const result = await callServerRpc("foo:getData", { id: 1 });

if (!result.success) {
  switch (result.error.code) {
    case "ERR_NO_HANDLER":
      console.error("no handler for", result.error.procedure);
      break;
    case "ERR_TIMEOUT":
      console.error("timed out waiting for", result.error.procedure);
      break;
    case "ERR_HANDLER":
      console.error("handler threw:", result.error.message);
      break;
  }
}
```

| Code | Cause |
| --- | --- |
| `ERR_NO_HANDLER` | No handler registered for the procedure |
| `ERR_TIMEOUT` | Response not received within the timeout |
| `ERR_HANDLER` | Handler threw at runtime |

## Channels

`initializeRpc` accepts an optional `channel` name (defaults to `"default"`). A channel scopes all internal event names so that two independent systems in the same resource cannot interfere with each other.

Use multiple channels when you want to initialise RPC more than once in the same resource, for example to keep unrelated feature sets isolated:

```ts
const core = initializeRpc({ channel: "core" });
const player = initializeRpc({ channel: "player" });
```

The channel name must match on both the server and client side. If you only call `initializeRpc` once per resource, you can omit it entirely and rely on the default.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `channel` | `"default"` | Scopes all event names to this channel |
| `timeout` | `10000` | Milliseconds to wait for a response before resolving with `ERR_TIMEOUT` |
