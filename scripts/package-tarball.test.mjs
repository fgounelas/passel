import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Passel archive contains a relocatable launcher, bridge, assets and notices", {
  skip: process.platform === "win32", timeout: 30_000,
}, (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "passel-packaging-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, "source");
  const bin = path.join(directory, "bin");
  for (const name of ["scripts", "docs", "bridge", "web/dist", "vendor/herdr-compat", "third-party"]) {
    mkdirSync(path.join(source, name), { recursive: true });
  }
  mkdirSync(bin);
  for (const name of [
    "scripts/package-tarball.sh", "docs/tarball-readme.md", "bridge/Cargo.toml",
    "LICENSE", "NOTICE.md", "vendor/herdr-compat/LICENSE-MIT",
    "vendor/herdr-compat/LICENSE-APACHE", "vendor/herdr-compat/NOTICE.md",
    "SECURITY.md", "THIRD_PARTY_NOTICES.txt", "third-party/README.md", "third-party/inventory.json",
  ]) copyFileSync(path.join(ROOT, name), path.join(source, name));
  writeFileSync(path.join(source, "web/dist/index.html"), "<title>Passel fixture</title>");
  const makeCommand = (name, text) => {
    const filename = path.join(bin, name);
    writeFileSync(filename, `#!/usr/bin/env node\n${text}`);
    chmodSync(filename, 0o755);
  };
  makeCommand("npm", `
    const args = process.argv.slice(2);
    require('node:assert/strict').deepEqual(args.slice(-2), ['run', 'build:web']);
  `);
  makeCommand("cargo", `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    const args = process.argv.slice(2);
    assert.equal(args[0], 'build'); assert.ok(args.includes('--release'));
    assert.equal(args[args.indexOf('--bin') + 1], 'passel-bridge');
    const manifest = args[args.indexOf('--manifest-path') + 1];
    assert.match(fs.readFileSync(manifest, 'utf8'), /name = "passel-bridge"/);
    const output = path.join(path.dirname(manifest), 'target/release/passel-bridge');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, '#!/usr/bin/env node\\nrequire("node:fs").writeFileSync(process.env.PACKAGE_TEST_LOG, JSON.stringify(process.argv.slice(2)));\\n');
    fs.chmodSync(output, 0o755);
  `);
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    PACKAGE_TEST_LOG: path.join(directory, "bridge-args.json"),
  };
  execFileSync("bash", ["scripts/package-tarball.sh", "v0.1.0-test", "linux-x86_64"], {
    cwd: source, env, stdio: "pipe",
  });
  const name = "passel-v0.1.0-test-linux-x86_64";
  const archive = path.join(source, "dist-packages", `${name}.tar.gz`);
  const listing = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
  for (const file of [
    "bin/passel", "bin/passel-bridge", "share/passel/web/index.html", "README.md", "LICENSE", "NOTICE.md",
    "vendor/herdr-compat/LICENSE-MIT", "vendor/herdr-compat/LICENSE-APACHE", "vendor/herdr-compat/NOTICE.md",
    "SECURITY.md", "THIRD_PARTY_NOTICES.txt", "third-party/README.md", "third-party/inventory.json",
  ]) assert.ok(listing.includes(`${name}/${file}`), file);
  assert.ok(!listing.some((file) => file.includes("bin/herdr-web") || file.includes("share/herdr-web")));
  const [checksum, filename] = readFileSync(`${archive}.sha256`, "utf8").trim().split(/\s+/);
  assert.equal(checksum, createHash("sha256").update(readFileSync(archive)).digest("hex"));
  assert.equal(filename, `${name}.tar.gz`);
  const unpacked = path.join(directory, "unpacked"); mkdirSync(unpacked);
  execFileSync("tar", ["-xzf", archive, "-C", unpacked]);
  execFileSync(path.join(unpacked, name, "bin/passel"), [
    "--host", "0.0.0.0", "--port", "4000", "--allow-origin", "http://localhost",
  ], { env, stdio: "pipe" });
  assert.deepEqual(JSON.parse(readFileSync(env.PACKAGE_TEST_LOG, "utf8")), [
    "--static-dir", path.join(unpacked, name, "share/passel/web"),
    "--host", "0.0.0.0", "--port", "4000", "--allow-origin", "http://localhost",
  ]);
});
