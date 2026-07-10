#!/usr/bin/env node
// utm-guard
//
// Two jobs around one controlled vocabulary of UTM values:
//   build  - make a UTM-tagged URL, refusing any source/medium/campaign that
//            is not in your vocabulary (so analytics never splinters into
//            linkedin / LinkedIn / li)
//   lint   - scan your files for outbound links that forgot their UTM tags,
//            or that carry tag values which are not in your vocabulary
//
// Exit code is 0 when clean, 1 when something is refused or untagged, 2 on a
// config or usage error. No dependencies.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Flags that take no value.
const BOOLEAN_FLAGS = new Set(["force"]);
// Escape every regex metacharacter in a config value before it goes into a
// pattern. Config is data, never regex.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function usageText() {
  return [
    "utm-guard",
    "  utm-guard build <path-or-url> --source <s> [--medium <m>] [--campaign <c>] [--content <v>] [--force]",
    "  utm-guard lint",
    "Options:",
    "  --vocab <path>   vocabulary file (default: utm.vocab.json)",
    "  --force          (build) overwrite utm_* params already on the target URL",
    "  --help           show this help",
    "  --version        print the version",
  ].join("\n");
}

function readVersion() {
  try {
    const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "package.json");
    return JSON.parse(fs.readFileSync(pkgPath, "utf8")).version || "unknown";
  } catch {
    return "unknown";
  }
}

function loadVocab(p) {
  const file = p || "utm.vocab.json";
  if (!fs.existsSync(file)) {
    console.error(`No vocabulary at ${file}. Pass --vocab <path>, or create utm.vocab.json.`);
    console.error(
      "Start from examples/utm.vocab.example.json in a clone of the repo, or from " +
        "node_modules/utm-guard/examples/utm.vocab.example.json when installed as a dependency.",
    );
    process.exit(2);
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`Vocabulary at ${file} is not valid JSON: ${e.message}`);
    process.exit(2);
  }
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const name = args[i].slice(2);
      if (BOOLEAN_FLAGS.has(name)) {
        flags[name] = true;
        continue;
      }
      const value = args[i + 1];
      // A flag immediately followed by another flag has no value. Refuse
      // instead of swallowing the next flag as the value, which produces a
      // baffling "not in the vocabulary" error later.
      if (value === undefined || value.startsWith("--")) {
        console.error(`missing value for --${name}`);
        process.exit(2);
      }
      flags[name] = value;
      i++;
    } else {
      positional.push(args[i]);
    }
  }
  return { flags, positional };
}

// Campaign policy: when the vocabulary lists campaigns, membership is the
// rule. Without a list (campaign names rarely stay a closed set for long),
// enforce lowercase kebab-case so names never splinter on casing or
// separators. Returns an error string or null.
function campaignError(value, vocab) {
  if (Array.isArray(vocab.campaigns)) {
    if (!vocab.campaigns.includes(value)) {
      return `utm_campaign "${value}" is not in the vocabulary. Allowed: ${vocab.campaigns.join(", ")}`;
    }
    return null;
  }
  if (!KEBAB.test(value)) {
    return `utm_campaign "${value}" must be lowercase kebab-case (e.g. "spring-launch")`;
  }
  return null;
}

function build(args, vocab) {
  const { flags, positional } = parseFlags(args);
  const target = positional[0];
  if (!target) {
    console.error(
      "Usage: utm-guard build <path-or-url> --source <s> [--medium <m>] [--campaign <c>] [--content <v>] [--force]",
    );
    process.exit(2);
  }

  const errors = [];

  const source = flags.source;
  if (!source) {
    errors.push("missing --source");
  } else if (Array.isArray(vocab.sources) && !vocab.sources.includes(source)) {
    errors.push(`--source "${source}" is not in the vocabulary. Allowed: ${vocab.sources.join(", ")}`);
  }

  // medium is explicit, or inferred from the vocabulary's
  // defaultMediumForSource map (e.g. a chat app source defaulting to dm).
  let medium = flags.medium;
  let inferred = false;
  if (!medium && source && vocab.defaultMediumForSource && vocab.defaultMediumForSource[source]) {
    medium = vocab.defaultMediumForSource[source];
    inferred = true;
  }
  if (!medium) {
    errors.push("missing --medium (and no default medium for this source in the vocabulary)");
  } else if (Array.isArray(vocab.mediums) && !vocab.mediums.includes(medium)) {
    errors.push(`--medium "${medium}" is not in the vocabulary. Allowed: ${vocab.mediums.join(", ")}`);
  }

  if (flags.campaign) {
    const err = campaignError(flags.campaign, vocab);
    if (err) errors.push(err.replace(/^utm_campaign/, "--campaign"));
  }
  if (flags.content && !KEBAB.test(flags.content)) {
    errors.push(`--content "${flags.content}" must be lowercase kebab-case (e.g. "bio-link")`);
  }

  if (errors.length) {
    console.error("utm-guard: refused.");
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }

  let url;
  try {
    url = new URL(target, vocab.baseUrl || undefined);
  } catch {
    console.error(`Cannot form a URL from "${target}". Set "baseUrl" in your vocabulary to tag relative paths.`);
    process.exit(2);
  }

  // A target that already carries utm_* params usually means the link went
  // through two tagging pipelines. Overwriting silently hides that, so
  // refuse unless --force. (Tag first, wrap in shorteners or click-tracking
  // second, and keep tagging idempotent.)
  const existing = [...url.searchParams.keys()].filter((k) => k.startsWith("utm_"));
  if (existing.length && !flags.force) {
    console.error(`utm-guard: refused. "${target}" already carries ${existing.join(", ")}.`);
    console.error("  Pass --force to overwrite the existing tags.");
    process.exit(1);
  }

  url.searchParams.set("utm_source", source);
  url.searchParams.set("utm_medium", medium);
  if (flags.campaign) url.searchParams.set("utm_campaign", flags.campaign);
  if (flags.content) url.searchParams.set("utm_content", flags.content);
  console.log(url.toString());
  if (inferred) console.error(`  medium "${medium}" inferred from source "${source}"`);
}

function lint(args, vocab) {
  const cfg = vocab.lint || {};
  const dirs = cfg.scanDirs || ["."];
  const exts = cfg.extensions || [".md", ".mdx", ".html", ".txt", ".json"];
  const host = cfg.urlHost;
  const param = cfg.requireParam || "utm_source";
  if (!host) {
    console.error('Set "lint.urlHost" in your vocabulary (the domain whose outbound links must be tagged).');
    process.exit(2);
  }
  const hostRe = new RegExp(`https?:\\/\\/(?:www\\.)?${escapeRe(host)}\\b[^\\s"'<>)\\]\\\\}|\`]*`, "gi");
  const assetRe = /\.(png|jpe?g|webp|gif|svg|ico|pdf|mp4|mov|webm|mp3|wav|css|js|map|woff2?|ttf|otf)(?:[?#]|$)/i;
  // Fallback presence check for URLs that fail to parse. The param is
  // escaped for the same reason the host is: config is data, not regex.
  const paramRe = new RegExp(`[?&]${escapeRe(param)}=`);

  const issues = [];
  let scanned = 0;

  const checkUrl = (u, file, lineNo) => {
    if (assetRe.test(u)) return;
    let parsed = null;
    try {
      parsed = new URL(u);
    } catch {
      // fall through to the regex presence check
    }
    if (!parsed) {
      if (!paramRe.test(u)) issues.push({ file, line: lineNo, url: u, reason: `missing ${param}` });
      return;
    }
    const q = parsed.searchParams;
    if (!q.has(param)) {
      issues.push({ file, line: lineNo, url: u, reason: `missing ${param}` });
      return;
    }
    // Value validation: a tag whose value is outside the vocabulary
    // splinters analytics just as badly as a missing tag.
    for (const [key, allowed] of [
      ["utm_source", vocab.sources],
      ["utm_medium", vocab.mediums],
    ]) {
      const val = q.get(key);
      if (val !== null && Array.isArray(allowed) && !allowed.includes(val)) {
        issues.push({ file, line: lineNo, url: u, reason: `${key} "${val}" is not in the vocabulary` });
      }
    }
    const campaign = q.get("utm_campaign");
    if (campaign !== null) {
      const err = campaignError(campaign, vocab);
      if (err) issues.push({ file, line: lineNo, url: u, reason: err });
    }
  };

  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        walk(p);
      } else if (exts.some((x) => e.name.endsWith(x))) {
        scanned++;
        const raw = fs.readFileSync(p, "utf8");
        // Ignore fenced code blocks; URLs there are usually examples.
        const stripped = raw.replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " "));
        stripped.split(/\r?\n/).forEach((line, i) => {
          hostRe.lastIndex = 0;
          let m;
          while ((m = hostRe.exec(line)) !== null) {
            checkUrl(m[0], p, i + 1);
          }
        });
      }
    }
  };

  const missingDirs = [];
  for (const d of dirs) {
    let st = null;
    try {
      st = fs.statSync(d);
    } catch {
      // missing
    }
    if (!st || !st.isDirectory()) {
      missingDirs.push(d);
      continue;
    }
    walk(d);
  }

  // A lint that scanned nothing proves nothing. Say so loudly, and refuse
  // outright when every configured scanDir is missing: a green check that
  // checked zero files is the exact failure mode this tool exists to prevent.
  if (scanned === 0) {
    console.error("utm-guard: WARNING. 0 files scanned.");
    if (missingDirs.length) {
      console.error(`  scanDirs that do not exist: ${missingDirs.join(", ")}`);
    }
    const emptyDirs = dirs.filter((d) => !missingDirs.includes(d));
    if (emptyDirs.length) {
      console.error(`  scanDirs with no files matching ${exts.join(", ")}: ${emptyDirs.join(", ")}`);
    }
    if (missingDirs.length === dirs.length) {
      console.error('  Every configured scanDir is missing. Fix "lint.scanDirs" in your vocabulary.');
      process.exit(2);
    }
  }

  if (issues.length === 0) {
    console.log(
      `utm-guard: OK. ${scanned} file(s) scanned, every ${host} link is tagged with values from the vocabulary.`,
    );
    process.exit(0);
  }
  const files = new Set(issues.map((i) => i.file));
  console.error(`utm-guard: FAIL. ${issues.length} issue(s) on ${host} links across ${files.size} file(s).\n`);
  for (const it of issues) console.error(`  ${it.file}:${it.line}  ${it.url}  (${it.reason})`);
  process.exit(1);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--version") || argv[0] === "-v") {
    console.log(readVersion());
    process.exit(0);
  }
  if (argv.includes("--help") || argv[0] === "-h") {
    console.log(usageText());
    process.exit(0);
  }

  const cmd = argv[0];
  let rest = argv.slice(1);

  // Pull out --vocab from anywhere in the args.
  const vi = rest.indexOf("--vocab");
  let vocabPath;
  if (vi >= 0) {
    vocabPath = rest[vi + 1];
    if (vocabPath === undefined || vocabPath.startsWith("--")) {
      console.error("missing value for --vocab");
      process.exit(2);
    }
    rest = rest.slice(0, vi).concat(rest.slice(vi + 2));
  }

  if (cmd === "build" || cmd === "lint") {
    const vocab = loadVocab(vocabPath);
    return cmd === "build" ? build(rest, vocab) : lint(rest, vocab);
  }

  console.error(usageText());
  process.exit(2);
}

main();
