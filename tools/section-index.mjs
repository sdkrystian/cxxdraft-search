import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { walkSectionPages, extractBreadcrumb } from "./extract.mjs";

const distDir = resolve(process.argv[2] || "dist");

async function main() {
  const sections = [];
  for await (const { abbr, $ } of walkSectionPages(distDir)) {
    const bc = extractBreadcrumb($);
    sections.push({
      abbr,
      secnum: bc.secnum,
      title: bc.title,
      breadcrumb: bc.deepest,
    });
  }

  sections.sort((a, b) => {
    const sa = a.secnum.split(/[.\s]+/).map((x) => (isNaN(+x) ? x : +x));
    const sb = b.secnum.split(/[.\s]+/).map((x) => (isNaN(+x) ? x : +x));
    for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
      const av = sa[i], bv = sb[i];
      if (av === undefined) return -1;
      if (bv === undefined) return 1;
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
    return 0;
  });

  const outDir = join(distDir, "search");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    join(outDir, "sections.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), count: sections.length, sections }, null, 0)
  );
  console.log(`section-index: ${sections.length} sections`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
