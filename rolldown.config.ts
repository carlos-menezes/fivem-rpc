import { defineConfig } from "rolldown";

export default defineConfig([
	{
		input: "src/client.ts",
		output: { file: "dist/client.js", format: "cjs", cleanDir: true },
	},
	{
		input: "src/server.ts",
		output: { file: "dist/server.js", format: "cjs" },
	},
	{
		input: "src/types.ts",
		output: { file: "dist/types.js", format: "cjs" },
	},
	{
		input: "src/nui.ts",
		output: { file: "dist/nui.js", format: "esm" },
	},
]);
