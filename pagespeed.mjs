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
const notFound = "/404";
pages.push(notFound);

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
  const results = [];
  bar(0, repeat + 1, "warm-up run (not counted)...");
  await run(`${base}${only}?psi=${Date.now()}-0`).catch(() => {});
  clearBar();
  console.log(`${base}${only}: ${repeat} runs after one warm-up\nrun  perf  a11y  best  seo   host  firstPaint  FCP     LCP     SI`);
  for (let i = 1; i <= repeat; i++) {
    bar(i, repeat + 1, `running ${i}...`);
    try {
      const result = await run(`${base}${only}?psi=${Date.now()}-${i}`);
      const lh = result.lighthouseResult;
      const m = lh.audits.metrics.details.items[0];
      const [perf, a11y, best, seo] = categories.map((c) => Math.round(lh.categories[c].score * 100));
      const row = {
        result,
        perf, a11y, best, seo,
        host: Math.round(lh.environment.benchmarkIndex ?? 0),
        paint: m.observedFirstContentfulPaint,
        fcp: lh.audits["first-contentful-paint"].numericValue,
        lcp: lh.audits["largest-contentful-paint"].numericValue,
        si: lh.audits["speed-index"].numericValue,
      };
      results.push(row);
      clearBar();
      console.log(`${String(i).padEnd(5)}${[perf, a11y, best, seo, row.host].map((n) => String(n).padEnd(6)).join("")}${String(row.paint).padEnd(12)}${String(Math.round(row.fcp)).padEnd(8)}${String(Math.round(row.lcp)).padEnd(8)}${Math.round(row.si)}`);
    } catch (error) {
      clearBar();
      console.log(`${i}  failed: ${error.message}`);
    }
  }
  clearBar();
  if (!results.length) process.exit(1);
  const perfs = results.map((r) => r.perf);
  const mid = [...results].sort((a, b) => a.perf - b.perf)[Math.floor(results.length / 2)];
  const lh = mid.result.lighthouseResult;
  const weight = lh.audits["total-byte-weight"];
  const largest = weight?.details?.items?.[0];
  const field = mid.result.loadingExperience?.metrics;
  console.log(`\nmedian run (by perf): perf ${mid.perf}, a11y ${mid.a11y}, best ${mid.best}, seo ${mid.seo}`);
  console.log(`perf min ${Math.min(...perfs)}, max ${Math.max(...perfs)}${Math.max(...perfs) - Math.min(...perfs) > 10 ? "  (spread over 10 points: rerun)" : ""}`);
  console.log(["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index"]
    .map((id) => `${id}: ${lh.audits[id]?.displayValue ?? "n/a"}`).join(", "));
  console.log(`page weight: ${weight?.numericValue ? `${(weight.numericValue / 1048576).toFixed(1)} MB` : "n/a"}`);
  if (largest) console.log(`largest file: ${largest.url} (${(largest.totalBytes / 1048576).toFixed(1)} MB)`);
  console.log(`field data: ${field ? Object.entries(field).map(([k, v]) => `${k} ${v.category}`).join(", ") : "none"}`);
  console.log(`Lighthouse ${lh.lighthouseVersion}, ${lh.fetchTime}`);
  const name = only === "/" ? "home" : only.replace(/^\/|\/$/g, "").replace(/\//g, "-");
  const dir = join(outDir, new URL(base).hostname);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${lh.fetchTime.slice(0, 10)}-${name}.json`);
  writeFileSync(file, JSON.stringify(mid.result, null, 1));
  console.log(`saved the median run to ${file}`);
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
  const scored = rows.filter(([page]) => page !== notFound);
  const lowest = categories.map((_, i) => Math.min(...scored.map((r) => r[i + 1])));
  if (scored.length) console.log(`${"lowest".padEnd(14)}${lowest.map((n) => String(n).padEnd(6)).join("")}`);
}
