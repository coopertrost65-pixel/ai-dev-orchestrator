import { packager } from "@electron/packager";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const root = process.cwd();
const stage = path.join(root, "work", "desktop-stage");
const serverSource = path.join(root, "dist", "standalone");
const outputDirectory = path.join(root, "outputs");
const assetDirectory = path.join(root, "desktop", "assets");
const icon = path.join(assetDirectory, "AI-Dev-Orchestrator.icns");
const architecture = process.arch === "x64" ? "x64" : "arm64";
const packagedOutputName = `AI Dev Orchestrator-darwin-${architecture}`;
const zipPath = path.join(outputDirectory, `AI-Dev-Orchestrator-macOS-${architecture}.zip`);
const assetZipPath = path.join(outputDirectory, "AI-Dev-Orchestrator-Icon-Assets.zip");
const sourcePackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

await rm(stage, { recursive: true, force: true });
await rm(path.join(outputDirectory, packagedOutputName), { recursive: true, force: true });
await rm(zipPath, { force: true });
await rm(assetZipPath, { force: true });
await mkdir(path.join(stage, "desktop"), { recursive: true });
await mkdir(outputDirectory, { recursive: true });
await execFileAsync(process.execPath, [path.join(root, "scripts", "generate-icon-assets.mjs")], { cwd: root });

await cp(path.join(root, "desktop", "main.cjs"), path.join(stage, "desktop", "main.cjs"));
await cp(path.join(root, "desktop", "preload.cjs"), path.join(stage, "desktop", "preload.cjs"));
await cp(path.join(assetDirectory, "dock-animation"), path.join(stage, "desktop", "assets", "dock-animation"), { recursive: true });
await cp(serverSource, path.join(stage, "server"), { recursive: true });

// vinext's standalone emitter copies declared runtime dependencies, but its
// React runtime is a peer dependency. Include that peer tree explicitly so
// the packaged server does not depend on this source checkout's node_modules.
const copiedRuntimePackages = new Set();
async function copyRuntimePackage(packageName) {
  if (copiedRuntimePackages.has(packageName)) return;
  copiedRuntimePackages.add(packageName);

  const packageDirectory = path.join(root, "node_modules", ...packageName.split("/"));
  const packageJson = JSON.parse(await readFile(path.join(packageDirectory, "package.json"), "utf8"));
  const targetDirectory = path.join(stage, "server", "node_modules", ...packageName.split("/"));
  await mkdir(path.dirname(targetDirectory), { recursive: true });
  await cp(packageDirectory, targetDirectory, { recursive: true, force: true });

  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.optionalDependencies,
  };
  for (const dependencyName of Object.keys(dependencies)) await copyRuntimePackage(dependencyName);
}

for (const packageName of ["react", "react-dom", "react-server-dom-webpack"]) {
  await copyRuntimePackage(packageName);
}

await writeFile(
  path.join(stage, "package.json"),
  `${JSON.stringify({
    name: sourcePackage.name,
    productName: sourcePackage.productName,
    version: sourcePackage.version,
    private: true,
    main: "desktop/main.cjs",
  }, null, 2)}\n`,
);

const temporaryOutput = await mkdtemp(path.join(tmpdir(), "ai-dev-orchestrator-package-"));
try {
  const appPaths = await packager({
    dir: stage,
    name: sourcePackage.productName,
    appBundleId: "app.aidevorchestrator.desktop",
    appCategoryType: "public.app-category.developer-tools",
    appVersion: sourcePackage.version,
    buildVersion: new Date().toISOString().replace(/\D/g, "").slice(0, 12),
    platform: "darwin",
    arch: architecture,
    electronVersion: sourcePackage.devDependencies.electron.replace(/^[^\d]*/, ""),
    icon,
    out: temporaryOutput,
    overwrite: true,
    prune: false,
    asar: false,
  });

  const appBundle = path.join(appPaths[0], `${sourcePackage.productName}.app`);
  await execFileAsync("/usr/bin/xattr", ["-cr", appBundle]);
  await execFileAsync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none", appBundle]);
  await execFileAsync("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appBundle]);
  await execFileAsync("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appBundle, zipPath]);
  await execFileAsync("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", assetDirectory, assetZipPath]);
  console.log(`Signed desktop app archive created at ${zipPath}`);
  console.log(`Reusable icon assets created at ${assetZipPath}`);
} finally {
  await rm(temporaryOutput, { recursive: true, force: true });
}
