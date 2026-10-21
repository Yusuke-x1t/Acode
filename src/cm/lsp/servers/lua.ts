import toast from "components/toast";
import confirm from "dialogs/confirm";
import loader from "dialogs/loader";
import {
	quoteArg,
	runForegroundCommand,
	runQuickCommand,
} from "../installRuntime";
import { defineBundle, defineServer, installers } from "../providerUtils";
import type {
	InstallCheckResult,
	LspServerBundle,
	LspServerManifest,
} from "../types";

// Alpine APK installs this package entrypoint in /usr/bin.
// Luau differs because its binary is manually installed under /usr/local/bin.
const LUA_BINARY = "/usr/bin/lua-language-server";
const LUA_PACKAGE = "lua-language-server";

async function getLuaVersion(): Promise<string | null> {
	const output = await runQuickCommand(`${quoteArg(LUA_BINARY)} --version`);
	return output.trim() || null;
}

export const luaServers: LspServerManifest[] = [
	defineServer({
		id: "lua",
		label: "Lua (Lua Language Server)",
		languages: ["lua"],
		command: LUA_BINARY,
		args: [],
		checkCommand: `test -x ${LUA_BINARY}`,
		versionCommand: `${LUA_BINARY} --version`,
		updateCommand: `apk add --no-cache --upgrade ${LUA_PACKAGE}`,
		installer: installers.apk({
			executable: LUA_PACKAGE,
			packages: [LUA_PACKAGE],
		}),
		useWorkspaceFolders: true,
		priority: 0,
		clientConfig: {
			workspaceConfiguration: {
				Lua: {
					runtime: {
						version: "Lua 5.4",
						path: ["?.lua", "?/init.lua"],
						pathStrict: false,
					},
					workspace: {
						checkThirdParty: false,
					},
					telemetry: {
						enable: false,
					},
				},
			},
			builtinExtensions: {
				// StyLua owns formatting for Lua/Luau in this configuration.
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
	hooks: {
		getExecutable: () => LUA_BINARY,
		async checkInstallation(): Promise<InstallCheckResult> {
			try {
				await runQuickCommand(`test -x ${quoteArg(LUA_BINARY)}`);
			} catch (error) {
				return {
					status: "missing",
					version: null,
					canInstall: true,
					canUpdate: true,
					message:
						error instanceof Error ? error.message : String(error),
				};
			}

			try {
				return {
					status: "present",
					version: await getLuaVersion(),
					canInstall: true,
					canUpdate: true,
				};
			} catch (error) {
				return {
					status: "failed",
					version: null,
					canInstall: true,
					canUpdate: true,
					message: `Lua Language Server exists but failed its version check: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		},
		async installServer(_, manifest, mode, options = {}): Promise<boolean> {
			const { promptConfirm = true } = options;
			const label = manifest.label || "Lua Language Server";
			const verb =
				mode === "update"
					? "Update"
					: mode === "reinstall"
						? "Repair"
						: "Install";

			if (promptConfirm) {
				const shouldContinue = await confirm(
					label,
					`${verb} ${label} using the Alpine APK package?`,
				);
				if (!shouldContinue) return false;
			}

			const apkCommand =
				mode === "reinstall"
					? `if apk info -e ${quoteArg(LUA_PACKAGE)} >/dev/null 2>&1; then apk fix --reinstall ${quoteArg(LUA_PACKAGE)} || apk add --no-cache --upgrade --force-overwrite ${quoteArg(LUA_PACKAGE)}; else apk add --no-cache --upgrade ${quoteArg(LUA_PACKAGE)}; fi`
					: `apk add --no-cache --upgrade ${quoteArg(LUA_PACKAGE)}`;
			const progressVerb =
				mode === "update"
					? "Updating"
					: mode === "reinstall"
						? "Repairing"
						: "Installing";
			const loadingDialog = loader.create(
				label,
				`${progressVerb} ${label}...`,
			);

			try {
				loadingDialog.show();
				await runForegroundCommand(apkCommand);
				const version = await getLuaVersion();
				toast(
					`${label} ${mode === "update" ? "updated" : mode === "reinstall" ? "repaired" : "installed"}${version ? ` (${version})` : ""}`,
				);
				return true;
			} catch (error) {
				console.error(`Failed to ${verb.toLowerCase()} ${label}`, error);
				toast(
					error instanceof Error
						? error.message
						: `Failed to ${verb.toLowerCase()} ${label}`,
				);
				throw error;
			} finally {
				loadingDialog.destroy();
			}
		},
	},
});
