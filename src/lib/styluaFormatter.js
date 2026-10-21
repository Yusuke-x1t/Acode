import toast from "components/toast";
import { quoteArg, runQuickCommand } from "cm/lsp/installRuntime";

const STYLUA_BINARY = "/usr/bin/stylua";

export async function formatActiveFileWithStyLua() {
	const manager = window.editorManager;
	const file = manager?.activeFile;
	const editor = manager?.editor;
	if (!file || file.type !== "editor" || !editor) return false;

	const mode = String(file.currentMode || "").toLowerCase();
	if (mode !== "lua" && mode !== "luau") {
		toast("StyLua only formats Lua and Luau files");
		return false;
	}

	const state = editor.state;
	const source = state.doc.toString();
	const candidate = String(file.filename || file.uri || "");
	const filepath = /\.(lua|luau)$/i.test(candidate)
		? candidate
		: `untitled.${mode}`;

	try {
		const command = `test -x ${quoteArg(STYLUA_BINARY)} && printf %s ${quoteArg(source)} | ${quoteArg(STYLUA_BINARY)} --stdin-filepath ${quoteArg(filepath)} -`;
		const formatted = await runQuickCommand(command);
		if (formatted === source) return true;
		const selection = state.selection.main;
		editor.dispatch({
			changes: {
				from: 0,
				to: state.doc.length,
				insert: formatted,
			},
			selection: {
				anchor: Math.min(selection.anchor, formatted.length),
				head: Math.min(selection.head, formatted.length),
			},
		});
		file.session = editor.state;
		return true;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		toast(message || "StyLua failed to format this file");
		return false;
	}
}
