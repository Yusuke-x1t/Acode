import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";

const DEFAULT_DARK_COLORS = [
	"#FFD700",
	"#DA70D6",
	"#179FFF",
	"#4EC9B0",
];

const DEFAULT_LIGHT_COLORS = [
	"#795e26",
	"#af00db",
	"#005cc5",
	"#008000",
];

const CLOSING_TO_OPENING: Record<string, string> = {
	")": "(",
	"]": "[",
	"}": "{",
};

const OPENING_BRACKETS = new Set(["(", "[", "{"]);
const CLOSING_BRACKETS = new Set([")", "]", "}"]);

type BracketToken = {
	char: string;
	pos: number;
	colorIndex: number;
};

type BracketPair = {
	openIndex: number;
	closeIndex: number;
};

type IgnoredRange = {
	from: number;
	to: number;
};

export interface RainbowBracketThemeConfig {
	dark?: boolean;
	bracketColors?: readonly string[];
}

export interface RainbowBracketsOptions {
	colors?: readonly string[];
	exactScanLimit?: number;
	lookBehind?: number;
}

function normalizeHexColor(value: unknown): string | null {
	if (typeof value !== "string") return null;

	const color = value.trim().toLowerCase();

	if (/^#([\da-f]{3}|[\da-f]{6})$/.test(color)) {
		return color;
	}

	return null;
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

		themeSpec[selector] = {
			color: `${color} !important`,
		};

		themeSpec[`${selector} span`] = {
			color: `${color} !important`,
		};
	});

	return EditorView.baseTheme(themeSpec);
}

export function getRainbowBracketColors(
	themeConfig: RainbowBracketThemeConfig = {},
): string[] {
	const fallback =
		themeConfig.dark === false
			? DEFAULT_LIGHT_COLORS
			: DEFAULT_DARK_COLORS;

	const colors: string[] = [];
	const seen = new Set<string>();

	for (const candidate of themeConfig.bracketColors || []) {
		const color = normalizeHexColor(candidate);

		if (!color || seen.has(color)) continue;

		seen.add(color);
		colors.push(color);

		if (colors.length === 4) break;
	}

	for (const color of fallback) {
		if (colors.length === 4) break;
		if (seen.has(color)) continue;

		seen.add(color);
		colors.push(color);
	}

	return colors;
}

function collectIgnoredRanges(
	view: EditorView,
	docLength: number,
): IgnoredRange[] {
	const ranges: IgnoredRange[] = [];
	const tree = syntaxTree(view.state);

	tree.iterate({
		from: 0,
		to: docLength,

		enter(node) {
			if (isSkipContext(node.name)) {
				ranges.push({
					from: node.from,
					to: node.to,
				});

				return false;
			}
		},
	});

	ranges.sort((a, b) => a.from - b.from || b.to - a.to);

	const merged: IgnoredRange[] = [];

	for (const range of ranges) {
		const previous = merged[merged.length - 1];

		if (previous && range.from <= previous.to) {
			previous.to = Math.max(previous.to, range.to);
		} else {
			merged.push({ ...range });
		}
	}

	return merged;
}

function collectBrackets(
	source: string,
	ignoredRanges: IgnoredRange[],
): {
	tokens: BracketToken[];
	pairs: BracketPair[];
} {
	const tokens: BracketToken[] = [];
	const pairs: BracketPair[] = [];
	const openStack: number[] = [];

	let ignoredIndex = 0;

	for (let pos = 0; pos < source.length; pos++) {
		while (
			ignoredIndex < ignoredRanges.length &&
			ignoredRanges[ignoredIndex].to <= pos
		) {
			ignoredIndex++;
		}

		const ignored = ignoredRanges[ignoredIndex];

		if (ignored && pos >= ignored.from) {
			pos = ignored.to - 1;
			continue;
		}

		const char = source[pos];

		if (
			!OPENING_BRACKETS.has(char) &&
			!CLOSING_BRACKETS.has(char)
		) {
			continue;
		}

		const tokenIndex = tokens.length;

		tokens.push({
			char,
			pos,
			colorIndex: 0,
		});

		if (OPENING_BRACKETS.has(char)) {
			openStack.push(tokenIndex);
			continue;
		}

		const matchingOpen = CLOSING_TO_OPENING[char];

		if (!matchingOpen) continue;

		let matchingStackIndex = -1;

		for (
			let index = openStack.length - 1;
			index >= 0;
			index--
		) {
			const openingToken = tokens[openStack[index]];

			if (openingToken.char === matchingOpen) {
				matchingStackIndex = index;
				break;
			}
		}

		if (matchingStackIndex === -1) {
			continue;
		}

		const openIndex = openStack[matchingStackIndex];

		openStack.length = matchingStackIndex;

		pairs.push({
			openIndex,
			closeIndex: tokenIndex,
		});
	}

	return {
		tokens,
		pairs,
	};
}

function assignPairColors(
	tokens: BracketToken[],
	pairs: BracketPair[],
	colorCount: number,
): void {
	pairs.sort(
		(a, b) =>
			tokens[a.openIndex].pos -
			tokens[b.openIndex].pos,
	);

	const nestedPairs: BracketPair[] = [];

	for (const pair of pairs) {
		const open = tokens[pair.openIndex];
		const close = tokens[pair.closeIndex];

		while (nestedPairs.length > 0) {
			const previous =
				nestedPairs[nestedPairs.length - 1];

			const previousClose =
				tokens[previous.closeIndex];

			if (previousClose.pos >= open.pos) {
				break;
			}

			nestedPairs.pop();
		}

		const colorIndex = nestedPairs.length % colorCount;

		open.colorIndex = colorIndex;
		close.colorIndex = colorIndex;

		nestedPairs.push(pair);
	}
}

function isVisiblePosition(
	pos: number,
	visibleRanges: readonly {
		from: number;
		to: number;
	}[],
): boolean {
	for (const range of visibleRanges) {
		if (pos < range.from) return false;
		if (pos < range.to) return true;
	}

	return false;
}

function getFourColors(
	configuredColors?: readonly string[],
): string[] {
	const colors: string[] = [];

	for (const candidate of configuredColors || []) {
		if (
			typeof candidate !== "string" ||
			!candidate.trim() ||
			colors.includes(candidate)
		) {
			continue;
		}

		colors.push(candidate);

		if (colors.length === 4) break;
	}

	for (const color of DEFAULT_DARK_COLORS) {
		if (colors.length === 4) break;
		if (colors.includes(color)) continue;

		colors.push(color);
	}

	return colors;
}

export function rainbowBrackets(
	options: RainbowBracketsOptions = {},
) {
	const colors = getFourColors(options.colors);
	const theme = buildTheme(colors);

	const marks = colors.map((_, index) =>
		Decoration.mark({
			class: `cm-rainbowBracket-${index}`,
		}),
	);

	const rainbowBracketsPlugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			raf = 0;

			pendingView: EditorView | null = null;

			view: EditorView;

			destroyed = false;

			constructor(view: EditorView) {
				this.view = view;
				this.decorations = this.buildDecorations(view);

				document.addEventListener(
					"visibilitychange",
					this.handleVisibilityChange,
				);

				window.addEventListener(
					"pageshow",
					this.handleResume,
				);

				window.addEventListener(
					"focus",
					this.handleResume,
				);
			}

			update(update: ViewUpdate) {
				this.view = update.view;

				const treeChanged =
					syntaxTree(update.startState) !==
					syntaxTree(update.state);

				if (
					!update.docChanged &&
					!update.viewportChanged &&
					!treeChanged
				) {
					return;
				}

				if (update.docChanged) {
					this.decorations =
						this.decorations.map(update.changes);
				}

				this.scheduleBuild(update.view);
			}

			handleVisibilityChange = () => {
				if (document.visibilityState !== "visible") {
					this.cancelScheduledBuild();
					return;
				}

				this.forceScheduleBuild(this.view);
			};

			handleResume = () => {
				if (document.visibilityState === "visible") {
					this.forceScheduleBuild(this.view);
				}
			};

			cancelScheduledBuild() {
				if (this.raf) {
					cancelAnimationFrame(this.raf);
					this.raf = 0;
				}

				this.pendingView = null;
			}

			forceScheduleBuild(view: EditorView) {
				if (this.destroyed) return;

				this.cancelScheduledBuild();
				this.scheduleBuild(view);
			}

			scheduleBuild(view: EditorView) {
				this.view = view;
				this.pendingView = view;

				if (this.raf || this.destroyed) return;

				this.raf = requestAnimationFrame(() => {
					this.raf = 0;

					const pendingView = this.pendingView;

					this.pendingView = null;

					if (!pendingView || this.destroyed) {
						return;
					}

					this.decorations =
						this.buildDecorations(pendingView);

					pendingView.update([]);
				});
			}

			buildDecorations(view: EditorView): DecorationSet {
				const visibleRanges = view.visibleRanges;

				if (!visibleRanges.length || !marks.length) {
					return Decoration.none;
				}

				const docLength = view.state.doc.length;

				if (docLength === 0) {
					return Decoration.none;
				}

				const tree = syntaxTree(view.state);

				if (tree.length === 0) {
					return Decoration.none;
				}

				const source = view.state.doc.sliceString(
					0,
					docLength,
				);

				const ignoredRanges = collectIgnoredRanges(
					view,
					docLength,
				);

				const { tokens, pairs } = collectBrackets(
					source,
					ignoredRanges,
				);

				assignPairColors(
					tokens,
					pairs,
					colors.length,
				);

				const builder = new RangeSetBuilder<Decoration>();

				for (const token of tokens) {
					if (
						!isVisiblePosition(
							token.pos,
							visibleRanges,
						)
					) {
						continue;
					}

					builder.add(
						token.pos,
						token.pos + 1,
						marks[token.colorIndex] || marks[0],
					);
				}

				return builder.finish();
			}

			destroy() {
				this.destroyed = true;

				this.cancelScheduledBuild();

				document.removeEventListener(
					"visibilitychange",
					this.handleVisibilityChange,
				);

				window.removeEventListener(
					"pageshow",
					this.handleResume,
				);

				window.removeEventListener(
					"focus",
					this.handleResume,
				);
			}
		},
		{
			decorations: (value) => value.decorations,
		},
	);

	return [rainbowBracketsPlugin, theme];
}

export default rainbowBrackets;
