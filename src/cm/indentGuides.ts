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
const MAX_GUIDE_LEVELS = 40;
const MAX_INDENT_DETECTION_LINES = 400;
const MAX_INDENT_DETECTION_SAMPLES = 80;
const INDENT_DETECTION_CONFIDENCE = 0.8;

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

function getConfiguredIndentUnit(state: EditorState): number {
	const width = getIndentUnit(state);
	return Number.isFinite(width) && width > 0 ? width : getTabSize(state);
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
	let length = 0;
	for (const ch of line) {
		if (ch !== " " && ch !== "\t") break;
		length++;
	}
	return length;
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

function getLineInfo(
	state: EditorState,
	lineNumber: number,
	tabSize: number,
	cache: IndentLineCache,
): IndentLineInfo {
	const line = state.doc.line(lineNumber);
	return getCachedLineInfo(lineNumber, line.text, tabSize, cache);
}

function detectIndentUnitColumns(
	state: EditorState,
	tabSize: number,
	fallbackUnit: number,
	lineCache: IndentLineCache,
): number {
	const indentValues: number[] = [];
	const indentChanges: number[] = [];
	let previousIndent: number | null = null;
	let sampledLines = 0;
	const scanLimit = Math.min(state.doc.lines, MAX_INDENT_DETECTION_LINES);

	for (let lineNumber = 1; lineNumber <= scanLimit; lineNumber++) {
		const info = getLineInfo(state, lineNumber, tabSize, lineCache);
		if (info.blank) continue;

		sampledLines++;
		const indent = info.indentColumns;

		if (indent > 0) indentValues.push(indent);

		if (previousIndent !== null) {
			const difference = Math.abs(indent - previousIndent);
			if (difference > 0) indentChanges.push(difference);
		}

		previousIndent = indent;

		if (
			sampledLines >= MAX_INDENT_DETECTION_SAMPLES &&
			indentChanges.length >= 8
		) {
			break;
		}
	}

	const samples = indentChanges.length >= 2 ? indentChanges : indentValues;
	if (samples.length === 0) return fallbackUnit;

	const maximumSample = Math.max(...samples);
	const maximumCandidate = Math.min(16, maximumSample);
	let detectedUnit = 1;
	let detectedSupport = 0;

	for (let candidate = 2; candidate <= maximumCandidate; candidate++) {
		let matches = 0;
		for (const sample of samples) {
			if (sample % candidate === 0) matches++;
		}

		const support = matches / samples.length;
		if (
			support >= INDENT_DETECTION_CONFIDENCE &&
			(candidate > detectedUnit ||
				(candidate === detectedUnit && support > detectedSupport))
		) {
			detectedUnit = candidate;
			detectedSupport = support;
		}
	}

	if (detectedUnit > 1 && detectedSupport >= INDENT_DETECTION_CONFIDENCE) {
		return detectedUnit;
	}

	return fallbackUnit;
}

function findNearestIndent(
	state: EditorState,
	startLine: number,
	direction: -1 | 1,
	tabSize: number,
	lineCache: IndentLineCache,
): number {
	for (
		let lineNumber = startLine;
		lineNumber >= 1 && lineNumber <= state.doc.lines;
		lineNumber += direction
	) {
		const info = getLineInfo(state, lineNumber, tabSize, lineCache);
		if (!info.blank) return info.indentColumns;
	}

	return -1;
}

function getBlankLineIndent(
	state: EditorState,
	lineNumber: number,
	tabSize: number,
	lineCache: IndentLineCache,
): number {
	const previousIndent = findNearestIndent(
		state,
		lineNumber - 1,
		-1,
		tabSize,
		lineCache,
	);
	const followingIndent = findNearestIndent(
		state,
		lineNumber + 1,
		1,
		tabSize,
		lineCache,
	);

	if (previousIndent !== -1 && followingIndent !== -1) {
		return Math.min(previousIndent, followingIndent);
	}
	if (previousIndent !== -1) return previousIndent;
	if (followingIndent !== -1) return followingIndent;
	return 0;
}

function getGuideLevels(indentColumns: number, indentUnit: number): number {
	return Math.min(
		Math.floor(indentColumns / Math.max(indentUnit, 1)),
		MAX_GUIDE_LEVELS,
	);
}

function buildGuideStyle(
	levels: number,
	guideStepPx: number,
	activeGuideLevel: number,
	markOnIndent: boolean,
): string {
	const images: string[] = [];
	const positions: string[] = [];
	const sizes: string[] = [];

	for (let level = 1; level <= levels; level++) {
		const color =
			level === activeGuideLevel
				? "var(--indent-guide-active-color)"
				: "var(--indent-guide-color)";

		images.push(`linear-gradient(${color}, ${color})`);
		const positionPx = markOnIndent
			? Math.max(0, level * guideStepPx - 1)
			: level * guideStepPx;
		positions.push(`${positionPx}px 0`);
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
	markOnIndent: boolean,
	styleCache: GuideStyleCache,
): string {
	const key = `${levels}:${guideStepPx}:${activeGuideLevel}:${markOnIndent ? 1 : 0}`;
	let style = styleCache.get(key);

	if (!style) {
		style = buildGuideStyle(levels, guideStepPx, activeGuideLevel, markOnIndent);
		styleCache.set(key, style);
	}

	return style;
}

function getVisibleLineNumbers(view: EditorView): number[] {
	const lineNumbers = new Set<number>();

	for (const range of view.visibleRanges) {
		const firstLine = view.state.doc.lineAt(range.from).number;
		const lastLine = view.state.doc.lineAt(range.to).number;

		for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
			lineNumbers.add(lineNumber);
		}
	}

	return Array.from(lineNumbers).sort((a, b) => a - b);
}

function getEffectiveVisibleIndentations(
	view: EditorView,
	visibleLineNumbers: number[],
	tabSize: number,
	lineCache: IndentLineCache,
): Map<number, number> {
	const result = new Map<number, number>();
	if (visibleLineNumbers.length === 0) return result;

	const visible = new Set(visibleLineNumbers);
	const ranges: Array<{ start: number; end: number }> = [];
	let start = visibleLineNumbers[0];
	let previous = start;

	for (let index = 1; index < visibleLineNumbers.length; index++) {
		const current = visibleLineNumbers[index];
		if (current !== previous + 1) {
			ranges.push({ start, end: previous });
			start = current;
		}
		previous = current;
	}
	ranges.push({ start, end: previous });

	for (const range of ranges) {
		const previousIndentByLine = new Map<number, number>();
		const nextIndentByLine = new Map<number, number>();
		const firstInfo = getLineInfo(view.state, range.start, tabSize, lineCache);
		let previousIndent = firstInfo.blank
			? findNearestIndent(
					view.state,
					range.start - 1,
					-1,
					tabSize,
					lineCache,
				)
			: -1;

		for (let lineNumber = range.start; lineNumber <= range.end; lineNumber++) {
			const info = getLineInfo(view.state, lineNumber, tabSize, lineCache);
			previousIndentByLine.set(lineNumber, previousIndent);
			if (!info.blank) previousIndent = info.indentColumns;
		}

		const lastInfo = getLineInfo(view.state, range.end, tabSize, lineCache);
		let nextIndent = lastInfo.blank
			? findNearestIndent(
					view.state,
					range.end + 1,
					1,
					tabSize,
					lineCache,
				)
			: -1;

		for (
			let lineNumber = range.end;
			lineNumber >= range.start;
			lineNumber--
		) {
			const info = getLineInfo(view.state, lineNumber, tabSize, lineCache);
			nextIndentByLine.set(lineNumber, nextIndent);
			if (!info.blank) nextIndent = info.indentColumns;
		}

		for (let lineNumber = range.start; lineNumber <= range.end; lineNumber++) {
			if (!visible.has(lineNumber)) continue;
			const info = getLineInfo(view.state, lineNumber, tabSize, lineCache);

			if (!info.blank) {
				result.set(lineNumber, info.indentColumns);
				continue;
			}

			const before = previousIndentByLine.get(lineNumber) ?? -1;
			const after = nextIndentByLine.get(lineNumber) ?? -1;

			if (before !== -1 && after !== -1) {
				result.set(lineNumber, Math.min(before, after));
			} else if (before !== -1) {
				result.set(lineNumber, before);
			} else if (after !== -1) {
				result.set(lineNumber, after);
			} else {
				result.set(lineNumber, 0);
			}
		}
	}

	return result;
}

function buildDecorations(
	view: EditorView,
	config: Required<IndentGuidesConfig>,
	lineCache: IndentLineCache,
	styleCache: GuideStyleCache,
	indentUnit: number,
): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const { state } = view;
	const tabSize = getTabSize(state);
	const guideStepPx = Math.max(view.defaultCharacterWidth * indentUnit, 1);
	const visibleLineNumbers = getVisibleLineNumbers(view);
	const effectiveIndentByLine = getEffectiveVisibleIndentations(
		view,
		visibleLineNumbers,
		tabSize,
		lineCache,
	);

	let activeGuideLevel = -1;
	let activeStartLine = 0;
	let activeEndLine = 0;

	if (config.highlightActiveGuide) {
		const activeLine = state.doc.lineAt(state.selection.main.head);
		const activeInfo = getLineInfo(state, activeLine.number, tabSize, lineCache);
		const activeIndentColumns = activeInfo.blank
			? getBlankLineIndent(state, activeLine.number, tabSize, lineCache)
			: activeInfo.indentColumns;

		activeGuideLevel = getGuideLevels(activeIndentColumns, indentUnit);

		if (activeGuideLevel > 0 && visibleLineNumbers.length > 0) {
			const visibleStartLine = visibleLineNumbers[0];
			const visibleEndLine = visibleLineNumbers[visibleLineNumbers.length - 1];
			activeStartLine = activeLine.number;
			activeEndLine = activeLine.number;

			for (
				let lineNumber = activeLine.number - 1;
				lineNumber >= visibleStartLine;
				lineNumber--
			) {
				const info = getLineInfo(state, lineNumber, tabSize, lineCache);
				const columns = info.blank
					? effectiveIndentByLine.get(lineNumber) ?? 0
					: info.indentColumns;
				const levels = getGuideLevels(columns, indentUnit);

				if (!info.blank && levels < activeGuideLevel) break;
				activeStartLine = lineNumber;
			}

			for (
				let lineNumber = activeLine.number + 1;
				lineNumber <= visibleEndLine;
				lineNumber++
			) {
				const info = getLineInfo(state, lineNumber, tabSize, lineCache);
				const columns = info.blank
					? effectiveIndentByLine.get(lineNumber) ?? 0
					: info.indentColumns;
				const levels = getGuideLevels(columns, indentUnit);

				if (!info.blank && levels < activeGuideLevel) break;
				activeEndLine = lineNumber;
			}
		}
	}

	for (const lineNumber of visibleLineNumbers) {
		const line = state.doc.line(lineNumber);
		const info = getLineInfo(state, lineNumber, tabSize, lineCache);

		if (config.hideOnBlankLines && info.blank) continue;

		const indentColumns = effectiveIndentByLine.get(lineNumber) ?? info.indentColumns;
		const levels = getGuideLevels(indentColumns, indentUnit);
		if (levels <= 0) continue;

		const lineActiveGuideLevel =
			config.highlightActiveGuide &&
			lineNumber >= activeStartLine &&
			lineNumber <= activeEndLine
				? activeGuideLevel
				: -1;

		const style = getGuideStyle(
			levels,
			guideStepPx,
			lineActiveGuideLevel,
			!info.blank,
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
		} else if (info.leadingWhitespaceLength > 0) {
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
			lastConfiguredIndentUnit = 1;
			guideIndentUnit = 1;

			constructor(view: EditorView) {
				const { state } = view;
				this.lastCharWidth = view.defaultCharacterWidth;
				this.lastTabSize = getTabSize(state);
				this.lastConfiguredIndentUnit = getConfiguredIndentUnit(state);
				this.guideIndentUnit = detectIndentUnitColumns(
					state,
					this.lastTabSize,
					this.lastConfiguredIndentUnit,
					this.lineCache,
				);

				this.decorations = buildDecorations(
					view,
					config,
					this.lineCache,
					this.styleCache,
					this.guideIndentUnit,
				);
			}

			update(update: ViewUpdate): void {
				const { view, state } = update;
				let needsRebuild = false;

				if (update.docChanged) {
					this.decorations = this.decorations.map(update.changes);
					this.lineCache.clear();
					this.styleCache.clear();
					this.guideIndentUnit = detectIndentUnitColumns(
						state,
						getTabSize(state),
						getConfiguredIndentUnit(state),
						this.lineCache,
					);
					needsRebuild = true;
				}

				if (update.viewportChanged) {
					needsRebuild = true;
				}

				if (config.highlightActiveGuide && update.selectionSet) {
					needsRebuild = true;
				}

				const currentTabSize = getTabSize(state);
				const currentConfiguredIndentUnit = getConfiguredIndentUnit(state);
				const currentCharWidth = view.defaultCharacterWidth;

				if (
					currentTabSize !== this.lastTabSize ||
					currentConfiguredIndentUnit !== this.lastConfiguredIndentUnit
				) {
					this.lastTabSize = currentTabSize;
					this.lastConfiguredIndentUnit = currentConfiguredIndentUnit;
					this.lineCache.clear();
					this.styleCache.clear();
					this.guideIndentUnit = detectIndentUnitColumns(
						state,
						currentTabSize,
						currentConfiguredIndentUnit,
						this.lineCache,
					);
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
						this.guideIndentUnit,
					);
				}
			}

			destroy(): void {
				this.lineCache.clear();
				this.styleCache.clear();
			}
		},
		{
			decorations: (value) => value.decorations,
		},
	);
}

const indentGuidesTheme = EditorView.baseTheme({
	".cm-indent-guides": {
		display: "inline",
	},
	".cm-indent-guides-line": {
		backgroundOrigin: "content-box",
	},
	"&": {
		"--indent-guide-color": "#404040",
		"--indent-guide-active-color": "#707070",
	},
	"&light": {
		"--indent-guide-color": "rgba(0, 0, 0, 0.1)",
		"--indent-guide-active-color": "rgba(0, 0, 0, 0.55)",
	},
	"&dark": {
		"--indent-guide-color": "#404040",
		"--indent-guide-active-color": "#707070",
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
