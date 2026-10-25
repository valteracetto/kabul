#!/usr/bin/env node
// Single version for the whole repo. Source of truth: `[workspace.package] version` in Cargo.toml.
//
//   node scripts/version.mjs get            prints the version
//   node scripts/version.mjs set 0.10.0     writes it to Cargo.toml and every manifest below
//   node scripts/version.mjs check          fails (exit 1) if any manifest diverges (used by CI)
//   node scripts/version.mjs check --tag v0.10.0   also checks a release tag
//
// Manifests kept in sync: apps/web/package.json, apps/desktop/package.json (and their
// package-lock.json root entries), apps/desktop/src-tauri/tauri.conf.json and Cargo.lock entries
// of the workspace crates.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const p = (rel) => join(root, rel);
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CRATES = ["kabul-core", "kabul-cli", "kabuld", "kabul-desktop"];
const JSON_FILES = ["apps/web/package.json", "apps/desktop/package.json", "apps/desktop/src-tauri/tauri.conf.json"];
const LOCK_FILES = ["apps/web/package-lock.json", "apps/desktop/package-lock.json"];

function cargoVersion() {
  const toml = readFileSync(p("Cargo.toml"), "utf8");
  const sec = toml.match(/\[workspace\.package\]([\s\S]*?)(?:\n\[|$)/);
  const m = sec && sec[1].match(/^version\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error("Cargo.toml: [workspace.package] version not found");
  return m[1];
}

function setCargo(v) {
  const toml = readFileSync(p("Cargo.toml"), "utf8");
  const out = toml.replace(/(\[workspace\.package\][\s\S]*?^version\s*=\s*")[^"]+(")/m, `$1${v}$2`);
  writeFileSync(p("Cargo.toml"), out);
}

/** Versions of the workspace crates recorded in Cargo.lock. */
function lockVersions() {
  if (!existsSync(p("Cargo.lock"))) return {};
  const lock = readFileSync(p("Cargo.lock"), "utf8");
  const out = {};
  for (const name of CRATES) {
    const m = lock.match(new RegExp(`\\[\\[package\\]\\]\\nname = "${name}"\\nversion = "([^"]+)"`));
    if (m) out[name] = m[1];
  }
  return out;
}

function setLock(v) {
  if (!existsSync(p("Cargo.lock"))) return;
  let lock = readFileSync(p("Cargo.lock"), "utf8");
  for (const name of CRATES) lock = lock.replace(new RegExp(`(\\[\\[package\\]\\]\\nname = "${name}"\\nversion = ")[^"]+(")`), `$1${v}$2`);
  writeFileSync(p("Cargo.lock"), lock);
}

const readJson = (rel) => JSON.parse(readFileSync(p(rel), "utf8"));
const writeJson = (rel, o) => writeFileSync(p(rel), JSON.stringify(o, null, 2) + "\n");

function versions() {
  const found = { "Cargo.toml": cargoVersion() };
  for (const f of JSON_FILES) found[f] = readJson(f).version;
  for (const f of LOCK_FILES) {
    if (!existsSync(p(f))) continue;
    const l = readJson(f);
    found[f] = l.version;
    if (l.packages?.[""]) found[`${f} (packages[""])`] = l.packages[""].version;
  }
  for (const [name, v] of Object.entries(lockVersions())) found[`Cargo.lock (${name})`] = v;
  return found;
}

function set(v) {
  if (!SEMVER.test(v)) throw new Error(`not a SemVer version: ${v}`);
  setCargo(v);
  setLock(v);
  for (const f of JSON_FILES) {
    const o = readJson(f);
    o.version = v;
    writeJson(f, o);
  }
  for (const f of LOCK_FILES) {
    if (!existsSync(p(f))) continue;
    const l = readJson(f);
    l.version = v;
    if (l.packages?.[""]) l.packages[""].version = v;
    writeJson(f, l);
  }
  console.log(`version set to ${v}`);
}

function check(tag) {
  const want = cargoVersion();
  const bad = Object.entries(versions()).filter(([, v]) => v !== want);
  if (tag && tag.replace(/^refs\/tags\//, "").replace(/^v/, "") !== want) bad.push([`tag ${tag}`, tag]);
  if (bad.length) {
    console.error(`version mismatch (Cargo.toml has ${want}):`);
    for (const [f, v] of bad) console.error(`  ${f}: ${v}`);
    console.error("fix with: node scripts/version.mjs set " + want);
    process.exit(1);
  }
  console.log(`ok: every manifest is at ${want}`);
}

const [cmd, arg, extra] = process.argv.slice(2);
try {
  if (cmd === "get") console.log(cargoVersion());
  else if (cmd === "set" && arg) set(arg);
  else if (cmd === "check") check(arg === "--tag" ? extra : undefined);
  else {
    console.error("usage: node scripts/version.mjs get | set <x.y.z> | check [--tag vX.Y.Z]");
    process.exit(2);
  }
} catch (err) {
  console.error(String(err.message ?? err));
  process.exit(1);
}
