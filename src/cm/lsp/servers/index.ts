import type { LspServerBundle, LspServerManifest } from "../types";
import { javascriptBundle, javascriptServers } from "./javascript";
import { luaBundle, luaServers } from "./lua";
import { luauBundle, luauServers } from "./luau";
import { pythonBundle, pythonServers } from "./python";
import { styluaBundle, styluaServers } from "./stylua";
import { systemsBundle, systemsServers } from "./systems";
import { tailwindBundle, tailwindServers } from "./tailwind";
import { webBundle, webServers } from "./web";

export const builtinServers: LspServerManifest[] = [
	...javascriptServers,
	...pythonServers,
	...luaServers,
	...luauServers,
	...styluaServers,
	...webServers,
	...systemsServers,
	...tailwindServers,
];

export const builtinServerBundles: LspServerBundle[] = [
	javascriptBundle,
	pythonBundle,
	luaBundle,
	luauBundle,
	styluaBundle,
	webBundle,
	systemsBundle,
	tailwindBundle,
];
