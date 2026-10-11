import { defineBundle, defineServer, installers } from "../providerUtils";
import type { LspServerBundle, LspServerManifest } from "../types";

export const luaServers: LspServerManifest[] = [
	defineServer({
		id: "lua",
		label: "Lua",
		languages: ["lua"],
		command: "lua-language-server",
		args: [],
		checkCommand: "which lua-language-server",
		installer: installers.apk({
			executable: "lua-language-server",
			packages: ["lua-language-server"],
		}),
		useWorkspaceFolders: true,
		priority: 0,
		clientConfig: {
			builtinExtensions: {
				formatting: false,
			},
		},
		enabled: true,
	}),
];

export const luaBundle: LspServerBundle = defineBundle({
	id: "builtin-lua",
	label: "Lua",
	servers: luaServers,
});
