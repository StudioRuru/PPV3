import { build } from "esbuild";
import fs from "node:fs";
const dir = new URL("../../mac/MiyabiOverlay/Resources/", import.meta.url).pathname;
fs.mkdirSync(dir, { recursive: true });
await build({ entryPoints: ["src/lib/sprites/behaviour.ts"], bundle: true, format: "iife", globalName: "Behaviour", platform: "neutral", footer: { js: "globalThis.Behaviour = Behaviour;" }, outfile: dir + "behaviour.js" });
console.log("wrote", dir + "behaviour.js");
