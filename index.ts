import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerCommands } from "./commands/register-commands.js";
import { registerEvents } from "./events/register-events.js";
import { createRuntimeServices } from "./runtime/session-state.js";

export default function compactionPolicyExtension(pi: ExtensionAPI) {
	const runtime = createRuntimeServices();
	registerCommands(pi, runtime);
	registerEvents(pi, runtime);
}
