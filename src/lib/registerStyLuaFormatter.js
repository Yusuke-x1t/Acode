import { quoteArg, runQuickCommand } from "cm/lsp/installRuntime";
import serverRegistry from "cm/lsp/serverRegistry";
import appSettings from "lib/settings";

const STYLUA_ID = "stylua";
const STYLUA_BINARY = "/usr/bin/stylua";
const HIDDEN_SETTING_KEYS = [
	"startup_timeout",
	"edit_init_options",
	"view_init_options",
	"ext_hover",
	"ext_completion",
	"ext_signature",
	"ext_diagnostics",
	"ext_inlayHints",
	"ext_formatting",
];

function installStyLuaSettingsStyle() {
	if (typeof document === "undefined" || document.getElementById("acode-stylua-management-style")) return;
	const style = document.createElement("style");
	style.id = "acode-stylua-management-style";
	style.textContent = HIDDEN_SETTING_KEYS.map(
		(key) => `.detail-settings-list[data-lsp-server-id="stylua"] [data-key="${key}"]{display:none!important}`,
	).join("\n");
	document.head?.appendChild(style);
}

function isStyLuaEnabled() {
	const server = serverRegistry.getServer(STYLUA_ID);
	const override = appSettings.value?.lsp?.servers?.[STYLUA_ID];
	return (override?.enabled ?? server?.enabled ?? true) !== false;
}

function isRegistered(acode) {
	return acode.formatters.some(({ id }) => id === STYLUA_ID);
}

export async function syncStyLuaFormatter(acode = window?.acode) {
	installStyLuaSettingsStyle();
	if (!acode) return;
	let installed = false;
	try {
		await runQuickCommand(`test -x ${quoteArg(STYLUA_BINARY)} && ${quoteArg(STYLUA_BINARY)} --version`);
		installed = true;
	} catch {}

	if (!installed || !isStyLuaEnabled()) {
		if (isRegistered(acode)) acode.unregisterFormatter(STYLUA_ID);
		return;
	}
	if (isRegistered(acode)) return;

	acode.registerFormatter(
		STYLUA_ID,
		["lua", "luau"],
		async () => {
			if (!isStyLuaEnabled()) return false;
			const { formatActiveFileWithStyLua } = await import("lib/styluaFormatter");
			return formatActiveFileWithStyLua();
		},
		"StyLua",
	);
}

appSettings.on("update:lsp", () => {
	void syncStyLuaFormatter();
});

if (typeof window !== "undefined") {
	window.addEventListener("acode-stylua-installation-changed", () => {
		void syncStyLuaFormatter();
	});
}

export async function registerStyLuaFormatter(acode = window?.acode) {
	await syncStyLuaFormatter(acode);
}
