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
	| "castVariable"
	| "castType"
	| "type"
	| "class"
	| "generic"
	| "alias";

type LuaState = {
	inner: unknown;
	docLine: boolean;
	docExpectation: DocExpectation;
	expectFunctionName: boolean;
	expectLabel: boolean;
	afterPropertyAccess: boolean;
	forHeader: boolean;
	afterFunctionName: boolean;
	inFunctionParams: boolean;
	functionParamsDepth: number;
	lastStandardNamespace: string | null;
};

const controlKeywords = new Set([
	"break",
	"do",
	"else",
	"elseif",
	"end",
	"for",
	"function",
	"goto",
	"if",
	"in",
	"repeat",
	"return",
	"then",
	"until",
	"while",
]);

const modifierKeywords = new Set([
	"local",
]);

const logicalKeywords = new Set([
	"and",
	"not",
	"or",
]);

const standardNamespaces = new Set([
	"coroutine",
	"debug",
	"io",
	"math",
	"os",
	"package",
	"string",
	"table",
	"utf8",
]);

const constantLanguage = new Set([
	"_ENV",
	"_G",
	"_VERSION",
	"false",
	"nil",
	"true",
	"math.pi",
	"math.huge",
	"math.maxinteger",
	"math.mininteger",
	"utf8.charpattern",
	"io.stdin",
	"io.stdout",
	"io.stderr",
	"package.config",
	"package.cpath",
	"package.loaded",
	"package.loaders",
	"package.path",
	"package.preload",
	"package.searchers",
	"...",
]);

const standardConstantMembers: Record<string, Set<string>> = {
	math: new Set(["pi", "huge", "maxinteger", "mininteger"]),
	utf8: new Set(["charpattern"]),
	io: new Set(["stdin", "stdout", "stderr"]),
	package: new Set([
		"config",
		"cpath",
		"loaded",
		"loaders",
		"path",
		"preload",
		"searchers",
	]),
};

const annotationTags = new Set([
	"@alias",
	"@as",
	"@async",
	"@cast",
	"@class",
	"@diagnostic",
	"@deprecated",
	"@enum",
	"@field",
	"@generic",
	"@meta",
	"@module",
	"@nodiscard",
	"@operator",
	"@overload",
	"@package",
	"@param",
	"@return",
	"@see",
	"@source",
	"@type",
	"@using",
	"@vararg",
	"@version",
]);

const parameterAnnotations = new Set([
	"@param",
]);

const fieldAnnotations = new Set([
	"@field",
]);

const castAnnotations = new Set([
	"@cast",
]);

const typeAnnotations = new Set([
	"@type",
	"@return",
	"@class",
	"@alias",
	"@enum",
	"@overload",
	"@generic",
]);

const docModifiers = new Set([
	"private",
	"protected",
	"public",
	"package",
]);

function isWordStart(char: string) {
	return /[A-Za-z_]/.test(char);
}

function isWord(char: string) {
	return /[A-Za-z0-9_]/.test(char);
}

function isUpperConstant(word: string) {
	return /^[A-Z_][A-Z0-9_]*$/.test(word);
}

function isCallbackAssignment(stream: StringStream) {
	return /^\s*=\s*[A-Za-z_][A-Za-z0-9_]*(?:\s*[.:]\s*[A-Za-z_][A-Za-z0-9_]*)*\s*\(\s*function\s*\(/.test(
		stream.string.slice(stream.pos),
	);
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

		if (!annotationTags.has(tag)) {
			state.docExpectation = "none";
			return "comment";
		}

		if (parameterAnnotations.has(tag)) {
			state.docExpectation = "paramName";
			return "annotation";
		}

		if (fieldAnnotations.has(tag)) {
			state.docExpectation = "fieldName";
			return "annotation";
		}

		if (castAnnotations.has(tag)) {
			state.docExpectation = "castVariable";
			return "annotation";
		}

		if (tag === "@class") {
			state.docExpectation = "class";
			return "annotation";
		}

		if (tag === "@alias") {
			state.docExpectation = "alias";
			return "annotation";
		}

		if (tag === "@generic") {
			state.docExpectation = "generic";
			return "annotation";
		}

		if (typeAnnotations.has(tag)) {
			state.docExpectation = "type";
			return "annotation";
		}

		state.docExpectation = "none";
		return "annotation";
	}

	const peek = stream.peek() || "";

	if (state.docExpectation === "paramName" && isWordStart(peek)) {
		stream.next();
		stream.eatWhile(isWord);

		state.docExpectation = "paramType";
		return "variableName";
	}

	if (state.docExpectation === "paramName" && peek === ".") {
		if (stream.match("...")) {
			state.docExpectation = "paramType";
			return "variableName";
		}
	}

	if (state.docExpectation === "fieldName") {
		if (isWordStart(peek)) {
			const wordStart = stream.pos;

			stream.next();
			stream.eatWhile(isWord);

			const word = stream.string.slice(wordStart, stream.pos);

			if (docModifiers.has(word)) {
				return "modifier";
			}

			state.docExpectation = "fieldType";
			return "propertyName";
		}
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
			state.docExpectation === "generic" ||
			state.docExpectation === "alias") &&
		(peek === "?" ||
			peek === "{" ||
			peek === "(" ||
			peek === "[" ||
			peek === "`" ||
			peek === "'" ||
			peek === '"' ||
			peek === "|" ||
			peek === "." ||
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

function classifyVariable(
	stream: StringStream,
	state: LuaState,
	word: string,
	legacyStyle: string | null,
) {
	if (state.expectLabel) {
		state.expectLabel = false;
		state.afterFunctionName = false;
		state.lastStandardNamespace = null;
		return "labelName";
	}

	if (state.expectFunctionName) {
		const isQualifiedFunctionName = /^\s*[.:]\s*[A-Za-z_]/.test(
			stream.string.slice(stream.pos),
		);
		state.expectFunctionName = false;
		state.afterFunctionName = true;
		state.afterPropertyAccess = false;
		state.lastStandardNamespace = null;
		return isQualifiedFunctionName
			? "variableName"
			: "variableName.function.definition";
	}

	if (state.forHeader || state.inFunctionParams) {
		state.afterFunctionName = false;
		state.lastStandardNamespace = null;
		return "variableName.special";
	}

	if (constantLanguage.has(word)) {
		state.afterFunctionName = false;
		state.lastStandardNamespace = null;
		return "constant.language";
	}

	if (state.afterPropertyAccess) {
		const standardParent = state.lastStandardNamespace;
		const isFunctionDefinition = state.afterFunctionName;
		const isCall = /^\s*\(/.test(stream.string.slice(stream.pos));

		state.afterPropertyAccess = false;
		state.lastStandardNamespace = null;
		state.afterFunctionName = isFunctionDefinition;

		if (
			standardParent &&
			standardConstantMembers[standardParent]?.has(word)
		) {
			state.afterFunctionName = false;
			return "constant.language";
		}

		if (isFunctionDefinition && isCall) {
			return "propertyName.function.definition";
		}

		if (isCall) {
			state.afterFunctionName = false;
			return "propertyName.function";
		}

		return "propertyName";
	}

	if (standardNamespaces.has(word)) {
		state.afterFunctionName = false;
		state.lastStandardNamespace = word;
		return "namespace.standard";
	}

	if (isCallbackAssignment(stream)) {
		state.afterFunctionName = false;
		state.lastStandardNamespace = null;
		return "variableName.special";
	}

	if (legacyStyle === "builtin") {
		state.afterFunctionName = false;
		state.lastStandardNamespace = null;
		return "variableName.function.standard";
	}

	if (/^\s*\(/.test(stream.string.slice(stream.pos))) {
		state.afterFunctionName = false;
		state.lastStandardNamespace = null;
		return "variableName.function";
	}

	if (word === "self") {
		state.afterFunctionName = false;
		state.lastStandardNamespace = null;
		return "variableName";
	}

	if (isUpperConstant(word)) {
		state.afterFunctionName = false;
		state.lastStandardNamespace = null;
		return "variableName.constant";
	}

	state.afterFunctionName = false;
	state.lastStandardNamespace = null;
	return "variableName";
}

const luaLanguage = StreamLanguage.define<LuaState>({
	name: "lua",

	startState() {
		return {
			inner: legacyLua.startState(),
			docLine: false,
			docExpectation: "none",
			expectFunctionName: false,
			expectLabel: false,
			afterPropertyAccess: false,
			forHeader: false,
			afterFunctionName: false,
			inFunctionParams: false,
			functionParamsDepth: 0,
			lastStandardNamespace: null,
		};
	},

	copyState(state) {
		return {
			inner: copyLegacyState(state.inner),
			docLine: state.docLine,
			docExpectation: state.docExpectation,
			expectFunctionName: state.expectFunctionName,
			expectLabel: state.expectLabel,
			afterPropertyAccess: state.afterPropertyAccess,
			forHeader: state.forHeader,
			afterFunctionName: state.afterFunctionName,
			inFunctionParams: state.inFunctionParams,
			functionParamsDepth: state.functionParamsDepth,
			lastStandardNamespace: state.lastStandardNamespace,
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

		const style = legacyLua.token(stream, state.inner);
		const word = stream.current();

		const startsFunctionParams =
			word === "(" &&
			(state.expectFunctionName || state.afterFunctionName);

		if (startsFunctionParams) {
			state.expectFunctionName = false;
			state.afterFunctionName = false;
			state.inFunctionParams = true;
			state.functionParamsDepth = 1;
			state.lastStandardNamespace = null;
			state.afterPropertyAccess = false;
		} else if (word === "(" && state.inFunctionParams) {
			state.functionParamsDepth++;
			state.lastStandardNamespace = null;
		}

		if (word === ")" && state.inFunctionParams) {
			state.functionParamsDepth--;

			if (state.functionParamsDepth <= 0) {
				state.inFunctionParams = false;
				state.functionParamsDepth = 0;
			}

			state.afterFunctionName = false;
			state.lastStandardNamespace = null;
			state.afterPropertyAccess = false;
		}

		if (word === "[" || word === "{") {
			state.lastStandardNamespace = null;
		}

		if (state.forHeader && word === "=") {
			state.forHeader = false;
		}

		if (style === "comment" || style === "string" || style === "number") {
			state.afterPropertyAccess = false;
			state.lastStandardNamespace = null;
			state.afterFunctionName = false;
			return style;
		}

		if (style === "keyword") {
			state.lastStandardNamespace = null;

			if (word === "for") {
				state.forHeader = true;
			} else if (word === "in" || word === "do") {
				state.forHeader = false;
			}

			if (word === "local") {
				state.afterPropertyAccess = false;
				return "modifier";
			}

			if (logicalKeywords.has(word)) {
				state.afterPropertyAccess = false;
				return "modifier";
			}

			if (word === "function") {
				state.expectFunctionName = true;
				state.afterFunctionName = false;
				state.afterPropertyAccess = false;
				return "controlKeyword";
			}

			if (word === "goto") {
				state.expectLabel = true;
				state.afterPropertyAccess = false;
				return "controlKeyword";
			}

			if (word === "true" || word === "false") {
				state.afterPropertyAccess = false;
				return "bool";
			}

			if (word === "nil") {
				state.afterPropertyAccess = false;
				return "null";
			}

			if (controlKeywords.has(word)) {
				state.afterPropertyAccess = false;
				return "controlKeyword";
			}

			state.afterPropertyAccess = false;
			return "keyword";
		}

		if (style === "builtin") {
			return classifyVariable(stream, state, word, style);
		}

		if (style === "variable") {
			return classifyVariable(stream, state, word, style);
		}

		if (word === ".") {
			state.afterPropertyAccess = true;
			return "operator";
		}

		if (word === ":") {
			state.afterPropertyAccess = true;
			state.lastStandardNamespace = null;
			return "operator";
		}

		if (word === "::") {
			state.afterPropertyAccess = false;
			state.afterFunctionName = false;
			state.lastStandardNamespace = null;
			return "punctuation";
		}

		if (word === "...") {
			state.afterPropertyAccess = false;
			state.afterFunctionName = false;
			state.lastStandardNamespace = null;
			return "constant.language";
		}

		state.afterPropertyAccess = false;
		state.afterFunctionName = false;
		state.lastStandardNamespace = null;
		return style;
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
