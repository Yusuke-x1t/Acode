
import { getIndentUnit } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";

export interface IndentGuidesConfig {
	highlightActiveGuide?: boolean;
	hideOnBlankLines?: boolean;
}

const defaultConfig: Required<IndentGuidesConfig> = {
	highlightActiveGuide: false,
	hideOnBlankLines: false,
};

const GUIDE_MARK_CLASS = "cm-indent-guides";
const GUIDE_LINE_CLASS = "cm-indent-guides-line";
const MAX_VISIBLE_GUIDE_LINES = 500;
const MAX_GUIDE_LEVELS = 40;
const BLANK_LINE_SCAN_LIMIT = 100;

interface IndentLineInfo {
	text: string;
	tabSize: number;
	indentColumns: number;
	leadingWhitespaceLength: number;
	blank: boolean;
}

type IndentLineCache = Map<number, IndentLineInfo>;
type GuideStyleCache = Map<string, string>;

function getTabSize(state: EditorState): number {
	const tabSize = state.facet(EditorState.tabSize);
	return Number.isFinite(tabSize) && tabSize > 0 ? tabSize : 4;
}

function getIndentUnitColumns(state: EditorState): number {
	const width = getIndentUnit(state);
	if (Number.isFinite(width) && width > 0) return width;
	return getTabSize(state);
}

function getLineIndentation(line: string, tabSize: number): number {
	let columns = 0;

	for (const ch of line) {
		if (ch === " ") {
			columns++;
		} else if (ch === "\t") {
			columns += tabSize - (columns % tabSize);
		} else {
			break;
		}
	}

	return columns;
}

function isBlankLine(line: string): boolean {
	return /^\s*$/.test(line);
}

function getLeadingWhitespaceLength(line: string): number {
	let count = 0;

	for (const ch of line) {
		if (ch === " " || ch === "\t") {
			count++;
		} else {
			break;
		}
	}

	return count;
}

function buildGuideStyle(
	levels: number,
	guideStepPx: number,
	activeGuideLevel: number,
): string {
	const images: string[] = [];
	const positions: string[] = [];
	const sizes: string[] = [];

	for (let i = 0; i < levels; i++) {
		const color =
			i + 1 === activeGuideLevel
				? "var(--indent-guide-active-color)"
				: "var(--indent-guide-color)";

		images.push(`linear-gradient(${color}, ${color})`);
		positions.push(`${i * guideStepPx}px 0`);
		sizes.push("1px 100%");
	}

	return [
		`background-image:${images.join(",")}`,
		"background-repeat:no-repeat",
		`background-position:${positions.join(",")}`,
		`background-size:${sizes.join(",")}`,
	].join(";");
}

function getGuideStyle(
	levels: number,
	guideStepPx: number,
	activeGuideLevel: number,
	styleCache: GuideStyleCache,
): string {
	const key = `${levels}:${guideStepPx}:${activeGuideLevel}`;
	let style = styleCache.get(key);

	if (!style) {
		style = buildGuideStyle(levels, guideStepPx, activeGuideLevel);
		styleCache.set(key, style);
	}

	return style;
}

function getCachedLineInfo(
	lineNumber: number,
	lineText: string,
	tabSize: number,
	cache: IndentLineCache,
): IndentLineInfo {
	const cached = cache.get(lineNumber);

	if (cached && cached.text === lineText && cached.tabSize === tabSize) {
		return cached;
	}

	const info: IndentLineInfo = {
		text: lineText,
		tabSize,
		indentColumns: getLineIndentation(lineText, tabSize),
		leadingWhitespaceLength: getLeadingWhitespaceLength(lineText),
		blank: isBlankLine(lineText),
	};

	cache.set(lineNumber, info);
	return info;
}

function buildDecorations(
	view: EditorView,
	config: Required<IndentGuidesConfig>,
	lineCache: IndentLineCache,
	styleCache: GuideStyleCache,
): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const { state } = view;
	const tabSize = getTabSize(state);
	const indentUnit = getIndentUnitColumns(state);
	const guideStepPx = Math.max(view.defaultCharacterWidth * indentUnit, 1);

	let activeGuideLevel = -1;
	let activeStartLine = 0;
	let activeEndLine = 0;

	if (config.highlightActiveGuide) {
		const activeLine = state.doc.lineAt(state.selection.main.head);
		const activeInfo = getCachedLineInfo(
			activeLine.number,
			activeLine.text,
			tabSize,
			lineCache,
		);

		let activeIndentColumns = activeInfo.indentColumns;

		if (activeInfo.blank && activeIndentColumns === 0) {
			let previousIndent = -1;
			let followingIndent = -1;

			for (
				let lineNum = activeLine.number - 1;
				lineNum >= Math.max(1, activeLine.number - BLANK_LINE_SCAN_LIMIT);
				lineNum--
			) {
				const line = state.doc.line(lineNum);
				const info = getCachedLineInfo(
					lineNum,
					line.text,
					tabSize,
					lineCache,
				);

				if (!info.blank) {
					previousIndent = info.indentColumns;
					break;
				}
			}

			for (
				let lineNum = activeLine.number + 1;
				lineNum <= Math.min(
					state.doc.lines,
					activeLine.number + BLANK_LINE_SCAN_LIMIT,
				);
				lineNum++
			) {
				const line = state.doc.line(lineNum);
				const info = getCachedLineInfo(
					lineNum,
					line.text,
					tabSize,
					lineCache,
				);

				if (!info.blank) {
					followingIndent = info.indentColumns;
					break;
				}
			}

			if (previousIndent !== -1 && followingIndent !== -1) {
				activeIndentColumns = Math.min(previousIndent, followingIndent);
			} else if (previousIndent !== -1) {
				activeIndentColumns = previousIndent;
			} else if (followingIndent !== -1) {
				activeIndentColumns = followingIndent;
			}
		}

		activeGuideLevel = Math.min(
			Math.floor(activeIndentColumns / indentUnit),
			MAX_GUIDE_LEVELS,
		);

		if (activeGuideLevel > 0) {
			const firstVisibleRange = view.visibleRanges[0];
			const lastVisibleRange =
				view.visibleRanges[view.visibleRanges.length - 1];

			const visibleStartLine = state.doc.lineAt(
				firstVisibleRange?.from ?? 0,
			).number;

			const visibleEndLine = state.doc.lineAt(
				lastVisibleRange?.to ?? state.doc.length,
			).number;

			activeStartLine = activeLine.number;
			activeEndLine = activeLine.number;

			for (
				let lineNum = activeLine.number - 1;
				lineNum >= visibleStartLine;
				lineNum--
			) {
				const line = state.doc.line(lineNum);
				const info = getCachedLineInfo(
					lineNum,
					line.text,
					tabSize,
					lineCache,
				);

				const levels = Math.min(
					Math.floor(info.indentColumns / indentUnit),
					MAX_GUIDE_LEVELS,
				);

				if (!info.blank && levels < activeGuideLevel) break;
				activeStartLine = lineNum;
			}

			for (
				let lineNum = activeLine.number + 1;
				lineNum <= visibleEndLine;
				lineNum++
			) {
				const line = state.doc.line(lineNum);
				const info = getCachedLineInfo(
					lineNum,
					line.text,
					tabSize,
					lineCache,
				);

				const levels = Math.min(
					Math.floor(info.indentColumns / indentUnit),
					MAX_GUIDE_LEVELS,
				);

				if (!info.blank && levels < activeGuideLevel) break;
				activeEndLine = lineNum;
			}
		}
	}

	let processedLines = 0;

	for (const { from: blockFrom, to: blockTo } of view.visibleRanges) {
		const startLine = state.doc.lineAt(blockFrom);
		const endLine = state.doc.lineAt(blockTo);
		const firstLineNumber = startLine.number;
		const lastLineNumber = endLine.number;
		const scanStartLine = Math.max(
			1,
			firstLineNumber - BLANK_LINE_SCAN_LIMIT,
		);
		const scanEndLine = Math.min(
			state.doc.lines,
			lastLineNumber + BLANK_LINE_SCAN_LIMIT,
		);

		const prevIndentByLine = new Map<number, number>();
		const nextIndentByLine = new Map<number, number>();
		let prevIndent = -1;
		let prevIndentLine = -1;

		for (
			let lineNum = scanStartLine;
			lineNum <= scanEndLine;
			lineNum++
		) {
			const line = state.doc.line(lineNum);
			const info = getCachedLineInfo(
				lineNum,
				line.text,
				tabSize,
				lineCache,
			);

			prevIndentByLine.set(
				lineNum,
				lineNum - prevIndentLine <= BLANK_LINE_SCAN_LIMIT
					? prevIndent
					: -1,
			);

			if (!info.blank) {
				prevIndent = info.indentColumns;
				prevIndentLine = lineNum;
			}
		}

		let nextIndent = -1;
		let nextIndentLine = state.doc.lines + 1;

		for (
			let lineNum = scanEndLine;
			lineNum >= scanStartLine;
			lineNum--
		) {
			const line = state.doc.line(lineNum);
			const info = getCachedLineInfo(
				lineNum,
				line.text,
				tabSize,
				lineCache,
			);

			nextIndentByLine.set(
				lineNum,
				nextIndentLine - lineNum <= BLANK_LINE_SCAN_LIMIT
					? nextIndent
					: -1,
			);

			if (!info.blank) {
				nextIndent = info.indentColumns;
				nextIndentLine = lineNum;
			}
		}

		for (
			let lineNum = firstLineNumber;
			lineNum <= lastLineNumber;
			lineNum++
		) {
			if (processedLines >= MAX_VISIBLE_GUIDE_LINES) {
				return builder.finish();
			}

			processedLines++;

			const line = state.doc.line(lineNum);
			const info = getCachedLineInfo(
				lineNum,
				line.text,
				tabSize,
				lineCache,
			);

			if (config.hideOnBlankLines && info.blank) {
				continue;
			}

			let indentColumns = info.indentColumns;

			if (info.blank) {
				const previousIndent = prevIndentByLine.get(lineNum) ?? -1;
				const followingIndent = nextIndentByLine.get(lineNum) ?? -1;

				if (previousIndent !== -1 && followingIndent !== -1) {
					indentColumns = Math.min(previousIndent, followingIndent);
				} else if (previousIndent !== -1) {
					indentColumns = previousIndent;
				} else if (followingIndent !== -1) {
					indentColumns = followingIndent;
				}
			}

			const levels = Math.min(
				Math.floor(indentColumns / indentUnit),
				MAX_GUIDE_LEVELS,
			);

			if (levels <= 0) continue;

			const lineActiveGuideLevel =
				config.highlightActiveGuide &&
				lineNum >= activeStartLine &&
				lineNum <= activeEndLine
					? activeGuideLevel
					: -1;

			const style = getGuideStyle(
				levels,
				guideStepPx,
				lineActiveGuideLevel,
				styleCache,
			);

			if (info.blank) {
				builder.add(
					line.from,
					line.from,
					Decoration.line({
						attributes: {
							class: GUIDE_LINE_CLASS,
							style,
						},
					}),
				);
			} else {
				if (info.leadingWhitespaceLength <= 0) continue;

				builder.add(
					line.from,
					line.from + info.leadingWhitespaceLength,
					Decoration.mark({
						attributes: {
							class: GUIDE_MARK_CLASS,
							style,
						},
					}),
				);
			}
		}
	}

	return builder.finish();
}

function createIndentGuidesPlugin(
	config: Required<IndentGuidesConfig>,
): ViewPlugin<{
	decorations: DecorationSet;
	update(update: ViewUpdate): void;
}> {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			lineCache: IndentLineCache = new Map();
			styleCache: GuideStyleCache = new Map();
			lastCharWidth = 0;
			lastTabSize = 4;
			lastIndentUnit = 4;

			constructor(view: EditorView) {
				const { state } = view;
				this.lastCharWidth = view.defaultCharacterWidth;
				this.lastTabSize = getTabSize(state);
				this.lastIndentUnit = getIndentUnitColumns(state);

				this.decorations = buildDecorations(
					view,
					config,
					this.lineCache,
					this.styleCache,
				);
			}

			update(update: ViewUpdate): void {
				const { view, state } = update;
				let needsRebuild = false;

				if (update.docChanged) {
					this.decorations = this.decorations.map(update.changes);
					this.lineCache.clear();
					needsRebuild = true;
				}

				if (update.viewportChanged) {
					needsRebuild = true;
				}

				if (config.highlightActiveGuide && update.selectionSet) {
					needsRebuild = true;
				}

				const currentTabSize = getTabSize(state);
				const currentIndentUnit = getIndentUnitColumns(state);
				const currentCharWidth = view.defaultCharacterWidth;

				if (
					currentTabSize !== this.lastTabSize ||
					currentIndentUnit !== this.lastIndentUnit
				) {
					this.lastTabSize = currentTabSize;
					this.lastIndentUnit = currentIndentUnit;
					this.lineCache.clear();
					this.styleCache.clear();
					needsRebuild = true;
				}

				if (currentCharWidth !== this.lastCharWidth) {
					this.lastCharWidth = currentCharWidth;
					this.styleCache.clear();
					needsRebuild = true;
				}

				if (needsRebuild) {
					this.decorations = buildDecorations(
						view,
						config,
						this.lineCache,
						this.styleCache,
					);
				}
			}

			destroy(): void {
				this.lineCache.clear();
				this.styleCache.clear();
			}
		},
		{
			decorations: (v) => v.decorations,
		},
	);
}

const indentGuidesTheme = EditorView.baseTheme({
	".cm-indent-guides": {
		display: "inline-block",
		verticalAlign: "top",
	},
	".cm-indent-guides-line": {
		backgroundOrigin: "content-box",
	},
	"&": {
		"--indent-guide-color": "#404040",
		"--indent-guide-active-color": "#FFFFFF",
	},
	"&light": {
		"--indent-guide-color": "rgba(0, 0, 0, 0.1)",
		"--indent-guide-active-color": "rgba(0, 0, 0, 0.55)",
	},
	"&dark": {
		"--indent-guide-color": "#404040",
		"--indent-guide-active-color": "#FFFFFF",
	},
});

export function indentGuides(config: IndentGuidesConfig = {}): Extension {
	const mergedConfig: Required<IndentGuidesConfig> = {
		...defaultConfig,
		...config,
	};

	return [createIndentGuidesPlugin(mergedConfig), indentGuidesTheme];
}

export function indentGuidesExtension(
	enabled: boolean,
	config: IndentGuidesConfig = {},
): Extension {
	if (!enabled) return [];
	return indentGuides(config);
}

export default indentGuides;
