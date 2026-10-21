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

const STYLUA_BINARY = "/usr/bin/stylua";
const STYLUA_PACKAGE = "stylua";
const MANAGEMENT_LANGUAGE = "stylua-management";

function notifyFormatterChanged() {
	if (typeof window !== "undefined") {
		window.dispatchEvent(new Event("acode-stylua-installation-changed"));
	}
}

function buildInstallCommand(mode: "install" | "update" | "reinstall") {
	const packageInstall = `apk add --no-cache --upgrade ${quoteArg(STYLUA_PACKAGE)}`;
	if (mode === "reinstall") {
		return `apk fix --reinstall ${quoteArg(STYLUA_PACKAGE)} || ${packageInstall} || apk add --no-cache --upgrade --force-overwrite ${quoteArg(STYLUA_PACKAGE)}`;
	}
	return packageInstall;
}

async function getStyLuaVersion(): Promise<string | null> {
	const output = await runQuickCommand(`${quoteArg(STYLUA_BINARY)} --version`);
	return output.trim() || null;
}

export const styluaServers: LspServerManifest[] = [
	defineServer({
		id: "stylua",
		label: "StyLua (Lua / Luau Formatter)",
		languages: [MANAGEMENT_LANGUAGE],
		command: STYLUA_BINARY,
		args: [],
		checkCommand: `test -x ${quoteArg(STYLUA_BINARY)}`,
		versionCommand: `${quoteArg(STYLUA_BINARY)} --version`,
		updateCommand: buildInstallCommand("update"),
		uninstallCommand: `apk del ${quoteArg(STYLUA_PACKAGE)}`,
		installer: installers.apk({
			executable: STYLUA_BINARY,
			packages: [STYLUA_PACKAGE],
		}),
		priority: 100,
		clientConfig: {
			managementOnly: true,
			builtinExtensions: {
				hover: false,
				completion: false,
				signature: false,
				keymaps: false,
				diagnostics: false,
				inlayHints: false,
				formatting: false,
				documentColors: false,
			},
		},
		enabled: true,
	}),
];

const styluaBaseBundle = defineBundle({
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
					message: error instanceof Error ? error.message : String(error),
				};
			}
		},
		async installServer(_, manifest, mode, options = {}): Promise<boolean> {
			const { promptConfirm = true } = options;
			const label = manifest.label || "StyLua";
			const verb = mode === "update" ? "Update" : mode === "reinstall" ? "Repair" : "Install";
			if (promptConfirm) {
				const shouldContinue = await confirm(
					label,
					`${verb} StyLua using the Alpine package manager?`,
				);
				if (!shouldContinue) return false;
			}
			const progressVerb = mode === "update" ? "Updating" : mode === "reinstall" ? "Repairing" : "Installing";
			const loadingDialog = loader.create(label, `${progressVerb} StyLua...`);
			try {
				loadingDialog.show();
				const command = `if ! command -v apk >/dev/null 2>&1; then echo "APK is unavailable. Install or start Acode Terminal first." >&2; exit 127; fi; ${buildInstallCommand(mode)} && test -x ${quoteArg(STYLUA_BINARY)} && ${quoteArg(STYLUA_BINARY)} --version`;
				await runForegroundCommand(command);
				const version = await getStyLuaVersion();
				toast(`StyLua ${mode === "update" ? "updated" : mode === "reinstall" ? "repaired" : "installed"}${version ? ` (${version})` : ""}`);
				notifyFormatterChanged();
				return true;
			} catch (error) {
				console.error(`Failed to ${verb.toLowerCase()} StyLua`, error);
				toast(error instanceof Error ? error.message : `Failed to ${verb.toLowerCase()} StyLua`);
				throw error;
			} finally {
				loadingDialog.destroy();
			}
		},
	},
});

export const styluaBundle: LspServerBundle = {
	...styluaBaseBundle,
	async uninstallServer(_, manifest, options = {}): Promise<boolean> {
		const { promptConfirm = true } = options;
		const label = manifest.label || "StyLua";
		if (promptConfirm) {
			const shouldContinue = await confirm(
				"Uninstall StyLua",
				"Remove the StyLua package from Acode Terminal?",
			);
			if (!shouldContinue) return false;
		}
		const loadingDialog = loader.create(label, "Uninstalling StyLua...");
		try {
			loadingDialog.show();
			await runForegroundCommand(`if ! command -v apk >/dev/null 2>&1; then echo "APK is unavailable. Install or start Acode Terminal first." >&2; exit 127; fi; apk del ${quoteArg(STYLUA_PACKAGE)}`);
			toast("StyLua uninstalled");
			notifyFormatterChanged();
			return true;
		} catch (error) {
			console.error("Failed to uninstall StyLua", error);
			toast(error instanceof Error ? error.message : "Failed to uninstall StyLua");
			throw error;
		} finally {
			loadingDialog.destroy();
		}
	},
};
