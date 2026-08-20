import { access, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const architecture = process.arch === "x64" ? "x64" : "arm64";
const archive = path.join(root, "outputs", `AI-Dev-Orchestrator-macOS-${architecture}.zip`);
const target = "/Applications/AI Dev Orchestrator.app";
const bundleId = "app.aidevorchestrator.desktop";

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function isRunning() {
  try {
    await execFileAsync("/usr/bin/pgrep", ["-f", `${target}/Contents/MacOS/AI Dev Orchestrator`]);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await isRunning())) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("AI Dev Orchestrator did not close in time. Close it and run the update again.");
}

if (!(await exists(archive))) throw new Error(`Package first: ${archive} does not exist.`);

const staging = await mkdtemp(path.join(tmpdir(), "ai-dev-orchestrator-update-"));
try {
  await execFileAsync("/usr/bin/ditto", ["-x", "-k", archive, staging]);
  const source = path.join(staging, "AI Dev Orchestrator.app");
  await execFileAsync("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", source]);

  const wasRunning = await isRunning();
  if (wasRunning) {
    await execFileAsync("/usr/bin/osascript", ["-e", 'tell application "AI Dev Orchestrator" to quit']);
    await waitForExit();
  }

  if (await exists(target)) {
    const { stdout } = await execFileAsync("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", path.join(target, "Contents", "Info.plist")]);
    if (stdout.trim() !== bundleId) throw new Error(`Refusing to update an app with bundle id ${stdout.trim()}.`);
    // Synchronize the contents while retaining the outer .app directory. The
    // stable path and directory identity keep the existing Dock item valid.
    await execFileAsync("/usr/bin/rsync", ["-a", "--delete", `${source}/`, `${target}/`]);
  } else {
    await execFileAsync("/usr/bin/ditto", [source, target]);
  }

  await execFileAsync("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", target]);
  await execFileAsync("/usr/bin/touch", [target]);
  if (wasRunning || process.argv.includes("--open")) await execFileAsync("/usr/bin/open", [target]);
  console.log(`Updated in place: ${target}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
