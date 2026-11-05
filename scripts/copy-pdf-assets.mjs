import { cp, mkdir } from "node:fs/promises";
import { prepareWebNotices } from "./prepare-web-notices.mjs";

await prepareWebNotices();
for (const name of ["standard_fonts", "cmaps"]) {
  const target = new URL(`../web/public/pdf-assets/${name}/`, import.meta.url);
  await mkdir(target, { recursive: true });
  await cp(new URL(`../web/node_modules/pdfjs-dist/${name}/`, import.meta.url), target, { recursive: true });
}
