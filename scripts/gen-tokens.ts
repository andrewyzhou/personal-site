// writes src/design-system/tokens.css from src/design-system/tokens.ts.
// run: npm run tokens
import fs from "node:fs";
import path from "node:path";
import { tokensCss } from "../src/design-system/generate";

const out = path.join(__dirname, "..", "src", "design-system", "tokens.css");
fs.writeFileSync(out, tokensCss());
console.log(`wrote ${path.relative(process.cwd(), out)}`);
