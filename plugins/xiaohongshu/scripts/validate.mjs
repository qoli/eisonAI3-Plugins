#!/usr/bin/env node

import { resolve } from "node:path";
import { loadPlugin } from "../../eisonAI3-PluginProtocol/scripts/protocol-validator.mjs";

const pluginPath = resolve(import.meta.dirname, "../plugin.js");
const plugin = await loadPlugin(pluginPath);
process.stdout.write(`${plugin.manifest.id} ${plugin.manifest.revision}: valid against sibling draft-v0 protocol\n`);
