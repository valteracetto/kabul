#!/usr/bin/env node
// Prints the CHANGELOG.md section of one version (the body of the GitHub Release).
//
//   node scripts/release-notes.mjs 0.9.0        (a leading "v" is accepted)
//
// Exits 1 when the version has no section, so the release workflow can fall back to git-cliff.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const version = (process.argv[2] ?? "").replace(/^refs\/tags\//, "").replace(/^v/, "");
if (!version) {
  console.error("usage: node scripts/release-notes.mjs <version>");
  process.exit(2);
}
const text = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "CHANGELOG.md"), "utf8");
const lines = text.split("\n");
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (start < 0) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}
const rest = lines.slice(start + 1);
const end = rest.findIndex((l) => l.startsWith("## ["));
console.log((end < 0 ? rest : rest.slice(0, end)).join("\n").trim());
