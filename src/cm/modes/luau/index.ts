import {
	IndentContext,
	LanguageSupport,
	StreamLanguage,
	StringStream,
} from "@codemirror/language";

type Tokenizer = (stream: StringStream, state: LuauState) => string | null;

interface LuauState {
	basecol: number;
	indentDepth: number;
	cur: Tokenizer;
	stack: Tokenizer[];
	expectFunctionName: boolean;
	afterFunctionName: boolean;
	expectTypeName: boolean;
	afterTypeName: boolean;
	afterTypeIdentifier: boolean;
	inType: boolean;
	typeDepth: number;
	genericDepth: number;
	interpolationBraceDepth: number;
	afterPropertyAccess: boolean;
	lastIdentifierWasStandard: boolean;
	lastIdentifierWasProperty: boolean;
	expectLocalName: boolean;
	lastIdentifierWasDeclaration: boolean;
	inFunctionParams: boolean;
	functionParamsDepth: number;
	functionGenericParams: boolean;
	docCommentExpectParamName: boolean;
	docCommentExpectType: boolean;
	forHeader: boolean;
	forHeaderExpectName: boolean;
}

const controlKeywords = new Set([
	"break",
	"continue",
	"do",
	"else",
	"elseif",
	"end",
	"for",
	"function",
	"if",
	"in",
	"repeat",
	"return",
	"then",
	"type",
	"until",
	"while",
]);

const modifierKeywords = new Set(["export", "local"]);
const logicalKeywords = new Set(["and", "not", "or"]);

const typePrimitives = new Set([
	"any",
	"boolean",
	"buffer",
	"never",
	"nil",
	"number",
	"string",
	"symbol",
	"thread",
	"unknown",
	"userdata",
	"vector",
]);

const standardFunctions = new Set([
	"assert",
	"collectgarbage",
	"delay",
	"error",
	"gcinfo",
	"getfenv",
	"getmetatable",
	"ipairs",
	"loadstring",
	"newproxy",
	"next",
	"pairs",
	"pcall",
	"print",
	"printidentity",
	"rawequal",
	"rawset",
	"require",
	"select",
	"setfenv",
	"setmetatable",
	"settings",
	"spawn",
	"stats",
	"tick",
	"time",
	"tonumber",
	"tostring",
	"type",
	"typeof",
	"unpack",
	"UserSettings",
	"version",
	"wait",
	"warn",
]);

const standardNamespaces = new Set([
	"bit32",
	"buffer",
	"coroutine",
	"debug",
	"math",
	"os",
	"string",
	"table",
	"task",
	"utf8",
	"vector",
	"Enum",
]);

const standardVariables = new Set([
	"_G",
	"_VERSION",
	"DebuggerManager",
	"PluginManager",
	"game",
	"plugin",
	"script",
	"shared",
	"workspace",
]);

const metamethods = new Set([
	"__add",
	"__call",
	"__concat",
	"__div",
	"__eq",
	"__idiv",
	"__index",
	"__iter",
	"__le",
	"__len",
	"__lt",
	"__metatable",
	"__mod",
	"__mode",
	"__mul",
	"__newindex",
	"__pow",
	"__sub",
	"__tostring",
	"__unm",
]);

const typeTerminators = new Set([
	"break",
	"continue",
	"do",
	"else",
	"elseif",
	"end",
	"for",
	"if",
	"in",
	"local",
	"repeat",
	"return",
	"then",
	"until",
	"while",
]);

const indentTokens = new Set(["do", "function", "if", "repeat", "(", "{"]);
const dedentTokens = new Set(["end", "until", ")", "}"]);
const dedentPartial = /^(?:end|until|else|elseif)\b|^[)}]/;

function pushTokenizer(state: LuauState, tokenizer: Tokenizer) {
	state.stack.push(state.cur);
	state.cur = tokenizer;
}

function popTokenizer(state: LuauState) {
	state.cur = state.stack.pop() || normal;
}

function enterTypeContext(state: LuauState, depth = 0) {
	state.inType = true;
	state.typeDepth = depth;
}

function exitTypeContext(state: LuauState) {
	state.inType = false;
	state.typeDepth = 0;
	state.genericDepth = 0;
	state.afterTypeIdentifier = false;
}

function isWordStart(char: string) {
	return /[A-Za-z_]/.test(char);
}

function isWord(char: string) {
	return /[A-Za-z0-9_]/.test(char);
}

function isUpperConstant(word: string) {
	return /^[A-Z_][A-Z0-9_]*$/.test(word);
}

function isReservedIdentifier(word: string) {
	return (
		controlKeywords.has(word) ||
		modifierKeywords.has(word) ||
		logicalKeywords.has(word) ||
		word === "true" ||
		word === "false" ||
		word === "nil"
	);
}

function isStandardWord(word: string) {
	return (
		standardFunctions.has(word) ||
		standardNamespaces.has(word) ||
		standardVariables.has(word)
	);
}

function isCallArgumentAhead(stream: StringStream, allowBacktick = false) {
	const rest = stream.string.slice(stream.pos);
	return /^(?:\s*\(|\s*\{|\s*['"]|\s*\[=*\[)/.test(rest) ||
		(allowBacktick && /^\s*`/.test(rest));
}

function looksLikeMethodSeparator(stream: StringStream, allowBacktick = true) {
	const rest = stream.string.slice(stream.pos);
	const match = /^\s*[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
	if (!match) return false;
	const afterName = rest.slice(match[0].length);
	return /^(?:\s*\(|\s*\{|\s*['"]|\s*\[=*\[)/.test(afterName) ||
		(allowBacktick && /^\s*`/.test(afterName));
}

function isCallbackAssignment(stream: StringStream) {
	return /^\s*=\s*[A-Za-z_][A-Za-z0-9_]*(?:\s*[.:]\s*[A-Za-z_][A-Za-z0-9_]*)*\s*\(\s*function\s*\(/.test(
		stream.string.slice(stream.pos),
	);
}

function readLongBracket(stream: StringStream) {
	let level = 0;
	while (stream.eat("=")) level++;
	return stream.eat("[") ? level : -1;
}

function bracketed(level: number, style: string): Tokenizer {
	return (stream, state) => {
		let seenEquals: number | null = null;

		while (true) {
			const char = stream.next();
			if (char == null) break;

			if (seenEquals == null) {
				if (char === "]") seenEquals = 0;
			} else if (char === "=") {
				seenEquals++;
			} else if (char === "]" && seenEquals === level) {
				popTokenizer(state);
				break;
			} else {
				seenEquals = null;
			}
		}

		return style;
	};
}

function quotedString(quote: string): Tokenizer {
	return (stream, state) => {
		let escaped = false;

		while (true) {
			const char = stream.next();
			if (char == null) break;

			if (char === quote && !escaped) {
				popTokenizer(state);
				break;
			}

			escaped = !escaped && char === "\\";
		}

		return "string";
	};
}

const interpolatedString: Tokenizer = (stream, state) => {
	while (true) {
		const char = stream.next();
		if (char == null) break;

		if (char === "\\") {
			stream.next();
			continue;
		}

		if (char === "{") {
			if (stream.pos - stream.start > 1) {
				stream.backUp(1);
				return "string";
			}

			state.interpolationBraceDepth = 0;
			pushTokenizer(state, interpolatedExpression);
			return "punctuation";
		}

		if (char === "`") {
			popTokenizer(state);
			break;
		}
	}

	return "string";
};

const interpolatedExpression: Tokenizer = (stream, state) => {
	if (stream.eatSpace()) return null;

	if (stream.peek() === "}" && state.interpolationBraceDepth === 0) {
		stream.next();
		popTokenizer(state);
		return "punctuation";
	}

	const style = normal(stream, state);
	const token = stream.current();

	if (state.cur === interpolatedExpression) {
		if (token === "{") {
			state.interpolationBraceDepth++;
		} else if (token === "}" && state.interpolationBraceDepth > 0) {
			state.interpolationBraceDepth--;
		}
	}

	return style;
};

const docCommentLine: Tokenizer = (stream, state) => {
	if (stream.sol()) {
		popTokenizer(state);
		return normal(stream, state);
	}

	if (stream.eatSpace()) return null;

	const peek = stream.peek();

	if (!peek) {
		state.docCommentExpectParamName = false;
		state.docCommentExpectType = false;
		return null;
	}

	if (stream.match(/(?:\\|@)[A-Za-z_][A-Za-z0-9_]*/)) {
		const tag = stream.current();
		state.docCommentExpectParamName = /(?:\\|@)param$/.test(tag);
		state.docCommentExpectType = false;
		return "attributeName";
	}

	if (state.docCommentExpectParamName && isWordStart(peek)) {
		stream.next();
		stream.eatWhile(isWord);
		state.docCommentExpectParamName = false;
		state.docCommentExpectType = true;
		return "variableName";
	}

	if (
		state.docCommentExpectType &&
		(isWordStart(peek) ||
			peek === "{" ||
			peek === "(" ||
			peek === "[" ||
			peek === "?" ||
			peek === "." ||
			peek === "|")
	) {
		stream.next();
		stream.eatWhile(/[^\s,;]+/);
		state.docCommentExpectType = false;
		return "typeName";
	}

	stream.next();
	stream.eatWhile((char) => !/\s/.test(char));
	return "comment";
};

function readNumber(stream: StringStream, firstChar: string) {
	const next = stream.peek();

	if (firstChar === "0" && next && /[xX]/.test(next)) {
		stream.next();
		stream.eatWhile(/[0-9a-fA-F_]/);
		return;
	}

	stream.eatWhile(/[\d_]/);

	if (stream.peek() === "." && stream.string.charAt(stream.pos + 1) !== ".") {
		stream.next();
		stream.eatWhile(/[\d_]/);
	}

	const exponent = stream.peek();

	if (exponent && /[eE]/.test(exponent)) {
		stream.next();
		stream.eat(/[+-]/);
		stream.eatWhile(/[\d_]/);
	}
}

function classifyIdentifier(
	word: string,
	state: LuauState,
	stream: StringStream,
) {
	const isLocalDeclarationName = state.expectLocalName && word !== "function";
	state.expectLocalName = false;
	state.lastIdentifierWasDeclaration = isLocalDeclarationName;

	if (state.afterPropertyAccess && isReservedIdentifier(word)) {
		state.afterPropertyAccess = false;
		state.lastIdentifierWasStandard = false;
		state.lastIdentifierWasProperty = false;
	}

	if (!state.afterPropertyAccess) state.lastIdentifierWasProperty = false;

	if (
		state.forHeader &&
		word !== "in" &&
		word !== "do" &&
		(controlKeywords.has(word) ||
			modifierKeywords.has(word) ||
			logicalKeywords.has(word))
	) {
		state.forHeader = false;
		state.forHeaderExpectName = false;
	}

	if (
		state.expectFunctionName &&
		(controlKeywords.has(word) ||
			modifierKeywords.has(word) ||
			logicalKeywords.has(word))
	) {
		state.expectFunctionName = false;
	}

	if (
		state.expectTypeName &&
		(word === "function" ||
			controlKeywords.has(word) ||
			modifierKeywords.has(word) ||
			logicalKeywords.has(word))
	) {
		state.expectTypeName = false;
	}

	if (
		state.inFunctionParams &&
		(controlKeywords.has(word) ||
			modifierKeywords.has(word) ||
			logicalKeywords.has(word))
	) {
		state.inFunctionParams = false;
		state.functionParamsDepth = 0;
	}

	if (state.forHeader && word === "in") {
		state.forHeader = false;
		state.forHeaderExpectName = false;
		state.lastIdentifierWasStandard = false;
		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		return "controlKeyword";
	}

	if (state.forHeader && word === "do") {
		state.forHeader = false;
		state.forHeaderExpectName = false;
	}

	if (
		state.forHeader &&
		!controlKeywords.has(word) &&
		!modifierKeywords.has(word) &&
		!logicalKeywords.has(word)
	) {
		if (!state.forHeaderExpectName) {
			state.forHeader = false;
		} else {
			state.forHeaderExpectName = false;
			state.lastIdentifierWasStandard = false;
			state.afterFunctionName = false;
			state.afterTypeIdentifier = false;
			return "variableName.special";
		}
	}

	if (state.expectFunctionName && isWordStart(word)) {
		const isQualifiedFunctionName = /^\s*[.:]\s*[A-Za-z_]/.test(
			stream.string.slice(stream.pos),
		);
		state.expectFunctionName = false;
		state.afterFunctionName = true;
		state.afterPropertyAccess = false;
		state.afterTypeIdentifier = false;
		state.lastIdentifierWasStandard = false;

		if (metamethods.has(word)) return "modifier";
		if (isQualifiedFunctionName) return "variableName";
		return "variableName.function.definition";
	}

	if (state.expectTypeName && word !== "function") {
		state.expectTypeName = false;
		state.afterTypeName = true;
		state.afterTypeIdentifier = true;
		state.afterFunctionName = false;
		state.lastIdentifierWasStandard = false;
		return "typeName.definition";
	}

	if (state.afterPropertyAccess) {
		const isCall = isCallArgumentAhead(stream, true);
		const isFunctionDefinitionName = state.afterFunctionName;

		state.afterPropertyAccess = false;
		state.lastIdentifierWasStandard = false;
		state.lastIdentifierWasProperty = true;
		state.afterFunctionName = isFunctionDefinitionName;
		state.afterTypeIdentifier = false;

		if (metamethods.has(word)) {
			state.afterFunctionName = false;
			return "modifier";
		}

		if (isFunctionDefinitionName && isCall) {
			return "propertyName.function.definition";
		}

		if (isCall) {
			state.afterFunctionName = false;
			return "propertyName.function";
		}

		return "propertyName";
	}

	if (logicalKeywords.has(word)) {
		state.lastIdentifierWasStandard = false;
		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		return "modifier";
	}

	if (modifierKeywords.has(word)) {
		state.lastIdentifierWasStandard = false;
		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		if (word === "local") state.expectLocalName = true;
		return "modifier";
	}

	if (word === "type") {
		state.expectTypeName = true;
		state.afterTypeName = false;
		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		state.lastIdentifierWasStandard = false;
		return "definitionKeyword";
	}

	if (word === "function") {
		if (!state.expectTypeName) state.expectFunctionName = true;
		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		state.lastIdentifierWasStandard = false;
		return "controlKeyword";
	}

	if (word === "self") {
		state.lastIdentifierWasStandard = false;
		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		return "variableName";
	}

	if (word === "true" || word === "false") {
		state.lastIdentifierWasStandard = false;
		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		return "bool";
	}

	if (word === "nil") {
		state.lastIdentifierWasStandard = false;
		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		return "null";
	}

	if (controlKeywords.has(word)) {
		if (word === "for") {
			state.forHeader = true;
			state.forHeaderExpectName = true;
		}

		if (
			state.inType &&
			state.typeDepth === 0 &&
			typeTerminators.has(word)
		) {
			exitTypeContext(state);
		}

		state.lastIdentifierWasStandard = false;
		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		return "controlKeyword";
	}

	if (state.inType) {
		state.lastIdentifierWasStandard = false;
		state.afterFunctionName = false;
		state.afterTypeIdentifier = true;

		if (word === "typeof") return "variableName.function.standard";
		if (typePrimitives.has(word) || isUpperConstant(word)) return "typeName";

		return "typeName";
	}

	if (metamethods.has(word)) {
		state.lastIdentifierWasStandard = false;
		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		return "modifier";
	}

	if (state.inFunctionParams) {
		state.lastIdentifierWasStandard = false;
		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		return "variableName.special";
	}

	if (isCallbackAssignment(stream)) {
		state.lastIdentifierWasStandard = false;
		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		return "variableName.special";
	}

	if (standardNamespaces.has(word)) {
		state.lastIdentifierWasStandard = true;
		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		return "namespace.standard";
	}

	if (standardVariables.has(word)) {
		state.lastIdentifierWasStandard = true;
		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		return "variableName.standard";
	}

	if (standardFunctions.has(word)) {
		state.lastIdentifierWasStandard = true;
		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		return "variableName.function.standard";
	}

	if (isCallArgumentAhead(stream, true)) {
		state.lastIdentifierWasStandard = false;
		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		return "variableName.function";
	}

	if (isUpperConstant(word)) {
		state.lastIdentifierWasStandard = false;
		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		return "variableName";
	}

	state.lastIdentifierWasStandard = isStandardWord(word);
	state.afterFunctionName = false;
	state.afterTypeIdentifier = false;
	return "variableName";
}

const normal: Tokenizer = (stream, state) => {
	const char = stream.next();
	if (!char) return null;

	if (state.afterPropertyAccess && !isWordStart(char)) {
		state.afterPropertyAccess = false;
		state.lastIdentifierWasStandard = false;
	}

	if (char !== "." && char !== ":" && !isWordStart(char)) {
		state.lastIdentifierWasProperty = false;
		state.lastIdentifierWasDeclaration = false;
	}

	if (char === "-" && stream.eat("-")) {
		if (stream.eat("-")) {
			state.docCommentExpectParamName = false;
			state.docCommentExpectType = false;
			pushTokenizer(state, docCommentLine);
			return "comment";
		}

		if (stream.eat("[")) {
			const longBracketStart = stream.pos;
			const level = readLongBracket(stream);

			if (level >= 0) {
				pushTokenizer(state, bracketed(level, "comment"));
				return state.cur(stream, state);
			}

			stream.backUp(stream.pos - longBracketStart);
		}

		stream.skipToEnd();
		return "comment";
	}

	if (state.forHeader && char !== "," && char !== "=" && !isWordStart(char)) {
		state.forHeader = false;
		state.forHeaderExpectName = false;
	}

	if (char === '"' || char === "'") {
		pushTokenizer(state, quotedString(char));
		return state.cur(stream, state);
	}

	if (char === "`") {
		pushTokenizer(state, interpolatedString);
		return state.cur(stream, state);
	}

	if (char === "[") {
		const longBracketStart = stream.pos;
		const level = readLongBracket(stream);

		if (level >= 0) {
			pushTokenizer(state, bracketed(level, "string"));
			return state.cur(stream, state);
		}

		stream.backUp(stream.pos - longBracketStart);
	}

	if (char === "@" && isWordStart(stream.peek() || "")) {
		stream.eatWhile(isWord);
		state.lastIdentifierWasStandard = false;
		return "attributeName";
	}

	if (/\d/.test(char) || (char === "." && /\d/.test(stream.peek() || ""))) {
		readNumber(stream, char);
		state.lastIdentifierWasStandard = false;
		return "number";
	}

	if (isWordStart(char)) {
		stream.eatWhile(isWord);
		return classifyIdentifier(stream.current(), state, stream);
	}

	if (char === "." || char === ":") {
		if (char === "." && stream.eat(".")) {
			state.afterFunctionName = false;
			state.afterTypeIdentifier = false;

			if (stream.eat(".")) {
				state.lastIdentifierWasStandard = false;
				return "keyword";
			}

			stream.eat("=");
			state.lastIdentifierWasStandard = false;
			return "operator";
		}

		if (char === ":" && stream.eat(":")) {
			enterTypeContext(state);
			state.lastIdentifierWasStandard = false;
			return "operator";
		}

		if (
			char === ":" &&
			!state.expectFunctionName &&
			!state.lastIdentifierWasProperty &&
			(state.lastIdentifierWasDeclaration || state.inFunctionParams || state.inType) &&
			!looksLikeMethodSeparator(stream, true)
		) {
			enterTypeContext(state);
			state.lastIdentifierWasStandard = false;
			return "operator";
		}

		state.afterPropertyAccess = true;
		return "punctuation";
	}

	if (char === "-" && stream.eat(">")) {
		enterTypeContext(state);
		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		state.lastIdentifierWasStandard = false;
		return "operator";
	}

	if (
		char === "<" &&
		(state.afterTypeName ||
			state.afterFunctionName ||
			state.afterTypeIdentifier)
	) {
		if (state.afterFunctionName) state.functionGenericParams = true;
		enterTypeContext(state);
		state.genericDepth++;
		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		state.lastIdentifierWasStandard = false;
		return "operator";
	}

	if (
		(char === "|" || char === "&" || char === "?") &&
		(state.inType || char === "?")
	) {
		state.lastIdentifierWasStandard = false;
		return "operator";
	}

	if (
		char === "+" ||
		char === "-" ||
		char === "*" ||
		char === "/" ||
		char === "%" ||
		char === "^" ||
		char === "#" ||
		char === "=" ||
		char === "<" ||
		char === ">" ||
		char === "~" ||
		char === "!"
	) {
		stream.eat("=");

		if (char === "=" && state.forHeader) {
			state.forHeader = false;
			state.forHeaderExpectName = false;
		}

		if (char === ">" && state.genericDepth > 0) {
			state.genericDepth--;

			if (state.genericDepth === 0 && state.typeDepth === 0) {
				state.inType = false;
			}

			state.afterTypeIdentifier = true;
			state.lastIdentifierWasStandard = false;

			if (state.genericDepth === 0 && state.functionGenericParams) {
				state.functionGenericParams = false;
				state.afterFunctionName = true;
				state.afterTypeIdentifier = false;
			}

			return "operator";
		}

		if (char === "/" && stream.eat("/")) stream.eat("=");

		if (char === "=" && state.afterTypeName && state.genericDepth === 0) {
			state.afterTypeName = false;
			enterTypeContext(state);
		}

		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		state.lastIdentifierWasStandard = false;
		return "operator";
	}

	if (char === "(" || char === "{" || char === "[") {
		const startsFunctionParams =
			char === "(" &&
			(state.expectFunctionName || state.afterFunctionName);

		if (startsFunctionParams) {
			state.inFunctionParams = true;
			state.functionParamsDepth = 1;
			state.expectFunctionName = false;
			state.afterFunctionName = false;
			state.lastIdentifierWasStandard = false;
		} else if (char === "(" && state.inFunctionParams) {
			state.functionParamsDepth++;
		}

		if (char === "(") {
			state.expectTypeName = false;
		}

		if (state.inType) state.typeDepth++;

		state.lastIdentifierWasStandard = false;

		if (state.afterTypeName && char === "(") {
			state.afterTypeName = false;
			enterTypeContext(state, 1);
		}

		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		return "punctuation";
	}

	if (char === ")" || char === "}" || char === "]") {
		if (char === ")" && state.inFunctionParams) {
			state.functionParamsDepth--;

			if (state.functionParamsDepth <= 0) {
				state.inFunctionParams = false;
				state.functionParamsDepth = 0;
			}
		}

		if (state.inType) {
			if (state.typeDepth > 0) {
				state.typeDepth--;
			} else if (
				char === ")" &&
				/^\s*->/.test(stream.string.slice(stream.pos))
			) {
				enterTypeContext(state);
			} else {
				exitTypeContext(state);
			}
		}

		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		state.lastIdentifierWasStandard = false;
		return "punctuation";
	}

	if (char === "," || char === ";") {
		if (state.forHeader && char === ",") state.forHeaderExpectName = true;
		if (state.inType && state.typeDepth === 0) exitTypeContext(state);

		state.afterFunctionName = false;
		state.afterTypeIdentifier = false;
		state.lastIdentifierWasStandard = false;
		return "punctuation";
	}

	state.afterFunctionName = false;
	state.afterTypeIdentifier = false;
	state.lastIdentifierWasStandard = false;
	return null;
};

const luauLanguage = StreamLanguage.define<LuauState>({
	name: "luau",

	startState() {
		return {
			basecol: 0,
			indentDepth: 0,
			cur: normal,
			stack: [],
			expectFunctionName: false,
			afterFunctionName: false,
			expectTypeName: false,
			afterTypeName: false,
			afterTypeIdentifier: false,
			inType: false,
			typeDepth: 0,
			genericDepth: 0,
			interpolationBraceDepth: 0,
			afterPropertyAccess: false,
			lastIdentifierWasStandard: false,
			lastIdentifierWasProperty: false,
			expectLocalName: false,
			lastIdentifierWasDeclaration: false,
			inFunctionParams: false,
			functionParamsDepth: 0,
			functionGenericParams: false,
			docCommentExpectParamName: false,
			docCommentExpectType: false,
			forHeader: false,
			forHeaderExpectName: false,
		};
	},

	copyState(state) {
		return {
			...state,
			stack: state.stack.slice(),
		};
	},

	token(stream, state) {
		if (stream.sol() && state.indentDepth === 0) {
			state.basecol = stream.indentation();
		}

		if (stream.eatSpace()) return null;

		const style = state.cur(stream, state);
		const word = stream.current();

		if (style !== "comment" && style !== "string") {
			if (indentTokens.has(word)) {
				state.indentDepth++;
			}

			if (dedentTokens.has(word)) {
				state.indentDepth = Math.max(0, state.indentDepth - 1);
			}
		}

		return style;
	},

	indent(state, textAfter, context: IndentContext) {
		const closing = dedentPartial.test(textAfter);
		const depth = Math.max(
			0,
			state.indentDepth - (closing ? 1 : 0),
		);

		return state.basecol + context.unit * depth;
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
			brackets: ["(", "[", "{", '"', "'", "`"],
		},
		indentOnInput: /^\s*(?:end|until|else|elseif|\)|\})$/,
	},
});

export function luau() {
	return new LanguageSupport(luauLanguage);
}

export { luauLanguage };
