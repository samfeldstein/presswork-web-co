import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const base = (args.find((a) => !a.startsWith("--")) ?? "https://presswork.dev").replace(/\/$/, "");
const repeat = Number(flag("runs") ?? 0);
const only = flag("page");
const key = process.env.PAGESPEED_API_KEY;
const categories = ["performance", "accessibility", "best-practices", "seo"];
const endpoint = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

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

if (repeat && !only) {
  console.error("--runs needs --page=/path/");
  process.exit(1);
}

const outDir = ".pagespeed";
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

const bar = (done, total, label) => {
  const width = 20;
  const filled = Math.round((done / total) * width);
  process.stderr.write(`\r\x1b[K[${"■".repeat(filled)}${"·".repeat(width - filled)}] ${done}/${total} ${label}`);
};
const clearBar = () => process.stderr.write("\r\x1b[K");

const run = async (url) => {
  const query = new URLSearchParams({ url, strategy: "mobile" });
  for (const c of categories) query.append("category", c);
  if (key) query.set("key", key);
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${endpoint}?${query}`);
    if (res.ok) return res.json();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === 3) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`HTTP ${res.status}: ${body.error?.message ?? res.statusText}${res.status === 429 && !key ? " (set PAGESPEED_API_KEY to avoid the shared rate limit)" : ""}`);
    }
    await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
};

if (repeat) {
  const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  const results = [];
  console.log(`${base}${only}: ${repeat} runs\nrun  perf  host  firstPaint  FCP     LCP     SI`);
  for (let i = 1; i <= repeat; i++) {
    bar(i - 1, repeat, `running ${i}...`);
    try {
      const { lighthouseResult: lh } = await run(`${base}${only}?psi=${Date.now()}-${i}`);
      const m = lh.audits.metrics.details.items[0];
      const row = {
        perf: Math.round(lh.categories.performance.score * 100),
        host: Math.round(lh.environment.benchmarkIndex ?? 0),
        paint: m.observedFirstContentfulPaint,
        fcp: lh.audits["first-contentful-paint"].numericValue,
        lcp: lh.audits["largest-contentful-paint"].numericValue,
        si: lh.audits["speed-index"].numericValue,
      };
      results.push(row);
      clearBar();
      console.log(`${String(i).padEnd(5)}${String(row.perf).padEnd(6)}${String(row.host).padEnd(6)}${String(row.paint).padEnd(12)}${String(Math.round(row.fcp)).padEnd(8)}${String(Math.round(row.lcp)).padEnd(8)}${Math.round(row.si)}`);
    } catch (error) {
      clearBar();
      console.log(`${i}  failed: ${error.message}`);
    }
  }
  clearBar();
  if (results.length) console.log(`median perf ${median(results.map((r) => r.perf))}, min ${Math.min(...results.map((r) => r.perf))}, max ${Math.max(...results.map((r) => r.perf))}`);
  process.exit(0);
}

const rows = [];
const targets = only ? [only] : pages;
for (const [index, page] of targets.entries()) {
  bar(index, targets.length, `running ${page}`);
  try {
    const result = await run(`${base}${page}`);
    const lh = result.lighthouseResult;
    const name = page === "/" ? "home" : page.replace(/^\/|\/$/g, "").replace(/\//g, "-");
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(result, null, 1));
    const scores = categories.map((c) => Math.round(lh.categories[c].score * 100));
    rows.push([page, ...scores]);
    clearBar();
    console.log(`${page} ... ${scores.join(" / ")}`);
    const metrics = ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index"]
      .map((id) => `${id}: ${lh.audits[id]?.displayValue ?? "n/a"}`)
      .join(", ");
    console.log(`  ${metrics}`);
    for (const warning of lh.runWarnings ?? []) console.log(`  [run warning] ${warning}`);
    if (lh.finalDisplayedUrl && lh.finalDisplayedUrl !== `${base}${page}`) console.log(`  [redirected] ${lh.finalDisplayedUrl}`);
    if (scores.every((n) => n === 100)) continue;
    const seen = new Set();
    for (const category of categories) {
      for (const { id } of lh.categories[category].auditRefs) {
        const audit = lh.audits[id];
        if (seen.has(id)) continue;
        if (audit.scoreDisplayMode === "error") {
          seen.add(id);
          console.log(`  [${category}] audit errored: ${audit.title}${audit.errorMessage ? ` (${audit.errorMessage})` : ""}`);
          continue;
        }
        if (audit.score === null || audit.score >= 1) continue;
        if (!["binary", "numeric", "metricSavings"].includes(audit.scoreDisplayMode)) continue;
        seen.add(id);
        console.log(`  [${category}] ${audit.title}${audit.displayValue ? ` (${audit.displayValue})` : ""}`);
        for (const item of (Array.isArray(audit.details?.items) ? audit.details.items : []).slice(0, 5)) {
          console.log(`      ${String(describe(item)).replace(/\s+/g, " ").slice(0, 160)}`);
        }
      }
    }
  } catch (error) {
    clearBar();
    console.log(`${page} ... failed`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}

clearBar();
if (rows.length) {
  console.log(`\n${"page".padEnd(14)}perf  a11y  best  seo`);
  for (const [page, ...s] of rows) {
    console.log(page.padEnd(14) + s.map((n) => String(n).padEnd(6)).join(""));
  }
  const lowest = categories.map((_, i) => Math.min(...rows.map((r) => r[i + 1])));
  console.log(`${"lowest".padEnd(14)}${lowest.map((n) => String(n).padEnd(6)).join("")}`);
}
