#!/usr/bin/env bun
// Builds the static report site: report.html -> index.html, findings/*.md -> styled HTML pages.
// Output lands in public/report/ so the dashboard app serves it at /report.
// Usage: bun analysis/report/build-site.mjs [outDir] [urlBase]

import { marked } from "marked";
import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const findingsDir = join(here, "..", "findings");
const out = process.argv[2] ?? join(here, "..", "..", "public", "report");
// URL prefix the site is served under — absolute so /report and /report/ both work
const base = (process.argv[3] ?? "/report").replace(/\/$/, "");

const DOCS = [
  { file: "findings.md", label: "Findings", navLabel: "Findings", title: "Findings — Community Friction Points" },
  { file: "triage.md", label: "Reply triage", navLabel: "Triage", title: "Reply triage — Community Friction Points" },
  { file: "edge-functions-deep-dive.md", label: "Edge Functions", title: "Edge Functions — Community Friction Points" },
  { file: "fact-check.md", label: "Fact-check", title: "Fact-check — Community Friction Points" },
];

const BRAND = "Community Friction Points";
const SUBTITLE = "Supabase community Discord · 41,392 threads · Aug 2022 – Aug 2026";

// One header for every page in the site — same logo tile, wordmark and link
// treatment as the dashboard's own header.
const brandbar = (current) => {
  const link = (href, label, cls = "") =>
    `<a href="${href}"${current === label ? ' class="on"' : cls ? ` class="${cls}"` : ""}>${label}</a>`;
  return `<div class="brandbar">
  <div class="wrap">
    <a class="brand" href="${base}/">
      <span class="brand-mark"><img src="/supabase-logo.svg" alt="" width="20" height="20"></span>
      <span class="brand-txt">
        <span class="brand-name">${BRAND}</span>
        <span class="brand-sub">${SUBTITLE}</span>
      </span>
    </a>
    <span class="spacer"></span>
    <nav class="brand-links" aria-label="Site">
      ${link("/", "Dashboard", "home")}
      <span class="sep"></span>
      ${link(`${base}/`, "Report")}
      ${link(`${base}/findings/findings.html`, "Findings")}
      ${link(`${base}/findings/triage.html`, "Triage")}
    </nav>
  </div>
</div>`;
};

const slug = (s) =>
  s.replace(/<[^>]+>/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const strip = (s) => s.replace(/<[^>]+>/g, "");

function transform(html) {
  const toc = [];
  const seen = new Set();

  html = html
    // relative doc links point at the built pages, not the raw markdown
    .replace(/href="(\.\/)?([\w.-]+)\.md(#[^"]*)?"/g, (_m, _d, name, hash) => `href="${base}/findings/${name}.html${hash ?? ""}"`)
    // headings get stable ids and feed the sidebar
    .replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_m, depth, inner) => {
      let id = slug(inner) || `s${toc.length}`;
      while (seen.has(id)) id += "-x";
      seen.add(id);
      const text = strip(inner);
      toc.push({ depth: +depth, id, text });
      // "## 3. Cross-batch patterns" -> the number becomes a quiet prefix
      const numbered = depth === "2" ? inner.replace(/^(\d+)\.\s+/, '<span class="n">$1</span>') : inner;
      return `<h${depth} id="${id}">${numbered}</h${depth}>`;
    })
    .replace(/<table>[\s\S]*?<\/table>/g, (t) => `<div class="tbl-wrap">${t}</div>`)
    .replace(/>True<\/td>/g, '><span class="pill rise">rising</span></td>')
    .replace(/>False<\/td>/g, '><span class="pill">—</span></td>')
    .replace(/<tr>([\s\S]*?)<\/tr>/g, (m, cells) => (cells.includes("pill rise") ? `<tr class="rise">${cells}</tr>` : m))
    // a paragraph opening with a bold label ("**Read:** …") is a callout
    .replace(/<p>(<strong>[^<]{2,60}:<\/strong>)/g, '<p class="callout">$1')
    // a bare comma-separated term dump renders as chips, not prose
    .replace(/<p>([^<>]{200,})<\/p>/g, (m, text) =>
      (text.match(/, /g) ?? []).length >= 15
        ? `<div class="chips">${text.split(/,\s*/).map((t) => `<span class="chip">${t.trim()}</span>`).join("")}</div>`
        : m,
    );

  return { html, toc };
}

function page({ doc, h1, lede, body, toc }) {
  const nav = DOCS.map(
    (d) =>
      `<a href="${base}/findings/${d.file.replace(/\.md$/, ".html")}"${d.file === doc.file ? ' class="on"' : ""}>${d.label}</a>`,
  ).join("\n    ");

  const tocHtml = toc.length
    ? `<nav class="toc" aria-label="On this page">
    <p class="t">On this page</p>
    <ol>${toc.map((t) => `<li${t.depth === 3 ? ' class="sub"' : ""}><a href="#${t.id}">${t.text}</a></li>`).join("")}</ol>
  </nav>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${doc.title}</title>
<link rel="stylesheet" href="${base}/assets/brand.css">
<link rel="stylesheet" href="${base}/assets/doc.css">
</head>
<body>

${brandbar(doc.navLabel)}

<nav>
  <div class="wrap">
    ${nav}
    <span class="divider"></span>
    <a href="${base}/findings/${doc.file}">source .md</a>
  </div>
</nav>

<div class="wrap">
  <div class="doc">
    <article>
      <div class="doc-head">
        <p class="eyebrow">${doc.file} · supporting detail</p>
        <h1>${h1}</h1>
        ${lede ? `<p class="lede">${lede}</p>` : ""}
      </div>
      ${body}
      <footer>
        <p>Generated from <span class="mono">analysis/findings/${doc.file}</span> — the raw markdown is still served alongside this page.</p>
        <p class="mono">Supabase community Discord · 41,392 threads · 270,020 replies · Aug 2022 – Aug 2026</p>
      </footer>
    </article>
    ${tocHtml}
  </div>
</div>

<script>
// highlight the section currently in view
const links = [...document.querySelectorAll('.toc a')];
const targets = links.map(a => document.getElementById(a.hash.slice(1))).filter(Boolean);
if (targets.length) {
  const seen = new Set();
  const io = new IntersectionObserver(entries => {
    for (const e of entries) e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id);
    const first = targets.find(t => seen.has(t.id));
    links.forEach(a => a.classList.toggle('on', !!first && a.hash === '#' + first.id));
  }, { rootMargin: '-72px 0px -70% 0px' });
  targets.forEach(t => io.observe(t));
}
</script>
</body>
</html>
`;
}

marked.use({ gfm: true, breaks: false });

await mkdir(join(out, "findings"), { recursive: true });
await cp(join(here, "assets"), join(out, "assets"), { recursive: true });

for (const doc of DOCS) {
  const md = await readFile(join(findingsDir, doc.file), "utf8");
  const rendered = marked.parse(md);
  const { html, toc } = transform(rendered);

  // first <h1> is the page title; the paragraph that follows it is the lede
  const h1 = html.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] ?? doc.title;
  let body = html.replace(/<h1>[\s\S]*?<\/h1>\s*/, "");
  const lede = body.match(/^<p[^>]*>([\s\S]*?)<\/p>\s*/);
  if (lede) body = body.slice(lede[0].length);

  await writeFile(join(out, "findings", doc.file.replace(/\.md$/, ".html")), page({ doc, h1, lede: lede?.[1], body, toc }));
  await writeFile(join(out, "findings", doc.file), md); // keep the raw .md reachable
  console.log(`  findings/${doc.file.replace(/\.md$/, ".html")}  (${toc.length} sections)`);
}

// report.html lives one level above findings/ in the repo, at ${base}/ once deployed
const report = await readFile(join(here, "report.html"), "utf8");
await writeFile(
  join(out, "index.html"),
  report
    .replace(/href="\.\.\/findings\/([\w.-]+)\.md"/g, `href="${base}/findings/$1.html"`)
    .replace(/url\("assets\//g, `url("${base}/assets/`)
    .replace(/(src|href)="assets\//g, `$1="${base}/assets/`)
    .replace("</head>", `<link rel="stylesheet" href="${base}/assets/brand.css">\n</head>`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${BRAND} — Supabase community forum</title>`)
    // the hand-written titlebar is replaced by the shared brand header
    .replace(/<div class="titlebar">[\s\S]*?<\/div>\n<\/div>/, brandbar("Report")),
);
console.log(`  index.html\n→ ${out}  (served at ${base}/)`);
