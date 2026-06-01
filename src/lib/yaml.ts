import fs from "fs";
import path from "path";
import yaml from "js-yaml";

export function loadYaml<T>(relPath: string): T {
  const fullPath = path.join(process.cwd(), "content", relPath);
  const raw = fs.readFileSync(fullPath, "utf8");
  return yaml.load(raw) as T;
}
