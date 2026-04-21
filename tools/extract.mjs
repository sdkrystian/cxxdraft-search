import { readdir, readFile } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { load } from "cheerio";

export async function* walkHtmlFiles(distDir) {
  for (const entry of await readdir(distDir, { withFileTypes: true })) {
    const full = join(distDir, entry.name);
    if (entry.isDirectory()) {
      yield* walkHtmlFiles(full);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      yield full;
    }
  }
}

export async function* walkSectionPages(distDir) {
  for await (const file of walkHtmlFiles(distDir)) {
    const rel = relative(distDir, file);
    if (rel === "index.html") continue;
    if (!rel.endsWith("/index.html")) continue;
    const dir = dirname(rel);
    if (dir.includes("/")) continue;
    const html = await readFile(file, "utf8");
    const $ = load(html);
    const paras = $(".para");
    if (paras.length === 0) continue;
    yield { file, abbr: dir, $, html };
  }
}

export function relPathToRoot(distDir, file) {
  const rel = relative(distDir, file);
  const depth = rel.split("/").length - 1;
  return depth === 0 ? "." : Array(depth).fill("..").join("/");
}

export function extractBreadcrumb($) {
  const headings = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const $el = $(el);
    const secnum = $el.find(".secnum").text().trim();
    const titleNode = $el.clone();
    titleNode.find(".secnum, .abbr_ref, .annexnum").remove();
    const title = titleNode.text().replace(/\s+/g, " ").trim();
    headings.push({ level: el.tagName.toLowerCase(), secnum, title });
  });
  if (headings.length === 0) return { secnum: "", title: "", deepest: "", chain: [] };
  const last = headings[headings.length - 1];
  return {
    secnum: last.secnum,
    title: last.title,
    deepest: [last.secnum, last.title].filter(Boolean).join(" "),
    chain: headings,
  };
}

export function extractParagraphs($, abbr) {
  const out = [];
  $(".para").each((_, el) => {
    const $el = $(el);
    const id = $el.attr("id");
    if (!id) return;
    const clone = $el.clone();
    clone.find(".marginalizedparent, .sourceLinkParent, .hidden_link").remove();
    const text = clone.text().replace(/\s+/g, " ").trim();
    if (!text) return;
    out.push({ paraId: id, anchor: `${abbr}/#${id}`, text });
  });
  return out;
}
