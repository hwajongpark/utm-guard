import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BIN = path.join(ROOT, "index.js");

function run(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", cwd: ROOT });
}

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "utm-guard-test-"));
}

function writeVocab(dir, vocab) {
  const p = path.join(dir, "utm.vocab.json");
  fs.writeFileSync(p, JSON.stringify(vocab, null, 2));
  return p;
}

const BASE_VOCAB = {
  baseUrl: "https://example.com",
  sources: ["newsletter", "linkedin", "reddit"],
  mediums: ["social", "email", "dm"],
  defaultMediumForSource: { newsletter: "email", linkedin: "social" },
};

// ---------------------------------------------------------------- build

test("build prints a tagged URL and exits 0", () => {
  const vocab = writeVocab(tmpdir(), BASE_VOCAB);
  const r = run(["build", "/guides/arc", "--source", "linkedin", "--medium", "social", "--campaign", "launch", "--vocab", vocab]);
  assert.equal(r.status, 0);
  assert.equal(
    r.stdout.trim(),
    "https://example.com/guides/arc?utm_source=linkedin&utm_medium=social&utm_campaign=launch",
  );
});

test("build refuses a source outside the vocabulary with exit 1", () => {
  const vocab = writeVocab(tmpdir(), BASE_VOCAB);
  const r = run(["build", "/guides/arc", "--source", "LinkedIn", "--medium", "social", "--vocab", vocab]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refused/);
  assert.match(r.stderr, /--source "LinkedIn" is not in the vocabulary/);
});

test("build infers the medium from defaultMediumForSource", () => {
  const vocab = writeVocab(tmpdir(), BASE_VOCAB);
  const r = run(["build", "/guides/arc", "--source", "newsletter", "--campaign", "launch", "--vocab", vocab]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /utm_medium=email/);
  assert.match(r.stderr, /medium "email" inferred from source "newsletter"/);
});

test("build errors when no medium is given and no default exists", () => {
  const vocab = writeVocab(tmpdir(), BASE_VOCAB);
  const r = run(["build", "/guides/arc", "--source", "reddit", "--vocab", vocab]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing --medium/);
});

test("build appends utm_content and validates its format", () => {
  const vocab = writeVocab(tmpdir(), BASE_VOCAB);
  const ok = run(["build", "/g", "--source", "linkedin", "--campaign", "launch", "--content", "bio-link", "--vocab", vocab]);
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /utm_content=bio-link/);

  const bad = run(["build", "/g", "--source", "linkedin", "--content", "Bio_Link", "--vocab", vocab]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--content "Bio_Link" must be lowercase kebab-case/);
});

test("build enforces kebab-case campaigns when no campaigns list is configured", () => {
  const vocab = writeVocab(tmpdir(), BASE_VOCAB);
  const r = run(["build", "/g", "--source", "linkedin", "--campaign", "Spring_Launch", "--vocab", vocab]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--campaign "Spring_Launch" must be lowercase kebab-case/);
});

test("build keeps enum behavior when a campaigns list is configured", () => {
  const vocab = writeVocab(tmpdir(), { ...BASE_VOCAB, campaigns: ["launch", "evergreen"] });
  const bad = run(["build", "/g", "--source", "linkedin", "--campaign", "spring-launch", "--vocab", vocab]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--campaign "spring-launch" is not in the vocabulary/);

  const ok = run(["build", "/g", "--source", "linkedin", "--campaign", "launch", "--vocab", vocab]);
  assert.equal(ok.status, 0);
});

test("build refuses an already-tagged target unless --force", () => {
  const vocab = writeVocab(tmpdir(), BASE_VOCAB);
  const target = "https://example.com/g?utm_source=newsletter&utm_medium=email";
  const refused = run(["build", target, "--source", "linkedin", "--vocab", vocab]);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /already carries utm_source, utm_medium/);
  assert.match(refused.stderr, /--force/);

  const forced = run(["build", target, "--source", "linkedin", "--force", "--vocab", vocab]);
  assert.equal(forced.status, 0);
  assert.match(forced.stdout, /utm_source=linkedin/);
  assert.match(forced.stdout, /utm_medium=social/);
});

// ---------------------------------------------------------------- CLI

test("a flag missing its value errors instead of swallowing the next flag", () => {
  const vocab = writeVocab(tmpdir(), BASE_VOCAB);
  const r = run(["build", "/g", "--source", "--medium", "social", "--vocab", vocab]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /missing value for --source/);
});

test("--help exits 0 and prints usage", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /utm-guard build <path-or-url>/);
});

test("--version exits 0 and prints the package version", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const r = run(["--version"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), pkg.version);
});

// ---------------------------------------------------------------- lint

function lintVocab(contentDir, extra = {}) {
  return {
    ...BASE_VOCAB,
    lint: { scanDirs: [contentDir], extensions: [".md"], urlHost: "example.com", ...extra },
  };
}

test("lint flags an untagged link", () => {
  const dir = tmpdir();
  const content = path.join(dir, "content");
  fs.mkdirSync(content);
  fs.writeFileSync(path.join(content, "post.md"), "See https://example.com/guides/arc for details.\n");
  const vocab = writeVocab(dir, lintVocab(content));
  const r = run(["lint", "--vocab", vocab]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing utm_source/);
});

test("lint flags tag values outside the vocabulary, naming the value", () => {
  const dir = tmpdir();
  const content = path.join(dir, "content");
  fs.mkdirSync(content);
  fs.writeFileSync(
    path.join(content, "post.md"),
    [
      "https://example.com/a?utm_source=LinkedIn&utm_medium=social",
      "https://example.com/b?utm_source=linkedin&utm_medium=Social_Media",
      "https://example.com/c?utm_source=linkedin&utm_medium=social&utm_campaign=Spring_Launch",
    ].join("\n") + "\n",
  );
  const vocab = writeVocab(dir, lintVocab(content));
  const r = run(["lint", "--vocab", vocab]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /utm_source "LinkedIn" is not in the vocabulary/);
  assert.match(r.stderr, /utm_medium "Social_Media" is not in the vocabulary/);
  assert.match(r.stderr, /utm_campaign "Spring_Launch" must be lowercase kebab-case/);
});

test("lint passes a fully tagged file with vocabulary values", () => {
  const dir = tmpdir();
  const content = path.join(dir, "content");
  fs.mkdirSync(content);
  fs.writeFileSync(
    path.join(content, "post.md"),
    "https://example.com/a?utm_source=newsletter&utm_medium=email&utm_campaign=spring-launch\n",
  );
  const vocab = writeVocab(dir, lintVocab(content));
  const r = run(["lint", "--vocab", vocab]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /OK\. 1 file\(s\) scanned/);
});

test("lint exits 2 when every configured scanDir is missing", () => {
  const dir = tmpdir();
  const vocab = writeVocab(dir, lintVocab(path.join(dir, "does-not-exist")));
  const r = run(["lint", "--vocab", vocab]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /0 files scanned/);
  assert.match(r.stderr, /scanDirs that do not exist/);
  assert.match(r.stderr, /Every configured scanDir is missing/);
});

test("lint warns loudly when scanDirs exist but match no files", () => {
  const dir = tmpdir();
  const content = path.join(dir, "empty");
  fs.mkdirSync(content);
  const vocab = writeVocab(dir, lintVocab(content));
  const r = run(["lint", "--vocab", vocab]);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /WARNING\. 0 files scanned/);
  assert.match(r.stderr, /no files matching/);
});

test("lint treats requireParam as a literal, not a regex", () => {
  const dir = tmpdir();
  const content = path.join(dir, "content");
  fs.mkdirSync(content);
  // With an unescaped pattern, "utm.source" would match "utmXsource" and
  // this untagged link would slip through.
  fs.writeFileSync(path.join(content, "post.md"), "https://example.com/a?utmXsource=1\n");
  const vocab = writeVocab(dir, lintVocab(content, { requireParam: "utm.source" }));
  const r = run(["lint", "--vocab", vocab]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing utm\.source/);
});
