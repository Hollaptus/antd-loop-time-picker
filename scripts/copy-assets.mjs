import { mkdirSync, copyFileSync } from "node:fs";

mkdirSync("dist", { recursive: true });
copyFileSync("src/loop-time-picker.css", "dist/style.css");
copyFileSync("src/index.d.ts", "dist/index.d.ts");