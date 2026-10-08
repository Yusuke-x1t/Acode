import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";

const DEFAULT_DARK_COLORS = [
	"#FFD700",
	"#DA70D6",
	"#179FFF",
	"#4EC9B0",
	"#CE9178",
	"#9CDCFE",
];

const DEFAULT_LIGHT_COLORS = [
	"#795e26",
	"#af00db",
	"#005cc5",
	"#008000",
	"#b15c00",
	"#267f99",
];

const MIN_LOOK_BEHIND = 4000;
const MAX_LOOK_BEHIND = 24000;
const DEFAULT_EXACT_SCAN_LIMIT = 24000;

const CLOSING_TO_OPENING = {
	")": "(",
	"]": "[",
	"}": "{",
} as const;

type ClosingBracket = keyof typeof CLOSING_TO_OPENING;

export interface RainbowBracketThemeConfig {
	dark?: boolean;
	keyword?: string;
	bracketColors?: readonly string[];
	type?: string;
	class?: string;
	function?: string;
	string?: string;
	number?: string;
	constant?: string;
	variable?: string;
	foreground?: string;
}

export interface RainbowBracketsOptions {
	colors?: readonly string[];
	exactScanLimit?: number;
	lookBehind?: number;
}

interface BracketInfo {
	char: string;
	colorIndex: number;
}

function normalizeHexColor(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const color = value.trim().toLowerCase();
	if (/^#([\da-f]{3}|[\da-f]{6})$/.test(color)) return color;
	return null;
}

function clampLookBehind(value: number | undefined): number {
	if (!Number.isFinite(value)) return MAX_LOOK_BEHIND;
	return Math.max(
		MIN_LOOK_BEHIND,
		Math.min(MAX_LOOK_BEHIND, Math.floor(value || 0)),
	);
}

function getScanStart(
	view: EditorView,
	lookBehind: number,
	exactScanLimit: number,
): number {
	const ranges = view.visibleRanges;
	if (!ranges.length) return 0;

	const firstVisibleFrom = ranges[0].from;
	const lastVisibleTo = ranges[ranges.length - 1].to;
	const docLength = view.state.doc.length;

	if (docLength <= exactScanLimit || firstVisibleFrom <= exactScanLimit) {
		return 0;
	}

	const visibleSpan = Math.max(1, lastVisibleTo - firstVisibleFrom);
	const dynamicLookBehind = Math.max(
		MIN_LOOK_BEHIND,
		Math.min(MAX_LOOK_BEHIND, visibleSpan * 3),
	);

	return Math.max(
		0,
		firstVisibleFrom - Math.max(lookBehind, dynamicLookBehind),
	);
}

function isOpeningBracket(char: string): boolean {
	return char === "(" || char === "[" || char === "{";
}

function isSkipContext(name: string): boolean {
	const lower = name.toLowerCase();
	return (
		lower.includes("string") ||
		lower.includes("comment") ||
		lower.includes("regexp") ||
		lower.includes("regex") ||
		lower.includes("regular")
	);
}

function buildTheme(colors: readonly string[]) {
	const themeSpec: Record<string, { color: string }> = {};

	colors.forEach((color, index) => {
		const selector = `.cm-rainbowBracket-${index}`;
		themeSpec[selector] = { color: `${color} !important` };
		themeSpec[`${selector} span`] = { color: `${color} !important` };
	});

	return EditorView.baseTheme(themeSpec);
}

export function getRainbowBracketColors(
	themeConfig: RainbowBracketThemeConfig = {},
): string[] {
	const fallback = themeConfig.dark
		? DEFAULT_DARK_COLORS
		: DEFAULT_LIGHT_COLORS;

	const configuredColors: string[] = [];

	for (const candidate of themeConfig.bracketColors || []) {
		const color = normalizeHexColor(candidate);

		if (color && !configuredColors.includes(color)) {
			configuredColors.push(color);
		}
	}

	if (configuredColors.length >= 3) {
		for (const fallbackColor of fallback) {
			if (configuredColors.length >= 6) {
				break;
			}

			if (!configuredColors.includes(fallbackColor)) {
				configuredColors.push(fallbackColor);
			}
		}

		return configuredColors.slice(0, 6);
	}

	const colors: string[] = [];
	const seen = new Set<string>();

	for (const candidate of [
		themeConfig.keyword,
		themeConfig.type,
		themeConfig.class,
		themeConfig.function,
		themeConfig.string,
		themeConfig.number,
		themeConfig.constant,
		themeConfig.variable,
		themeConfig.foreground,
	]) {
		const color = normalizeHexColor(candidate);

		if (!color || seen.has(color)) {
			continue;
		}

		seen.add(color);
		colors.push(color);

		if (colors.length === fallback.length) {
			break;
		}
	}

	if (colors.length < 4) {
		return [...fallback];
	}

	for (const fallbackColor of fallback) {
		if (colors.length === fallback.length) {
			break;
		}

		if (seen.has(fallbackColor)) {
			continue;
		}

		seen.add(fallbackColor);
		colors.push(fallbackColor);
	}

	return colors;
}
export function rainbowBrackets(options: RainbowBracketsOptions = {}) {
	const colors =
		options.colors != null && options.colors.length > 0
			? [...options.colors]
			: getRainbowBracketColors({ dark: true });
	const exactScanLimit = Math.max(
		MIN_LOOK_BEHIND,
		Math.floor(options.exactScanLimit || DEFAULT_EXACT_SCAN_LIMIT),
	);
	const lookBehind = clampLookBehind(options.lookBehind);
	const theme = buildTheme(colors);
	const marks = colors.map((_, index) =>
		Decoration.mark({ class: `cm-rainbowBracket-${index}` }),
	);

	const rainbowBracketsPlugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			raf = 0;
			pendingView: EditorView | null = null;

			constructor(view: EditorView) {
				this.decorations = this.buildDecorations(view);
			}

			update(update: ViewUpdate) {
				if (!update.docChanged && !update.viewportChanged) return;
				if (update.docChanged) {
					this.decorations = this.decorations.map(update.changes);
				}
				this.scheduleBuild(update.view);
			}

			scheduleBuild(view: EditorView): void {
				this.pendingView = view;
				if (this.raf) return;
				this.raf = requestAnimationFrame(() => {
					this.raf = 0;
					const pendingView = this.pendingView;
					this.pendingView = null;
					if (!pendingView) return;
					this.decorations = this.buildDecorations(pendingView);
					pendingView.dispatch({});
				});
			}

			buildDecorations(view: EditorView): DecorationSet {
				const visibleRanges = view.visibleRanges;
				if (!visibleRanges.length || !marks.length) return Decoration.none;

				const tree = syntaxTree(view.state);
				if (tree.length <= 0) return Decoration.none;

				const scanStart = getScanStart(view, lookBehind, exactScanLimit);
				const scanEnd = visibleRanges[visibleRanges.length - 1].to;
				const openBrackets: BracketInfo[] = [];
				const builder = new RangeSetBuilder<Decoration>();

				let visibleRangeIndex = 0;
				const isVisible = (pos: number): boolean => {
					while (
						visibleRangeIndex < visibleRanges.length &&
						pos >= visibleRanges[visibleRangeIndex].to
					) {
						visibleRangeIndex++;
					}
					const range = visibleRanges[visibleRangeIndex];
					return !!range && pos >= range.from && pos < range.to;
				};

				const ignoredRanges: Array<{ from: number; to: number }> = [];

tree.iterate({
	from: scanStart,
	to: scanEnd,
	enter(node) {
		if (isSkipContext(node.name)) {
			ignoredRanges.push({
				from: node.from,
				to: node.to,
			});

			return false;
		}
	},
});

const source = view.state.doc.sliceString(scanStart, scanEnd);
let ignoredRangeIndex = 0;

for (let offset = 0; offset < source.length; offset++) {
	const pos = scanStart + offset;

	while (
		ignoredRangeIndex < ignoredRanges.length &&
		ignoredRanges[ignoredRangeIndex].to <= pos
	) {
		ignoredRangeIndex++;
	}

	const ignoredRange = ignoredRanges[ignoredRangeIndex];

	if (ignoredRange && pos >= ignoredRange.from) {
		offset = Math.min(
			source.length - 1,
			ignoredRange.to - scanStart - 1,
		);
		continue;
	}

	const char = source[offset];

	if (isOpeningBracket(char)) {
		const colorIndex = openBrackets.length % marks.length;

		if (isVisible(pos)) {
			builder.add(pos, pos + 1, marks[colorIndex]);
		}

		openBrackets.push({
			char,
			colorIndex,
		});

		continue;
	}

	if (char !== ")" && char !== "]" && char !== "}") {
		continue;
	}

	const matchingOpen = CLOSING_TO_OPENING[char as ClosingBracket];

	for (let index = openBrackets.length - 1; index >= 0; index--) {
		if (openBrackets[index].char !== matchingOpen) {
			continue;
		}

		if (isVisible(pos)) {
			builder.add(
				pos,
				pos + 1,
				marks[openBrackets[index].colorIndex],
			);
		}

		openBrackets.length = index;
		break;
	}
}

							if (isOpeningBracket(name)) {
								const colorIndex = openBrackets.length % marks.length;
								if (isVisible(pos)) {
									builder.add(pos, pos + 1, marks[colorIndex]);
								}
								openBrackets.push({ char: name, colorIndex });
							} else {
								const matchingOpen = CLOSING_TO_OPENING[name as ClosingBracket];
								if (!matchingOpen) return;

								for (let index = openBrackets.length - 1; index >= 0; index--) {
									if (openBrackets[index].char !== matchingOpen) continue;

									if (isVisible(pos)) {
										builder.add(
											pos,
											pos + 1,
											marks[openBrackets[index].colorIndex],
										);
									}
									openBrackets.length = index;
									break;
								}
							}
						}
					},
				});

				return builder.finish();
			}

			destroy(): void {
				if (this.raf) {
					cancelAnimationFrame(this.raf);
					this.raf = 0;
				}
				this.pendingView = null;
			}
		},
		{
			decorations: (value) => value.decorations,
		},
	);

	return [rainbowBracketsPlugin, theme];
}

export default rainbowBrackets;
