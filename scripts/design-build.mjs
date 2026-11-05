// production build against the frozen fixture content, for the design harness
// (tests/design). cross-platform stand-in for `CONTENT_ROOT=... next build`.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// turbopack's root must contain the real (symlink-resolved) next package. in a
// normal checkout that's the repo; in a worktree whose node_modules link back
// to the main checkout it's the main checkout.
const nextPkg = fs.realpathSync(path.join("node_modules", "next"));
const turbopackRoot = path.dirname(path.dirname(nextPkg));

const r = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    CONTENT_ROOT: "tests/design/fixtures/content",
    DESIGN_TURBOPACK_ROOT: turbopackRoot,
    NEXT_TELEMETRY_DISABLED: "1",
  },
});
process.exit(r.status ?? 1);
