#!/usr/bin/env node

import { resolve } from "node:path";
import { loadPlugin } from "./protocol-validator.mjs";

const input = process.argv[2];
if (!input) throw new Error("usage: node scripts/validate-plugin.mjs PATH_TO_PLUGIN_JS");

const filePath = resolve(input);
const plugin = await loadPlugin(filePath);
process.stdout.write(`${plugin.manifest.id} ${plugin.manifest.revision}: valid draft-v0 plugin\n`);
