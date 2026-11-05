import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = { skip: process.platform === "win32", timeout: 30_000 };
const digest = (data) => createHash("sha256").update(data).digest("hex");

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "passel-release-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, "source");
  const remote = path.join(directory, "origin.git");
  const bin = path.join(directory, "bin");
  mkdirSync(path.join(source, "scripts"), { recursive: true });
  mkdirSync(bin);
  for (const name of ["release.mjs", "source-release.py"]) {
    copyFileSync(path.join(ROOT, "scripts", name), path.join(source, "scripts", name));
  }
  writeFileSync(path.join(source, "README.md"), "# Fixture\n");
  writeFileSync(path.join(source, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- First release.\n\n### Fixed\n\n");
  writeFileSync(path.join(source, "source-release.json"), JSON.stringify({
    include: ["README.md", "CHANGELOG.md", "source-release.json", "scripts/*.mjs", "scripts/source-release.py"],
  }));
  const emptyConfig = path.join(directory, "gitconfig");
  writeFileSync(emptyConfig, "");
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_AUTHOR_NAME: "Release fixture",
    GIT_AUTHOR_EMAIL: "maintainer@example.test",
    GIT_COMMITTER_NAME: "Release fixture",
    GIT_COMMITTER_EMAIL: "maintainer@example.test",
    FAKE_CHECK_LOG: path.join(directory, "check.log"),
    FAKE_RELEASE_LOG: path.join(directory, "release.json"),
  };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) {
    delete env[name];
  }
  const git = (...args) => execFileSync("git", args, { cwd: source, env, encoding: "utf8", stdio: "pipe" }).trim();
  const writeCommand = (name, body) => {
    const filename = path.join(bin, name);
    writeFileSync(filename, `#!/usr/bin/env node\n${body}`);
    chmodSync(filename, 0o755);
  };
  writeCommand("npm", `
    const fs = require('node:fs');
    require('node:assert/strict').deepEqual(process.argv.slice(2), ['run', 'check']);
    fs.writeFileSync(process.env.FAKE_CHECK_LOG, 'called');
    if (process.env.FAKE_CHECK_POISON) fs.writeFileSync('README.md', 'ghp_' + 'x'.repeat(36));
    process.exit(Number(process.env.FAKE_CHECK_EXIT || 0));
  `);
  writeCommand("gh", `
    const fs = require('node:fs');
    const assert = require('node:assert/strict');
    const crypto = require('node:crypto');
    const { execFileSync } = require('node:child_process');
    const args = process.argv.slice(2);
    assert.deepEqual(args.slice(0, 3), ['release', 'create', 'v0.1.0']);
    const manifest = JSON.parse(fs.readFileSync('SOURCE_MANIFEST.json', 'utf8'));
    for (const [file, expected] of Object.entries(manifest.files)) {
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), expected, file);
    }
    const tag = execFileSync('git', ['rev-parse', 'v0.1.0'], { encoding: 'utf8' }).trim();
    fs.writeFileSync(process.env.FAKE_RELEASE_LOG, JSON.stringify({ tag, notes: fs.readFileSync(args[4], 'utf8') }));
  `);
  execFileSync("python3", ["scripts/source-release.py", "manifest"], { cwd: source, env, stdio: "pipe" });
  git("init", "--bare", remote);
  git("init", "--initial-branch=main");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  git("add", ".");
  git("commit", "-m", "Fixture");
  git("remote", "add", "origin", remote);
  git("push", "--set-upstream", "origin", "main");
  return {
    directory, source, remote, env, git,
    run: (extraEnv = {}) => spawnSync(process.execPath, ["scripts/release.mjs", "v0.1.0"], {
      cwd: source, env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 20_000,
    }),
  };
}

function assertManifest(fixture, revision) {
  const manifest = JSON.parse(fixture.git("show", `${revision}:SOURCE_MANIFEST.json`));
  for (const [file, expected] of Object.entries(manifest.files)) {
    const data = execFileSync("git", ["show", `${revision}:${file}`], { cwd: fixture.source, env: fixture.env });
    assert.equal(digest(data), expected, `${revision}:${file}`);
  }
}

test("release and next Unreleased commits both carry valid source manifests", options, (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const publication = JSON.parse(readFileSync(f.env.FAKE_RELEASE_LOG, "utf8"));
  assert.equal(publication.tag, f.git("rev-parse", "v0.1.0"));
  assert.match(publication.notes, /First release/);
  assertManifest(f, "v0.1.0");
  assertManifest(f, "HEAD");
  assert.equal(f.git("rev-parse", "HEAD^"), publication.tag);
  assert.equal(f.git("--git-dir", f.remote, "rev-parse", "refs/heads/main"), f.git("rev-parse", "HEAD"));
  assert.equal(f.git("--git-dir", f.remote, "rev-parse", "refs/tags/v0.1.0"), publication.tag);
  const released = f.git("show", "v0.1.0:CHANGELOG.md");
  assert.match(released, /## \[0\.1\.0\] - \d{4}-\d{2}-\d{2}/);
  assert.doesNotMatch(released, /Unreleased|### Fixed/);
  const next = readFileSync(path.join(f.source, "CHANGELOG.md"), "utf8");
  assert.match(next, /## \[Unreleased\]/);
  for (const section of ["Breaking Changes", "Added", "Changed", "Fixed", "Removed"]) {
    assert.ok(next.split("## [0.1.0]")[0].includes(`### ${section}`));
  }
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(existsSync(path.join(f.source, ".release-notes-tmp.md")), false);
});

test("failed checks leave history untouched and do not publish", options, (t) => {
  const f = fixture(t); const before = f.git("rev-parse", "HEAD");
  const result = f.run({ FAKE_CHECK_EXIT: "1" });
  assert.notEqual(result.status, 0);
  assert.equal(f.git("rev-parse", "HEAD"), before);
  assert.equal(f.git("tag", "--list"), "");
  assert.equal(f.git("status", "--porcelain"), "");
  assert.equal(existsSync(f.env.FAKE_RELEASE_LOG), false);
});

test("source validation failure stops before committing, tagging or publishing", options, (t) => {
  const f = fixture(t); const before = f.git("rev-parse", "HEAD");
  const result = f.run({ FAKE_CHECK_POISON: "1" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /blocked by access token/);
  assert.equal(f.git("rev-parse", "HEAD"), before);
  assert.equal(f.git("tag", "--list"), "");
  assert.equal(existsSync(f.env.FAKE_RELEASE_LOG), false);
  assert.equal(existsSync(path.join(f.source, ".release-notes-tmp.md")), false);
});

test("a dirty checkout is rejected before checks or publication", options, (t) => {
  const f = fixture(t); const before = f.git("rev-parse", "HEAD");
  writeFileSync(path.join(f.source, "README.md"), "Local work\n");
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /clean working tree/);
  assert.equal(f.git("rev-parse", "HEAD"), before);
  assert.equal(readFileSync(path.join(f.source, "README.md"), "utf8"), "Local work\n");
  assert.equal(existsSync(f.env.FAKE_CHECK_LOG), false);
  assert.equal(existsSync(f.env.FAKE_RELEASE_LOG), false);
});
