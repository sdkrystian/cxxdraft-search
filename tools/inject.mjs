import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { walkHtmlFiles, walkSectionPages, relPathToRoot, extractBreadcrumb } from "./extract.mjs";

const distDir = resolve(process.argv[2] || "dist");

const triggerHtml = (prefix) => `
<button id="cxs-trigger" type="button" aria-label="Search" title="Search (/)" data-cxs-prefix="${prefix}">
  <span class="cxs-trigger-icon" aria-hidden="true">&#x1F50D;</span>
  <span class="cxs-trigger-label">Search</span>
  <kbd class="cxs-trigger-kbd">/</kbd>
</button>
`;

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function injectInto(html, prefix) {
  if (html.includes("id='cxs-trigger'") || html.includes('id="cxs-trigger"')) return html;

  const headTags =
    `<link rel="stylesheet" href="${prefix}/search.css">` +
    `<script src="${prefix}/search.js" defer></script>`;
  let out = html.replace(/<\/head>/i, `${headTags}</head>`);

  const wrapperOpen = out.indexOf("<div class='wrapper'>");
  if (wrapperOpen !== -1) {
    const insertAt = wrapperOpen + "<div class='wrapper'>".length;
    out = out.slice(0, insertAt) + triggerHtml(prefix) + out.slice(insertAt);
  } else {
    out = out.replace(/<body[^>]*>/i, (m) => `${m}${triggerHtml(prefix)}`);
  }
  return out;
}

async function processSectionPage({ file, abbr, $, html }) {
  const breadcrumb = extractBreadcrumb($);
  const prefix = relPathToRoot(distDir, file);

  let out = injectInto(html, prefix);

  if (!out.includes('data-pagefind-meta="abbr:')) {
    out = out.replace(
      /<div class='wrapper'>/,
      `<div class='wrapper' data-pagefind-meta="abbr:${escapeAttr(abbr)}" data-pagefind-meta="breadcrumb:${escapeAttr(breadcrumb.deepest)}">`
    );
  }
  await writeFile(file, out);
}

async function processOtherPage(file) {
  const prefix = relPathToRoot(distDir, file);
  const html = await readFile(file, "utf8");
  const out = injectInto(html, prefix);
  if (out !== html) await writeFile(file, out);
}

async function main() {
  const sectionFiles = new Set();
  let count = 0;
  for await (const page of walkSectionPages(distDir)) {
    sectionFiles.add(page.file);
    await processSectionPage(page);
    count++;
  }
  let others = 0;
  for await (const file of walkHtmlFiles(distDir)) {
    if (sectionFiles.has(file)) continue;
    await processOtherPage(file);
    others++;
  }
  console.log(`inject: ${count} section pages, ${others} other pages`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
