import { execFileSync } from "node:child_process";
import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "");
const categories = ["performance", "accessibility", "best-practices", "seo"];

const pages = [];
const walk = (dir, url) => {
  if (existsSync(join(dir, "index.html"))) pages.push(url);
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory() && !["css", "js", "fonts", "img"].includes(name)) {
      walk(path, `${url}${name}/`);
    }
  }
};
walk("site", "/");
pages.sort();

const outDir = ".lighthouse";
mkdirSync(outDir, { recursive: true });

const describe = (item) =>
  item.node?.snippet ??
  item.node?.selector ??
  item.url ??
  item.source?.url ??
  item.label ??
  item.text ??
  item.description ??
  JSON.stringify(item);

const rows = [];
for (const page of pages) {
  process.stdout.write(`${page} ... `);
  try {
    const out = execFileSync(
      "npx",
      [
        "--yes",
        "lighthouse",
        `${base}${page}`,
        "--quiet",
        "--output=json",
        "--output-path=stdout",
        `--only-categories=${categories.join(",")}`,
        "--chrome-flags=--headless=new",
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const report = JSON.parse(out);
    const { categories: result, audits } = report;
    const scores = categories.map((c) => Math.round(result[c].score * 100));
    rows.push([page, ...scores]);
    console.log(scores.join(" / "));
    const name = page === "/" ? "home" : page.replace(/^\/|\/$/g, "").replace(/\//g, "-");
    writeFileSync(join(outDir, `${name}.json`), out);
    const metrics = ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index"]
      .map((id) => `${id}: ${audits[id]?.displayValue ?? "n/a"}`)
      .join(", ");
    console.log(`  ${metrics}`);
    const seen = new Set();
    for (const category of categories) {
      for (const { id } of result[category].auditRefs) {
        const audit = audits[id];
        if (seen.has(id) || audit.score === null || audit.score >= 1) continue;
        if (!["binary", "numeric", "metricSavings"].includes(audit.scoreDisplayMode)) continue;
        seen.add(id);
        console.log(`  [${category}] ${audit.title}${audit.displayValue ? ` (${audit.displayValue})` : ""}`);
        for (const item of (Array.isArray(audit.details?.items) ? audit.details.items : []).slice(0, 5)) {
          console.log(`      ${String(describe(item)).replace(/\s+/g, " ").slice(0, 160)}`);
        }
      }
    }
  } catch (error) {
    console.log("failed");
    console.error(String(error.stderr ?? error.message).split("\n").slice(0, 3).join("\n"));
    process.exitCode = 1;
  }
}

if (rows.length) {
  console.log(`\n${"page".padEnd(14)}perf  a11y  best  seo`);
  for (const [page, ...s] of rows) {
    console.log(page.padEnd(14) + s.map((n) => String(n).padEnd(6)).join(""));
  }
  const lowest = categories.map((_, i) => Math.min(...rows.map((r) => r[i + 1])));
  console.log(`${"lowest".padEnd(14)}${lowest.map((n) => String(n).padEnd(6)).join("")}`);
}
