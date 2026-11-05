import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export async function prepareWebNotices(root = ROOT, fetchSource = fetch) {
  const inventory = JSON.parse(await readFile(path.join(root, "third-party/inventory.json"), "utf8"));
  for (const [name, checksum] of Object.entries(inventory.inputs)) {
    if (sha256(await readFile(path.join(root, name))) !== checksum) {
      throw new Error(`Third-party notices are stale: ${name}. Regenerate and review them.`);
    }
  }
  const notices = await readFile(path.join(root, "THIRD_PARTY_NOTICES.txt"));
  if (sha256(notices) !== inventory.notice_sha256) throw new Error("Third-party notice checksum mismatch");

  const output = path.join(root, "web/public/notices");
  await mkdir(output, { recursive: true });
  for (const name of ["LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.txt"]) {
    await writeFile(path.join(output, name), await readFile(path.join(root, name)));
  }
  await mkdir(path.join(output, "third-party"), { recursive: true });
  await writeFile(path.join(output, "third-party/README.md"),
    await readFile(path.join(root, "third-party/README.md")));

  const { liberation_source: source } = JSON.parse(await readFile(path.join(root, "third-party/assets.json"), "utf8"));
  if (!/^[a-zA-Z0-9.-]+\.tar\.gz$/.test(source.filename)) throw new Error("Invalid font source filename");
  const directory = path.join(root, "web/public/pdf-assets/source");
  const target = path.join(directory, source.filename);
  let cached;
  try { cached = await readFile(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!cached || sha256(cached) !== source.sha256) {
    const response = await fetchSource(source.url, { signal: AbortSignal.timeout(90_000) });
    if (!response.ok) throw new Error("Could not retrieve the matching Liberation font source");
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > 8 * 1024 * 1024 || sha256(data) !== source.sha256) {
      throw new Error("Liberation font source checksum mismatch");
    }
    await mkdir(directory, { recursive: true });
    await writeFile(`${target}.tmp`, data);
    await rename(`${target}.tmp`, target);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareWebNotices();
}
