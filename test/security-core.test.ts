const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  computeEffectiveTimeout,
  evaluateMutationPolicy,
  parseCommandString,
  resolveContainedPath,
  validateCliPath,
} = require("../src/security-core.ts");

test("parseCommandString parses quoted arguments", () => {
  const parsed = parseCommandString('npm run test -- --grep "hello world"');
  assert.deepEqual(parsed, {
    executable: "npm",
    args: ["run", "test", "--", "--grep", "hello world"],
  });
});

test("parseCommandString rejects shell chaining", () => {
  assert.throws(
    () => parseCommandString("git && whoami"),
    /shell control character/
  );
});

test("parseCommandString rejects command substitution", () => {
  assert.throws(
    () => parseCommandString("node $(whoami)"),
    /Command substitution/
  );
});

test("validateCliPath accepts bare executable names and absolute paths", () => {
  assert.deepEqual(validateCliPath("agent"), { normalized: "agent", kind: "bare" });
  assert.deepEqual(validateCliPath("C:\\Tools\\agent.exe"), {
    normalized: "C:\\Tools\\agent.exe",
    kind: "absolute",
  });
});

test("validateCliPath rejects relative paths and shell characters", () => {
  assert.throws(() => validateCliPath("./agent"), /bare executable name or an absolute path/);
  assert.throws(() => validateCliPath("agent && whoami"), /unsupported shell control characters/);
});

test("computeEffectiveTimeout prefers the stricter timeout", () => {
  assert.deepEqual(computeEffectiveTimeout(90, undefined), {
    timeoutMs: 90_000,
    source: "local",
  });
  assert.deepEqual(computeEffectiveTimeout(90, 5_000), {
    timeoutMs: 5_000,
    source: "remote",
  });
});

test("evaluateMutationPolicy matches readOnly and confirmWrites matrix", () => {
  assert.deepEqual(evaluateMutationPolicy(false, false), { blocked: false, needsConfirmation: false });
  assert.deepEqual(evaluateMutationPolicy(false, true), { blocked: false, needsConfirmation: true });
  assert.deepEqual(evaluateMutationPolicy(true, false), { blocked: true, needsConfirmation: false });
  assert.deepEqual(evaluateMutationPolicy(true, true), { blocked: true, needsConfirmation: false });
});

test("resolveContainedPath keeps normal child paths inside the workspace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-security-"));
  const subdir = path.join(root, "src");
  fs.mkdirSync(subdir);

  const resolved = resolveContainedPath(root, "src/example.ts");
  assert.equal(resolved.exists, false);
  assert.equal(resolved.canonicalPath, path.join(subdir, "example.ts"));

  fs.rmSync(root, { recursive: true, force: true });
});

test("resolveContainedPath rejects lexical traversal outside the workspace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-security-"));

  assert.throws(
    () => resolveContainedPath(root, "../outside.txt"),
    /Path escapes workspace/
  );

  fs.rmSync(root, { recursive: true, force: true });
});

test("resolveContainedPath rejects symlink escapes through existing ancestors", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-security-"));
  const root = path.join(base, "workspace");
  const outside = path.join(base, "outside");
  const link = path.join(root, "linked-out");
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, link, "junction");

  assert.throws(
    () => resolveContainedPath(root, "linked-out/new-file.txt"),
    /Path escapes workspace/
  );

  fs.rmSync(base, { recursive: true, force: true });
});
