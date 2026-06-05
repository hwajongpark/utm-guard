"use strict";

import assert from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(__dirname, "..", "index.js");
const EXAMPLE_VOCAB = path.join(__dirname, "..", "examples", "utm.vocab.example.json");

function run(args, cwd) {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output: stdout };
  } catch (e) {
    return { code: e.status, output: (e.stdout || "") + (e.stderr || "") };
  }
}

function writeFixture(files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "utm-guard-"));
  fs.mkdirSync(path.join(tmp, "content"), { recursive: true });
  const vocab = {
    baseUrl: "https://example.com",
    sources: ["newsletter", "linkedin"],
    mediums: ["email", "social"],
    campaigns: ["launch"],
    lint: {
      scanDirs: ["content"],
      extensions: [".md"],
      urlHost: "example.com",
      requireParam: "utm_source",
    },
  };
  fs.writeFileSync(path.join(tmp, "utm.vocab.json"), JSON.stringify(vocab, null, 2));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(tmp, "content", name), body);
  }
  return tmp;
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

test("build emits a tagged URL from the vocabulary", () => {
  const { code, output } = run([
    "build", "/guides/arc-registration",
    "--source", "linkedin",
    "--medium", "social",
    "--campaign", "launch",
    "--vocab", EXAMPLE_VOCAB,
  ], path.join(__dirname, ".."));
  assert.strictEqual(code, 0);
  assert.match(output, /utm_source=linkedin/);
  assert.match(output, /utm_medium=social/);
  assert.match(output, /utm_campaign=launch/);
});

test("build refuses unknown vocabulary values", () => {
  const { code, output } = run([
    "build", "/guides/arc-registration",
    "--source", "LinkedIn",
    "--medium", "social",
    "--vocab", EXAMPLE_VOCAB,
  ], path.join(__dirname, ".."));
  assert.strictEqual(code, 1);
  assert.match(output, /not in the vocabulary/);
});

test("lint catches links missing the required tag", () => {
  const tmp = writeFixture({
    "bad.md": "https://example.com/guides/how-jeonse-works\n",
  });
  const { code, output } = run(["lint"], tmp);
  assert.strictEqual(code, 1);
  assert.match(output, /missing utm_source/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("lint catches hand-written values outside the vocabulary", () => {
  const tmp = writeFixture({
    "bad.md": "https://example.com/guides/arc?utm_source=LinkedIn&utm_medium=social\n",
  });
  const { code, output } = run(["lint"], tmp);
  assert.strictEqual(code, 1);
  assert.match(output, /utm_source "LinkedIn" is not in the vocabulary/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("lint passes valid tagged links", () => {
  const tmp = writeFixture({
    "good.md": "https://example.com/guides/arc?utm_source=linkedin&utm_medium=social&utm_campaign=launch\n",
  });
  const { code, output } = run(["lint"], tmp);
  assert.strictEqual(code, 0);
  assert.match(output, /OK/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

console.log(`\n${passed} passed`);
