#!/usr/bin/env node
// utm-guard
//
// Two jobs around one controlled vocabulary of UTM values:
//   build  - make a UTM-tagged URL, refusing any source/medium/campaign that
//            is not in your vocabulary (so analytics never splinters into
//            linkedin / LinkedIn / li)
//   lint   - scan your files for outbound links that forgot their UTM tags
//
// Exit code is 0 when clean, 1 when something is refused or untagged, 2 on a
// config or usage error. No dependencies.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function loadVocab(p) {
  const file = p || "utm.vocab.json";
  if (!fs.existsSync(file)) {
    console.error(`No vocabulary at ${file}. Pass --vocab <path>, or create utm.vocab.json.`);
    console.error(`Start from examples/utm.vocab.example.json.`);
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
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    } else {
      positional.push(args[i]);
    }
  }
  return { flags, positional };
}

function build(args, vocab) {
  const { flags, positional } = parseFlags(args);
  const target = positional[0];
  if (!target) {
    console.error("Usage: utm-guard build <path-or-url> --source <s> --medium <m> [--campaign <c>]");
    process.exit(2);
  }

  // Validate each value against the vocabulary. source and medium are required;
  // campaign is optional unless you list campaigns and pass one.
  const rules = [
    { key: "source", allowed: vocab.sources, required: true },
    { key: "medium", allowed: vocab.mediums, required: true },
    { key: "campaign", allowed: vocab.campaigns, required: false },
  ];
  const errors = [];
  for (const { key, allowed, required } of rules) {
    const val = flags[key];
    if (!val) {
      if (required) errors.push(`missing --${key}`);
      continue;
    }
    if (Array.isArray(allowed) && !allowed.includes(val)) {
      errors.push(`--${key} "${val}" is not in the vocabulary. Allowed: ${allowed.join(", ")}`);
    }
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
  url.searchParams.set("utm_source", flags.source);
  url.searchParams.set("utm_medium", flags.medium);
  if (flags.campaign) url.searchParams.set("utm_campaign", flags.campaign);
  console.log(url.toString());
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
  // Escape every regex metacharacter in the configured host, not just dots, so
  // a host value cannot inject regex (broken matches, or a catastrophic-backtracking pattern).
  const escapedHost = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hostRe = new RegExp(`https?:\\/\\/(?:www\\.)?${escapedHost}\\b[^\\s"'<>)\\]\\\\}|\`]*`, "gi");
  const assetRe = /\.(png|jpe?g|webp|gif|svg|ico|pdf|mp4|mov|webm|css|js|woff2?|ttf)(?:[?#]|$)/i;
  const paramRe = new RegExp(`[?&]${param}=`);

  const issues = [];
  let scanned = 0;
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
            const u = m[0];
            if (assetRe.test(u)) continue;
            if (paramRe.test(u)) continue;
            issues.push({ file: p, line: i + 1, url: u });
          }
        });
      }
    }
  };
  for (const d of dirs) walk(d);

  if (issues.length === 0) {
    console.log(`utm-guard: OK. ${scanned} file(s) scanned, every ${host} link carries ${param}.`);
    process.exit(0);
  }
  const files = new Set(issues.map((i) => i.file));
  console.error(`utm-guard: FAIL. ${issues.length} ${host} link(s) missing ${param} across ${files.size} file(s).\n`);
  for (const it of issues) console.error(`  ${it.file}:${it.line}  ${it.url}`);
  process.exit(1);
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  let rest = argv.slice(1);

  // Pull out --vocab from anywhere in the args.
  const vi = rest.indexOf("--vocab");
  let vocabPath;
  if (vi >= 0) {
    vocabPath = rest[vi + 1];
    rest = rest.slice(0, vi).concat(rest.slice(vi + 2));
  }

  if (cmd === "build" || cmd === "lint") {
    const vocab = loadVocab(vocabPath);
    return cmd === "build" ? build(rest, vocab) : lint(rest, vocab);
  }

  console.error("utm-guard");
  console.error("  utm-guard build <path-or-url> --source <s> --medium <m> [--campaign <c>]");
  console.error("  utm-guard lint");
  console.error("Options:");
  console.error("  --vocab <path>   vocabulary file (default: utm.vocab.json)");
  process.exit(2);
}

main();
