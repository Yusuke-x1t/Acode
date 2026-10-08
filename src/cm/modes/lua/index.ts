import {
	IndentContext,
	LanguageSupport,
	StreamLanguage,
	StringStream,
} from "@codemirror/language";
import { lua as legacyLua } from "@codemirror/legacy-modes/mode/lua";

type DocExpectation =
	| "none"
	| "paramName"
	| "paramType"
	| "fieldName"
	| "fieldType"
	| "type"
	| "class"
	| "generic"
	| "castVariable"
	| "castType";

type LuaState = {
	inner: unknown;
	docLine: boolean;
	docExpectation: DocExpectation;
};

const annotationTypeTags = new Set([
	"@type",
	"@return",
	"@class",
	"@alias",
	"@enum",
	"@cast",
	"@overload",
	"@field",
]);

const variableTags = new Set([
	"@param",
	"@field",
	"@cast",
]);

function isWordStart(char: string) {
	return /[A-Za-z_]/.test(char);
}

function isWord(char: string) {
	return /[A-Za-z0-9_]/.test(char);
}

function resetDocState(state: LuaState) {
	state.docLine = false;
	state.docExpectation = "none";
}

function copyLegacyState(state: unknown) {
	if (typeof legacyLua.copyState === "function") {
		return legacyLua.copyState(state);
	}
	return state;
}

function tokenDocComment(stream: StringStream, state: LuaState) {
	if (stream.eatSpace()) return null;

	if (stream.match(/@[A-Za-z_][A-Za-z0-9_]*/)) {
		const tag = stream.current();

		if (tag === "@param") {
			state.docExpectation = "paramName";
		} else if (tag === "@field") {
			state.docExpectation = "fieldName";
		} else if (tag === "@cast") {
			state.docExpectation = "castVariable";
		} else if (tag === "@class") {
			state.docExpectation = "class";
		} else if (tag === "@generic") {
			state.docExpectation = "generic";
		} else if (annotationTypeTags.has(tag)) {
			state.docExpectation = "type";
		} else {
			state.docExpectation = "none";
		}

		return "annotation";
	}

	const peek = stream.peek() || "";

	if (state.docExpectation === "paramName" && isWordStart(peek)) {
		stream.next();
		stream.eatWhile(isWord);
		state.docExpectation = "paramType";
		return "variableName";
	}

	if (state.docExpectation === "fieldName" && isWordStart(peek)) {
		stream.next();
		stream.eatWhile(isWord);
		state.docExpectation = "fieldType";
		return "propertyName";
	}

	if (state.docExpectation === "castVariable" && isWordStart(peek)) {
		stream.next();
		stream.eatWhile(isWord);
		state.docExpectation = "castType";
		return "variableName";
	}

	if (
		(state.docExpectation === "paramType" ||
			state.docExpectation === "fieldType" ||
			state.docExpectation === "castType" ||
			state.docExpectation === "type" ||
			state.docExpectation === "class" ||
			state.docExpectation === "generic") &&
		(peek === "?" ||
			peek === "{" ||
			peek === "(" ||
			peek === "[" ||
			isWordStart(peek))
	) {
		stream.next();
		stream.eatWhile((char) => !/\s/.test(char));
		state.docExpectation = "none";
		return "typeName";
	}

	stream.skipToEnd();
	state.docExpectation = "none";
	return "comment";
}

const luaLanguage = StreamLanguage.define<LuaState>({
	name: "lua",

	startState() {
		return {
			inner: legacyLua.startState(),
			docLine: false,
			docExpectation: "none",
		};
	},

	copyState(state) {
		return {
			inner: copyLegacyState(state.inner),
			docLine: state.docLine,
			docExpectation: state.docExpectation,
		};
	},

	token(stream, state) {
		if (stream.sol()) {
			resetDocState(state);

			const line = stream.string.slice(stream.pos);

			if (/^\s*---/.test(line)) {
				state.docLine = true;
			}
		}

		if (stream.eatSpace()) return null;

		if (state.docLine) {
			if (stream.match("---")) {
				return "comment";
			}

			return tokenDocComment(stream, state);
		}

		return legacyLua.token(stream, state.inner);
	},

	indent(state, textAfter, context: IndentContext) {
		return legacyLua.indent(state.inner, textAfter, context);
	},

	languageData: {
		commentTokens: {
			line: "--",
			block: {
				open: "--[[",
				close: "]]",
			},
		},
		closeBrackets: {
			brackets: ["(", "[", "{", '"', "'"],
		},
		indentOnInput: /^\s*(?:end|until|else|elseif|\)|\})$/,
	},
});

export function lua() {
	return new LanguageSupport(luaLanguage);
}

export { luaLanguage };
