import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const config = {
	name: "vscodeDark",
	dark: true,

	bracketColors: [
		"#FFD700",
		"#DA70D6",
		"#179FFF",
		"#4EC9B0",
		"#CE9178",
		"#9CDCFE",
	],

	background: "#1E1E1E",
	foreground: "#D4D4D4",

	selection: "#264F78",
	selectionMatch: "#ADD6FF26",

	cursor: "#AEAFAD",

	dropdownBackground: "#252526",
	dropdownBorder: "#454545",

	activeLine: "#FFFFFF0A",

	lineNumber: "#858585",
	lineNumberActive: "#C6C6C6",

	matchingBracketBackground: "#0064001A",
	matchingBracketBorder: "#888888",

	keyword: "#569CD6",
	controlKeyword: "#C586C0",
	variable: "#9CDCFE",
	mutedVariable: "#808080",
	function: "#DCDCAA",
	string: "#CE9178",
	constant: "#4FC1FF",
	constantLanguage: "#569CD6",
	type: "#4EC9B0",
	class: "#4EC9B0",
	number: "#B5CEA8",
	comment: "#6A9955",
	heading: "#569CD6",
	invalid: "#F44747",
	regexp: "#D16969",
	tag: "#569CD6",
	operator: "#D4D4D4",
	annotation: "#569CD6",
	escape: "#D7BA7D",
	angleBracket: "#808080",
};

export const vscodeDarkTheme = EditorView.theme(
	{
		"&": {
			color: config.foreground,
			backgroundColor: config.background,
		},

		".cm-content": {
			caretColor: config.cursor,
		},

		".cm-cursor, .cm-dropCursor": {
			borderLeftColor: config.cursor,
		},

		".cm-selectionBackground": {
			backgroundColor: config.selection,
		},

		"&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
			{
				backgroundColor: config.selection,
			},

		".cm-content ::selection": {
			backgroundColor: config.selection,
		},

		".cm-panels": {
			backgroundColor: config.dropdownBackground,
			color: config.foreground,
		},

		".cm-panels.cm-panels-top": {
			borderBottom: `1px solid ${config.dropdownBorder}`,
		},

		".cm-panels.cm-panels-bottom": {
			borderTop: `1px solid ${config.dropdownBorder}`,
		},

		".cm-searchMatch": {
			backgroundColor: config.dropdownBackground,
			outline: `1px solid ${config.dropdownBorder}`,
		},

		".cm-searchMatch.cm-searchMatch-selected": {
			backgroundColor: config.selectionMatch,
		},

		".cm-activeLine": {
			backgroundColor: config.activeLine,
		},

		".cm-selectionMatch": {
			backgroundColor: config.selectionMatch,
		},

		"&.cm-focused .cm-matchingBracket": {
			backgroundColor: config.matchingBracketBackground,
			outline: `1px solid ${config.matchingBracketBorder}`,
		},

		"&.cm-focused .cm-nonmatchingBracket": {
			backgroundColor: "transparent",
			outline: "1px solid transparent",
		},

		".cm-gutters": {
			backgroundColor: config.background,
			color: config.lineNumber,
			border: "none",
		},

		".cm-activeLineGutter": {
			backgroundColor: config.background,
		},

		".cm-lineNumbers .cm-gutterElement": {
			color: config.lineNumber,
		},

		".cm-lineNumbers .cm-activeLineGutter": {
			color: config.lineNumberActive,
		},

		".cm-foldPlaceholder": {
			backgroundColor: "transparent",
			border: "none",
			color: config.foreground,
		},

		".cm-tooltip": {
			border: `1px solid ${config.dropdownBorder}`,
			backgroundColor: config.dropdownBackground,
			color: config.foreground,
		},

		".cm-tooltip .cm-tooltip-arrow:before": {
			borderTopColor: "transparent",
			borderBottomColor: "transparent",
		},

		".cm-tooltip .cm-tooltip-arrow:after": {
			borderTopColor: config.foreground,
			borderBottomColor: config.foreground,
		},

		".cm-tooltip-autocomplete": {
			"& > ul > li[aria-selected]": {
				background: config.selectionMatch,
				color: config.foreground,
			},
		},
	},
	{ dark: config.dark },
);

export const vscodeDarkHighlightStyle = HighlightStyle.define([
	{
		tag: [
			t.keyword,
			t.definitionKeyword,
		],
		color: config.keyword,
	},

	{
		tag: [t.controlKeyword],
		color: config.controlKeyword,
	},

	{
		tag: [t.modifier],
		color: config.keyword,
	},

	{
		tag: [t.operatorKeyword],
		color: config.operator,
	},

	{
		tag: [
			t.function(t.variableName),
			t.function(t.propertyName),
			t.function(t.definition(t.variableName)),
			t.function(t.definition(t.propertyName)),
		],
		color: config.function,
	},

	{
		tag: [
			t.variableName,
			t.definition(t.variableName),
			t.local(t.variableName),
		],
		color: config.variable,
	},

	{
		tag: [t.special(t.variableName)],
		color: config.mutedVariable,
	},

	{
		tag: [
			t.standard(t.variableName),
			t.standard(t.propertyName),
		],
		color: config.function,
	},

	{
		tag: [
			t.constant(t.variableName),
			t.constant(t.name),
			t.constant(t.propertyName),
		],
		color: config.constant,
	},

	{
		tag: [
			t.bool,
			t.null,
			t.atom,
		],
		color: config.constantLanguage,
	},

	{
		tag: [
			t.typeName,
			t.className,
			t.namespace,
		],
		color: config.type,
	},

	{
		tag: [t.standard(t.namespace)],
		color: config.keyword,
	},

	{
		tag: [
			t.propertyName,
			t.definition(t.propertyName),
			t.attributeName,
			t.definition(t.attributeName),
		],
		color: config.variable,
	},

	{
		tag: [
			t.annotation,
			t.meta,
		],
		color: config.annotation,
	},

	{
		tag: [
			t.literal,
			t.number,
			t.integer,
			t.float,
			t.changed,
		],
		color: config.number,
	},

	{
		tag: [
			t.string,
			t.special(t.string),
			t.docString,
			t.attributeValue,
		],
		color: config.string,
	},

	{
		tag: [t.escape],
		color: config.escape,
	},

	{
		tag: [
			t.operator,
			t.derefOperator,
			t.arithmeticOperator,
			t.logicOperator,
			t.bitwiseOperator,
			t.compareOperator,
			t.updateOperator,
			t.definitionOperator,
			t.typeOperator,
			t.controlOperator,
			t.punctuation,
			t.separator,
		],
		color: config.operator,
	},

	{
		tag: [
			t.bracket,
			t.paren,
			t.squareBracket,
			t.brace,
		],
		color: config.operator,
	},

	{
		tag: [t.regexp],
		color: config.regexp,
	},

	{
		tag: [
			t.comment,
			t.lineComment,
			t.blockComment,
			t.docComment,
			t.documentMeta,
		],
		color: config.comment,
	},

	{
		tag: [t.labelName],
		color: config.variable,
	},

	{
		tag: [t.heading],
		fontWeight: "bold",
		color: config.heading,
	},

	{
		tag: [t.angleBracket],
		color: config.angleBracket,
	},

	{
		tag: [t.invalid],
		color: config.invalid,
	},
]);

export function vscodeDark() {
	return [
		vscodeDarkTheme,
		syntaxHighlighting(vscodeDarkHighlightStyle),
	];
}

export default vscodeDark;
