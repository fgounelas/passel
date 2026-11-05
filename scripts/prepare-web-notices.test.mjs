import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareWebNotices } from "./prepare-web-notices.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "passel-notices-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "third-party"));
  await writeFile(path.join(root, "third-party/README.md"), "Notice scope fixture");
  await writeFile(path.join(root, "LICENSE"), "Passel licence fixture");
  await writeFile(path.join(root, "NOTICE.md"), "Attribution fixture");
  await writeFile(path.join(root, "THIRD_PARTY_NOTICES.txt"), "Dependency notices fixture");
  await writeFile(path.join(root, "dependency.lock"), "version 1");
  const source = Buffer.from("upstream font source fixture");
  await writeFile(path.join(root, "third-party/assets.json"), JSON.stringify({
    liberation_source: { filename: "liberation-fonts-1.07.4.tar.gz", url: "https://example.test/source", sha256: sha256(source) },
  }));
  await writeFile(path.join(root, "third-party/inventory.json"), JSON.stringify({
    inputs: { "dependency.lock": sha256("version 1") }, notice_sha256: sha256("Dependency notices fixture"),
  }));
  return { root, source };
}

test("web assets include notices and verified font source; later offline builds reuse it", async (t) => {
  const { root, source } = await fixture(t);
  await prepareWebNotices(root, async () => new Response(source));
  assert.equal(await readFile(path.join(root, "web/public/notices/THIRD_PARTY_NOTICES.txt"), "utf8"), "Dependency notices fixture");
  assert.deepEqual(await readFile(path.join(root, "web/public/pdf-assets/source/liberation-fonts-1.07.4.tar.gz")), source);
  await prepareWebNotices(root, () => { throw new Error("An intact cache must not use the network"); });
});

test("a changed lockfile blocks distribution until its notices are reviewed", async (t) => {
  const { root } = await fixture(t);
  await writeFile(path.join(root, "dependency.lock"), "version 2");
  await assert.rejects(prepareWebNotices(root, () => { throw new Error("Unexpected network request"); }), /notices are stale/);
});

test("unverified font source is rejected before it can enter a build", async (t) => {
  const { root } = await fixture(t);
  await assert.rejects(prepareWebNotices(root, async () => new Response("different source")), /checksum mismatch/);
  await assert.rejects(readFile(path.join(root, "web/public/pdf-assets/source/liberation-fonts-1.07.4.tar.gz")), { code: "ENOENT" });
});
