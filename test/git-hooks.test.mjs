// Tests for .githooks/check-guard (a push that changes check files needs a
// "Checks changed:" line) and .githooks/commit-msg (warns when a commit has
// no "Verified:" line). Same file in every site repo and in the
// static-site-stack skill's scripts/test/.
import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// In a site the hooks are in .githooks/; in the static-site-stack skill they
// sit in scripts/, next to this test's folder.
const here = dirname(fileURLToPath(import.meta.url));
const hooks = existsSync(join(here, "..", ".githooks")) ? join(here, "..", ".githooks") : join(here, "..");
const zero = "0".repeat(40);

// The tests run inside the pre-push hook too, where git sets GIT_DIR and
// friends; keep them, and Sam's own git config, away from the temp repos.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
Object.assign(env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });

// The hooks and these tests need git 2.36 or later; skip (visibly) on an older
// git, or none, such as a host build image, rather than fail the deploy.
let version = "";
try {
  version = execFileSync("git", ["--version"]).toString();
} catch {}
const [major, minor] = (version.match(/(\d+)\.(\d+)/) ?? [0, 0, 0]).slice(1).map(Number);
const test = major > 2 || (major === 2 && minor >= 36) ? nodeTest : (name) => nodeTest.skip(`${name} (needs git 2.36 or later; found ${version.trim() || "no git"})`);

function withRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), "hooks-"));
  const git = (...args) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: dir, env }).toString().trim();
  git("init", "-q", "-b", "main");
  // Stands in for a clone that has fetched from a remote at least once.
  git("commit", "-q", "--allow-empty", "-m", "Root");
  git("update-ref", "refs/remotes/origin/root", "HEAD");
  const commit = (msg, files = {}) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", msg);
    return git("rev-parse", "HEAD");
  };
  try {
    fn({ dir, git, commit });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function guard(dir, lines, script = join(hooks, "check-guard")) {
  const r = spawnSync("sh", [script], { cwd: dir, env, input: lines.join("\n") + "\n" });
  return { status: r.status, err: r.stderr.toString() };
}

const push = (sha, base, ref = "main") => [`refs/heads/${ref} ${sha} refs/heads/${ref} ${base}`];

test("a push that changes a test without a reason is refused, with one allowed", () =>
  withRepo(({ dir, commit }) => {
    const base = commit("Base", { "index.html": "x" });
    const bare = commit("Loosen a test", { "test/a.test.mjs": "y" });
    const res = guard(dir, push(bare, base));
    assert.equal(res.status, 1);
    assert.match(res.err, /test\/a\.test\.mjs/);
    const why = commit("Tighten it\n\nChecks changed: the old test passed on broken input.", { "test/a.test.mjs": "z" });
    assert.equal(guard(dir, push(why, base)).status, 0);
  }));

test("the reason must be in a commit that changes a check file", () =>
  withRepo(({ dir, commit }) => {
    const base = commit("Base");
    commit("Edit the check", { "check.mjs": "1" });
    const note = commit("Note\n\nChecks changed: drop a rule that never fired.");
    assert.equal(guard(dir, push(note, base)).status, 1);
    assert.equal(guard(dir, push(commit("Empty reason\n\nChecks changed:  ", { "check.mjs": "2" }), base)).status, 1);
  }));

test("the built-in list covers the core check files", () =>
  withRepo(({ dir, commit }) => {
    for (const path of ["check.mjs", "scripts/check.mjs", "sync.mjs", "scripts/sync.mjs", "test/x.test.mjs", ".githooks/pre-push", ".githooks/guarded-paths"]) {
      const base = commit("Base");
      assert.equal(guard(dir, push(commit(`Touch ${path}`, { [path]: String(Math.random()) }), base)).status, 1, path);
    }
  }));

test("moving a test out of test/ counts", () =>
  withRepo(({ dir, commit }) => {
    const base = commit("Base", { "test/old.test.mjs": "t" });
    renameSync(join(dir, "test/old.test.mjs"), join(dir, "old.test.mjs"));
    const res = guard(dir, push(commit("Move a test out"), base));
    assert.equal(res.status, 1);
    assert.match(res.err, /test\/old\.test\.mjs/);
  }));

test("other files, blank input, and branch deletes pass", () =>
  withRepo(({ dir, commit }) => {
    const base = commit("Base");
    const page = commit("Copy edit", { "site/index.html": "x", "docs/test/notes.md": "n", "mycheck.mjs": "m", "docs/skills/x/scripts/check.mjs": "c" });
    assert.equal(guard(dir, push(page, base)).status, 0);
    assert.equal(guard(dir, [`(delete) ${zero} refs/heads/old ${base}`]).status, 0);
    assert.equal(guard(dir, [""]).status, 0);
  }));

test("only commits not already on the remote count", () =>
  withRepo(({ dir, commit, git }) => {
    commit("Base");
    const old = commit("Old test change", { "test/a.test.mjs": "1" });
    const page = commit("Page", { "site/index.html": "x" });
    assert.equal(guard(dir, push(page, old)).status, 0);
    // A new branch: commits on any remote-tracking ref are not new.
    assert.equal(guard(dir, push(page, zero, "feature")).status, 1);
    git("update-ref", "refs/remotes/origin/main", old);
    assert.equal(guard(dir, push(page, zero, "feature")).status, 0);
    // A remote sha this clone has never seen falls back to the tracking refs.
    assert.equal(guard(dir, push(page, "1".repeat(40))).status, 0);
  }));

test("a force push that drops a check change is refused without a reason", () =>
  withRepo(({ dir, commit, git }) => {
    const base = commit("Base");
    const added = commit("Add a test\n\nChecks changed: new rule.", { "test/a.test.mjs": "1" });
    git("reset", "-q", "--hard", base);
    assert.equal(guard(dir, push(base, added)).status, 1);
    const page = commit("Page", { "site/a.html": "a" });
    assert.equal(guard(dir, push(page, added)).status, 1);
    const why = commit("Drop it\n\nChecks changed: the rule was wrong.");
    assert.equal(guard(dir, push(why, added)).status, 0);
  }));

test("a rebased feature branch is not refused for check changes already on main", () =>
  withRepo(({ dir, commit, git }) => {
    git("checkout", "-q", "-b", "feature");
    const f1 = commit("Feature page", { "site/a.html": "a" });
    git("checkout", "-q", "main");
    const mainTest = commit("Main test\n\nChecks changed: new rule.", { "test/a.test.mjs": "1" });
    git("update-ref", "refs/remotes/origin/main", mainTest);
    git("update-ref", "refs/remotes/origin/feature", f1);
    git("checkout", "-q", "feature");
    git("rebase", "-q", "main");
    assert.equal(guard(dir, push(git("rev-parse", "HEAD"), f1, "feature")).status, 0);
  }));

test("a rebase that skips a check change already on main is not refused", () =>
  withRepo(({ dir, commit, git }) => {
    git("checkout", "-q", "-b", "feature");
    commit("Feature test\n\nChecks changed: new rule.", { "test/a.test.mjs": "1" });
    const f2 = commit("Feature page", { "site/a.html": "a" });
    git("checkout", "-q", "main");
    commit("Main page", { "site/m.html": "m" });
    git("cherry-pick", "feature~1");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("update-ref", "refs/remotes/origin/feature", f2);
    git("checkout", "-q", "feature");
    git("rebase", "-q", "main");
    assert.equal(guard(dir, push(git("rev-parse", "HEAD"), f2, "feature")).status, 0);
  }));

test("odd file names under test/ still count", () =>
  withRepo(({ dir, commit }) => {
    const base = commit("Base");
    assert.equal(guard(dir, push(commit("Quote", { 'test/a"b.test.mjs': "1" }), base)).status, 1);
    assert.equal(guard(dir, push(commit("Accent", { "test/é.test.mjs": "1" }), base)).status, 1);
  }));

test("a clone with no remote-tracking branches is not checked", () =>
  withRepo(({ dir, commit, git }) => {
    git("update-ref", "-d", "refs/remotes/origin/root");
    const t = commit("Test", { "test/a.test.mjs": "1" });
    const res = guard(dir, push(t, zero));
    assert.equal(res.status, 0);
    assert.match(res.err, /skipped/);
  }));

test("a clean merge of already-pushed check changes does not count", () =>
  withRepo(({ dir, commit, git }) => {
    commit("Base");
    git("checkout", "-q", "-b", "feature");
    const feat = commit("Feature page", { "site/a.html": "a" });
    git("checkout", "-q", "main");
    const mainTest = commit("Main test", { "test/a.test.mjs": "1" });
    git("update-ref", "refs/remotes/origin/main", mainTest);
    git("checkout", "-q", "feature");
    git("merge", "-q", "--no-edit", "--no-ff", "main");
    assert.equal(guard(dir, push(git("rev-parse", "HEAD"), feat, "feature")).status, 0);
  }));

test("a merge that resolves a check-file conflict to the old version counts", () =>
  withRepo(({ dir, commit, git }) => {
    commit("Base", { "check.mjs": "v1" });
    git("checkout", "-q", "-b", "feature");
    const feat = commit("Feature check\n\nChecks changed: feature rule.", { "check.mjs": "feature" });
    git("checkout", "-q", "main");
    const tight = commit("Tighten\n\nChecks changed: stricter rule.", { "check.mjs": "v2" });
    git("update-ref", "refs/remotes/origin/main", tight);
    git("update-ref", "refs/remotes/origin/feature", feat);
    git("checkout", "-q", "feature");
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "merge", "-q", "main"], { cwd: dir, env });
    git("checkout", "--ours", "check.mjs");
    git("add", "check.mjs");
    git("commit", "-q", "--no-edit");
    const res = guard(dir, push(git("rev-parse", "HEAD"), feat, "feature"));
    assert.equal(res.status, 1);
    assert.match(res.err, /check\.mjs/);
  }));

test("a guarded-paths file next to the script adds repo-specific paths", () =>
  withRepo(({ dir, commit }) => {
    const copy = mkdtempSync(join(tmpdir(), "guard-"));
    try {
      copyFileSync(join(hooks, "check-guard"), join(copy, "check-guard"));
      writeFileSync(join(copy, "guarded-paths"), "# comment\n\n^site\\.config\\.json$\n");
      const base = commit("Base");
      const cfg = commit("Config", { "site.config.json": "{}" });
      assert.equal(guard(dir, push(cfg, base), join(copy, "check-guard")).status, 1);
      // The built-in list still applies, whatever the file says.
      const tst = commit("Test", { "test/a.test.mjs": "1" });
      assert.equal(guard(dir, push(tst, cfg), join(copy, "check-guard")).status, 1);
      writeFileSync(join(copy, "guarded-paths"), "^site/(broken\n");
      const page = commit("Page", { "site/a.html": "a" });
      const bad = guard(dir, push(page, tst), join(copy, "check-guard"));
      assert.equal(bad.status, 1);
      assert.match(bad.err, /not a valid regex/);
      writeFileSync(join(copy, "guarded-paths"), "^site\\.config\\.json$ \r\n");
      const cfg2 = commit("Config again", { "site.config.json": "{ }" });
      assert.equal(guard(dir, push(cfg2, page), join(copy, "check-guard")).status, 1);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  }));

function commitMsg(text, { script = join(hooks, "commit-msg"), cwd = tmpdir() } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "msg-"));
  try {
    const file = join(dir, "COMMIT_EDITMSG");
    writeFileSync(file, text);
    const r = spawnSync("sh", [script, file], { cwd, env });
    return { status: r.status, err: r.stderr.toString() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("commit-msg warns without a Verified line but lets the commit through", () => {
  const res = commitMsg("Fix the menu\n\nCo-Authored-By: x\n");
  assert.equal(res.status, 0);
  assert.match(res.err, /Verified:/);
});

test("commit-msg is quiet with a Verified line, and ignores comments and the -v diff", () => {
  assert.equal(commitMsg("Fix the menu\n\nVerified: check, tests\n").err, "");
  assert.match(commitMsg("Fix the menu\n# Verified: check\n").err, /Verified:/);
  assert.match(commitMsg("Fix\n\nVerified:\n").err, /Verified:/);
  const scissors = `# ${"-".repeat(24)} >8 ${"-".repeat(24)}\n`;
  assert.match(commitMsg(`Fix\n${scissors}Verified: x\n`).err, /Verified:/);
});

test("commit-msg skips merges and fixups", () => {
  assert.equal(commitMsg("fixup! Fix the menu\n").err, "");
  withRepo(({ dir, commit, git }) => {
    commit("Base");
    writeFileSync(join(dir, ".git", "MERGE_HEAD"), git("rev-parse", "HEAD") + "\n");
    assert.equal(commitMsg("Merge branch 'x'\n", { cwd: dir }).err, "");
  });
  assert.match(commitMsg("Merge two pages\n").err, /Verified:/);
});

test("commit-msg warns when staged check files have no Checks changed line", () =>
  withRepo(({ dir, git }) => {
    const script = join(dir, ".githooks", "commit-msg");
    mkdirSync(join(dir, ".githooks"));
    copyFileSync(join(hooks, "commit-msg"), script);
    writeFileSync(join(dir, ".githooks", "guarded-paths"), "^shared/facts\\.json$\n");
    mkdirSync(join(dir, "shared"));
    writeFileSync(join(dir, "shared", "facts.json"), "{}");
    git("add", "shared/facts.json");
    assert.match(commitMsg("Title\n\nVerified: check\n", { script, cwd: dir }).err, /Checks changed/);
    assert.equal(commitMsg("Title\n\nChecks changed: new title rule.\n\nVerified: check\n", { script, cwd: dir }).err, "");
  }));

test("commit-msg blocks when MODE=block", () => {
  const dir = mkdtempSync(join(tmpdir(), "mode-"));
  try {
    const script = join(dir, "commit-msg");
    const text = readFileSync(join(hooks, "commit-msg"), "utf8");
    assert.match(text, /^MODE=warn$/m);
    writeFileSync(script, text.replace(/^MODE=warn$/m, "MODE=block"));
    assert.equal(commitMsg("Fix the menu\n", { script }).status, 1);
    assert.equal(commitMsg("Fix the menu\n\nVerified: check\n", { script }).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
