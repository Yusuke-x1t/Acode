import { defineBundle, defineServer, installers } from "../providerUtils";
import type { LspServerBundle, LspServerManifest } from "../types";

export const styluaServers: LspServerManifest[] = [
	defineServer({
		id: "stylua",
		label: "StyLua (Lua / Luau Formatter)",
		languages: ["lua", "luau"],
		command: "stylua",
		args: ["--lsp"],
		checkCommand: "which stylua",
		installer: installers.apk({
			executable: "stylua",
			packages: ["stylua"],
		}),
		useWorkspaceFolders: true,
		priority: 100,
		clientConfig: {
			builtinExtensions: {
				completion: false,
				hover: false,
				signature: false,
				diagnostics: false,
				inlayHints: false,
				documentColors: false,
				formatting: true,
			},
		},
		enabled: true,
	}),
];

export const styluaBundle: LspServerBundle = defineBundle({
	id: "builtin-stylua",
	label: "StyLua",
	servers: styluaServers,
});
