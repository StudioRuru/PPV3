import { build } from "esbuild";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL("../../mac/MiyabiOverlay/Resources/", import.meta.url));
fs.mkdirSync(dir, { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL("../src/lib/sprites/behaviour.ts", import.meta.url))], bundle: true, format: "iife", globalName: "Behaviour", platform: "neutral", footer: { js: "globalThis.Behaviour = Behaviour;" }, outfile: dir + "behaviour.js" });
console.log("wrote", dir + "behaviour.js");
