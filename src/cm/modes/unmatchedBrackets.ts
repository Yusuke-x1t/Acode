import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";

type OpenBracket = {
	char: "(" | "[" | "{";
	from: number;
};

type Interpolation = {
	from: number;
	baseDepth: number;
};

const bracketPairs: Record<string, OpenBracket["char"]> = {
	")": "(",
	"]": "[",
	"}": "{",
};

const unmatchedBracketMark = Decoration.mark({ class: "cm-unmatched-bracket" });

function readLongBracketOpen(text: string, from: number) {
	if (text.charAt(from) !== "[") return null;

	let pos = from + 1;
	while (text.charAt(pos) === "=") pos++;
	if (text.charAt(pos) !== "[") return null;

	return {
		level: pos - from - 1,
		contentFrom: pos + 1,
	};
}

function skipLongBracket(text: string, contentFrom: number, level: number) {
	const close = `]${"=".repeat(level)}]`;
	const closeAt = text.indexOf(close, contentFrom);
	return closeAt === -1 ? text.length : closeAt + close.length;
}

function skipQuotedString(text: string, from: number, quote: string) {
	let pos = from + 1;
	while (pos < text.length) {
		const char = text.charAt(pos);
		if (char === "\\") {
			pos += 2;
			continue;
		}
		if (char === quote) return pos + 1;
		pos++;
	}
	return text.length;
}

function scanTemplate(
	text: string,
	from: number,
	brackets: OpenBracket[],
	invalid: Set<number>,
): number {
	let pos = from + 1;

	while (pos < text.length) {
		const char = text.charAt(pos);

		if (char === "\\") {
			pos += 2;
			continue;
		}
		if (char === "`") return pos + 1;
		if (char === "{") {
			const baseDepth = brackets.length;
			brackets.push({ char: "{", from: pos });
			pos = scanCode(text, pos + 1, brackets, invalid, {
				from: pos,
				baseDepth,
			});
			continue;
		}
		pos++;
	}

	return text.length;
}

function scanCode(
	text: string,
	from: number,
	brackets: OpenBracket[],
	invalid: Set<number>,
	interpolation?: Interpolation,
): number {
	let pos = from;

	while (pos < text.length) {
		const char = text.charAt(pos);

		if (interpolation && char === "}") {
			const top = brackets[brackets.length - 1];
			if (
				brackets.length === interpolation.baseDepth + 1 &&
				top?.char === "{" &&
				top.from === interpolation.from
			) {
				brackets.pop();
				return pos + 1;
			}
		}

		if (char === "-" && text.charAt(pos + 1) === "-") {
			const longComment = readLongBracketOpen(text, pos + 2);
			if (longComment) {
				pos = skipLongBracket(text, longComment.contentFrom, longComment.level);
			} else {
				const newline = text.indexOf("\n", pos + 2);
				pos = newline === -1 ? text.length : newline + 1;
			}
			continue;
		}

		if (char === "'" || char === '"') {
			pos = skipQuotedString(text, pos, char);
			continue;
		}

		if (char === "`") {
			pos = scanTemplate(text, pos, brackets, invalid);
			continue;
		}

		if (char === "[") {
			const longString = readLongBracketOpen(text, pos);
			if (longString) {
				pos = skipLongBracket(text, longString.contentFrom, longString.level);
				continue;
			}
			brackets.push({ char: "[", from: pos });
			pos++;
			continue;
		}

		if (char === "(" || char === "{") {
			brackets.push({ char, from: pos });
			pos++;
			continue;
		}

		if (char === ")" || char === "]" || char === "}") {
			const top = brackets[brackets.length - 1];
			if (top && top.char === bracketPairs[char]) {
				if (invalid.has(top.from)) invalid.add(pos);
				brackets.pop();
			} else {
				invalid.add(pos);
				if (top) invalid.add(top.from);
				for (let index = brackets.length - 1; index >= 0; index--) {
					if (brackets[index].char === bracketPairs[char]) {
						invalid.add(brackets[index].from);
						break;
					}
				}
			}
			pos++;
			continue;
		}

		pos++;
	}

	return text.length;
}

function buildUnmatchedBrackets(view: EditorView): DecorationSet {
	const text = view.state.doc.toString();
	const openBrackets: OpenBracket[] = [];
	const invalidPositions = new Set<number>();

	scanCode(text, 0, openBrackets, invalidPositions);
	for (const bracket of openBrackets) invalidPositions.add(bracket.from);

	const ranges = [...invalidPositions]
		.sort((a, b) => a - b)
		.map((from) => unmatchedBracketMark.range(from, from + 1));

	return Decoration.set(ranges, true);
}

export const unmatchedBracketExtension = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = buildUnmatchedBrackets(view);
		}

		update(update: ViewUpdate) {
			if (update.docChanged) this.decorations = buildUnmatchedBrackets(update.view);
		}
	},
	{
		decorations: (value) => value.decorations,
	},
);
