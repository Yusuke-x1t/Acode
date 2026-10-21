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

// Alpine APK installs StyLua in /usr/bin; keep this aligned with the package.
// Only manually downloaded binaries should be placed in /usr/local/bin.
const STYLUA_BINARY = "/usr/bin/stylua";
const STYLUA_PACKAGE = "stylua";

async function getStyLuaVersion(): Promise<string | null> {
	const output = await runQuickCommand(`${quoteArg(STYLUA_BINARY)} --version`);
	return output.trim() || null;
}

export const styluaServers: LspServerManifest[] = [
	defineServer({
		id: "stylua",
		label: "StyLua (Lua / Luau Formatter)",
		languages: ["lua", "luau"],
		command: STYLUA_BINARY,
		args: ["--lsp"],
		checkCommand: `test -x ${STYLUA_BINARY}`,
		versionCommand: `${STYLUA_BINARY} --version`,
		updateCommand: `apk add --no-cache --upgrade ${STYLUA_PACKAGE}`,
		installer: installers.apk({
			executable: STYLUA_PACKAGE,
			packages: [STYLUA_PACKAGE],
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
	hooks: {
		getExecutable: () => STYLUA_BINARY,
		async checkInstallation(): Promise<InstallCheckResult> {
			try {
				await runQuickCommand(`test -x ${quoteArg(STYLUA_BINARY)}`);
			} catch (error) {
				return {
					status: "missing",
					version: null,
					canInstall: true,
					canUpdate: true,
					message: error instanceof Error ? error.message : String(error),
				};
			}

			try {
				return {
					status: "present",
					version: await getStyLuaVersion(),
					canInstall: true,
					canUpdate: true,
				};
			} catch (error) {
				return {
					status: "failed",
					version: null,
					canInstall: true,
					canUpdate: true,
					message: `StyLua exists but failed its version check: ${error instanceof Error ? error.message : String(error)}`,
				};
			}
		},
		async installServer(_, manifest, mode, options = {}): Promise<boolean> {
			const { promptConfirm = true } = options;
			const label = manifest.label || "StyLua";
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
					? `if apk info -e ${quoteArg(STYLUA_PACKAGE)} >/dev/null 2>&1; then apk fix --reinstall ${quoteArg(STYLUA_PACKAGE)} || apk add --no-cache --upgrade --force-overwrite ${quoteArg(STYLUA_PACKAGE)}; else apk add --no-cache --upgrade ${quoteArg(STYLUA_PACKAGE)}; fi`
					: `apk add --no-cache --upgrade ${quoteArg(STYLUA_PACKAGE)}`;
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
				const version = await getStyLuaVersion();
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
