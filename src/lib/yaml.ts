import fs from "fs";
import { contentPath } from "@/lib/content-root";
import yaml from "js-yaml";

export function loadYaml<T>(relPath: string): T {
  const fullPath = contentPath(relPath);
  const raw = fs.readFileSync(fullPath, "utf8");
  return yaml.load(raw) as T;
}
