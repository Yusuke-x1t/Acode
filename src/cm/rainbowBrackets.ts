import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";

const DEFAULT_DARK_COLORS = [
	"#FFD700",
	"#DA70D6",
	"#179FFF",
];

const DEFAULT_LIGHT_COLORS = [
	"#795e26",
	"#af00db",
	"#005cc5",
];

const DEFAULT_UNEXPECTED_BRACKET_COLOR = "#F44747";

const CLOSING_TO_OPENING: Record<string, string> = {
	")": "(",
	"]": "[",
	"}": "{",
};

const OPENING_BRACKETS = new Set(["(", "[", "{"]);
const CLOSING_BRACKETS = new Set([")", "]", "}"]);

const MAX_PARSE_DEPTH = 300;
const MAX_COLOR_DEPTH = 200;

type BracketToken = {
	char: string;
	pos: number;
	colorIndex: number | null;
	unexpected: boolean;
};

type BracketPairNode = {
	kind: "pair";
	open: BracketToken;
	close: BracketToken | null;
	children: BracketTreeNode[];
};

type UnexpectedBracketNode = {
	kind: "unexpected";
	token: BracketToken;
};

type BracketTreeNode =
	| BracketPairNode
	| UnexpectedBracketNode;

type IgnoredRange = {
	from: number;
	to: number;
};

export interface RainbowBracketThemeConfig {
	dark?: boolean;
	bracketColors?: readonly string[];
	unexpectedBracketColor?: string;
}

export interface RainbowBracketsOptions {
	colors?: readonly string[];
	unexpectedBracketColor?: string;
	exactScanLimit?: number;
	lookBehind?: number;
}

function normalizeHexColor(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const color = value.trim();

	if (/^#([\da-f]{3}|[\da-f]{6})$/i.test(color)) {
		return color.toLowerCase();
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

function buildTheme(
	colors: readonly string[],
	unexpectedBracketColor: string,
) {
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

	const unexpectedSelector =
		".cm-rainbowBracket-unexpected";

	themeSpec[unexpectedSelector] = {
		color: `${unexpectedBracketColor} !important`,
	};

	themeSpec[`${unexpectedSelector} span`] = {
		color: `${unexpectedBracketColor} !important`,
	};

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

		if (!color || seen.has(color)) {
			continue;
		}

		seen.add(color);
		colors.push(color);

		if (colors.length === 3) {
			break;
		}
	}

	for (const candidate of fallback) {
		if (colors.length === 3) {
			break;
		}

		const color = normalizeHexColor(candidate);

		if (!color || seen.has(color)) {
			continue;
		}

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

	ranges.sort(
		(a, b) =>
			a.from - b.from ||
			b.to - a.to,
	);

	const merged: IgnoredRange[] = [];

	for (const range of ranges) {
		const previous = merged[merged.length - 1];

		if (previous && range.from <= previous.to) {
			previous.to = Math.max(
				previous.to,
				range.to,
			);
		} else {
			merged.push({ ...range });
		}
	}

	return merged;
}

function matchesOpeningBracket(
	opening: string,
	closing: string,
): boolean {
	return CLOSING_TO_OPENING[closing] === opening;
}

function parseBracketTree(
	tokens: BracketToken[],
): BracketTreeNode[] {
	let cursor = 0;

	function parseList(
		openedBrackets: readonly string[],
		depth: number,
	): BracketTreeNode[] {
		const nodes: BracketTreeNode[] = [];

		while (cursor < tokens.length) {
			const token = tokens[cursor];

			if (CLOSING_BRACKETS.has(token.char)) {
				const matchingOpening =
					CLOSING_TO_OPENING[token.char];

				if (
					openedBrackets.includes(
						matchingOpening,
					)
				) {
					break;
				}

				cursor++;

				nodes.push({
					kind: "unexpected",
					token,
				});

				continue;
			}

			if (!OPENING_BRACKETS.has(token.char)) {
				cursor++;
				continue;
			}

			cursor++;

			if (depth >= MAX_PARSE_DEPTH) {
				continue;
			}

			const children = parseList(
				[
					...openedBrackets,
					token.char,
				],
				depth + 1,
			);

			let close: BracketToken | null = null;

			const nextToken = tokens[cursor];

			if (
				nextToken &&
				CLOSING_BRACKETS.has(nextToken.char) &&
				matchesOpeningBracket(
					token.char,
					nextToken.char,
				)
			) {
				close = nextToken;
				cursor++;
			}

			nodes.push({
				kind: "pair",
				open: token,
				close,
				children,
			});
		}

		return nodes;
	}

	return parseList([], 0);
}

function collectBrackets(
	source: string,
	ignoredRanges: IgnoredRange[],
): {
	tokens: BracketToken[];
	nodes: BracketTreeNode[];
} {
	const tokens: BracketToken[] = [];

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

		tokens.push({
			char,
			pos,
			colorIndex: null,
			unexpected: false,
		});
	}

	return {
		tokens,
		nodes: parseBracketTree(tokens),
	};
}

function assignPairColors(
	nodes: BracketTreeNode[],
	colorCount: number,
	depth = 0,
): void {
	if (depth > MAX_COLOR_DEPTH) {
		return;
	}

	for (const node of nodes) {
		if (node.kind === "unexpected") {
			node.token.unexpected = true;
			continue;
		}

		if (depth < MAX_COLOR_DEPTH) {
			const colorIndex = depth % colorCount;

			node.open.colorIndex = colorIndex;

			if (node.close) {
				node.close.colorIndex = colorIndex;
			}
		}

		assignPairColors(
			node.children,
			colorCount,
			depth + 1,
		);
	}
}

function getBracketColors(
	configuredColors?: readonly string[],
): string[] {
	const colors: string[] = [];

	for (const candidate of configuredColors || []) {
		const color = normalizeHexColor(candidate);

		if (!color || colors.includes(color)) {
			continue;
		}

		colors.push(color);

		if (colors.length === 3) {
			break;
		}
	}

	for (const candidate of DEFAULT_DARK_COLORS) {
		if (colors.length === 3) {
			break;
		}

		const color = normalizeHexColor(candidate);

		if (!color || colors.includes(color)) {
			continue;
		}

		colors.push(color);
	}

	return colors;
}

function isVisiblePosition(
	pos: number,
	visibleRanges: readonly {
		from: number;
		to: number;
	}[],
): boolean {
	for (const range of visibleRanges) {
		if (pos < range.from) {
			return false;
		}

		if (pos < range.to) {
			return true;
		}
	}

	return false;
}

export function rainbowBrackets(
	options: RainbowBracketsOptions = {},
) {
	const colors = getBracketColors(options.colors);

	const unexpectedBracketColor =
		normalizeHexColor(
			options.unexpectedBracketColor,
		) || DEFAULT_UNEXPECTED_BRACKET_COLOR;

	const theme = buildTheme(
		colors,
		unexpectedBracketColor,
	);

	const marks = colors.map((_, index) =>
		Decoration.mark({
			class: `cm-rainbowBracket-${index}`,
		}),
	);

	const unexpectedMark = Decoration.mark({
		class: "cm-rainbowBracket-unexpected",
	});

	const rainbowBracketsPlugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			raf = 0;

			pendingView: EditorView | null = null;

			view: EditorView;

			destroyed = false;

			needsResumeRefresh = false;

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

				if (document.visibilityState !== "visible") {
	this.needsResumeRefresh = true;
	this.cancelScheduledBuild();
	return;
}

this.scheduleBuild(update.view);
			}

			handleVisibilityChange = () => {
				if (document.visibilityState !== "visible") {
					this.needsResumeRefresh = true;
					this.cancelScheduledBuild();
					return;
				}

				this.refreshAfterResume();
			};

			handleResume = () => {
				if (document.visibilityState === "visible") {
					this.refreshAfterResume(true);
				}
			};

			refreshAfterResume(force = false) {
				if (
					this.destroyed ||
					(!force && !this.needsResumeRefresh)
				) {
					return;
				}

				this.needsResumeRefresh = false;
				this.cancelScheduledBuild();

				this.decorations = this.buildDecorations(this.view);
				this.view.update([]);
			}

			cancelScheduledBuild() {
				if (this.raf) {
					cancelAnimationFrame(this.raf);
					this.raf = 0;
				}

				this.pendingView = null;
			}

			forceScheduleBuild(view: EditorView) {
				if (this.destroyed) {
					return;
				}

				this.cancelScheduledBuild();
				this.scheduleBuild(view);
			}

			scheduleBuild(view: EditorView) {
				this.view = view;
				this.pendingView = view;

				if (this.raf || this.destroyed) {
					return;
				}

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

			buildDecorations(
				view: EditorView,
			): DecorationSet {
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

				const { tokens, nodes } = collectBrackets(
					source,
					ignoredRanges,
				);

				assignPairColors(
					nodes,
					colors.length,
				);

				const builder =
					new RangeSetBuilder<Decoration>();

				for (const token of tokens) {
					if (
						!isVisiblePosition(
							token.pos,
							visibleRanges,
						)
					) {
						continue;
					}

					if (token.unexpected) {
						builder.add(
							token.pos,
							token.pos + 1,
							unexpectedMark,
						);

						continue;
					}

					if (token.colorIndex === null) {
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
