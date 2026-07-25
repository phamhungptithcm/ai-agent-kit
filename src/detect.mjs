import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "target",
  "build",
  "dist",
  ".codegraph",
  ".cocoindex_code",
  "coverage",
  ".ai-agent-kit"
]);
const MAX_MANIFEST_BYTES = 1_000_000;
const MAX_PACKAGE_MANIFESTS = 50;

function sortEntries(entries) {
  return [...entries].sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? 1 : -1;
    return left.name.localeCompare(right.name);
  });
}

export function collectRepositoryFiles(root, maxFiles = 5000) {
  const files = [];
  function walk(dir) {
    if (files.length >= maxFiles) return;
    const entries = sortEntries(fs.readdirSync(dir, { withFileTypes: true }));
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replaceAll("\\", "/");
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(rel);
    }
  }
  walk(root);
  return files;
}

function readManifest(root, relPath) {
  const filePath = path.join(root, relPath);
  try {
    if (fs.statSync(filePath).size > MAX_MANIFEST_BYTES) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function packageManifests(root, files) {
  return files
    .filter((file) => path.posix.basename(file) === "package.json")
    .sort((left, right) => {
      const depth = left.split("/").length - right.split("/").length;
      return depth || left.localeCompare(right);
    })
    .slice(0, MAX_PACKAGE_MANIFESTS)
    .flatMap((relPath) => {
      const text = readManifest(root, relPath);
      if (text == null) return [];
      try {
        return [{ path: relPath, data: JSON.parse(text) }];
      } catch {
        return [];
      }
    });
}

function dependencyCatalog(manifests) {
  const dependencies = new Map();
  for (const manifest of manifests) {
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [name, version] of Object.entries(manifest.data[field] ?? {})) {
        if (!dependencies.has(name.toLowerCase())) dependencies.set(name.toLowerCase(), String(version));
      }
    }
  }
  return dependencies;
}

function dependencyMatches(dependencies, expression) {
  return [...dependencies.keys()].some((name) => expression.test(name));
}

function manifestContains(root, files, basenames, expression) {
  return files
    .filter((file) => basenames.has(path.posix.basename(file).toLowerCase()))
    .some((file) => expression.test(readManifest(root, file) ?? ""));
}

function firstManifest(root, files, basename) {
  const relPath = files.find((file) => path.posix.basename(file).toLowerCase() === basename);
  return relPath ? { path: relPath, text: readManifest(root, relPath) ?? "" } : null;
}

function dependencyVersion(dependencies, name) {
  return dependencies.get(name.toLowerCase()) ?? null;
}

export function detectProfile(root, requestedProfile = "auto") {
  const files = collectRepositoryFiles(root);
  const lowerFiles = files.map((file) => file.toLowerCase());
  const has = (predicate) => files.some(predicate);
  const hasLower = (expression) => lowerFiles.some((file) => expression.test(file));
  const packages = packageManifests(root, files);
  const dependencies = dependencyCatalog(packages);
  const pomHasSpringBoot = manifestContains(root, files, new Set(["pom.xml"]), /spring-boot|org\.springframework\.boot/i);
  const pythonManifest = manifestContains(
    root,
    files,
    new Set(["pyproject.toml", "requirements.txt", "requirements-dev.txt", "pipfile"]),
    /(?:^|[\s"'=<>~])(?:fastapi|django|flask)(?:[\s"'=<>~]|$)/im
  );
  const goManifest = firstManifest(root, files, "go.mod");
  const pubspec = firstManifest(root, files, "pubspec.yaml");

  const tech = {
    node: packages.length > 0,
    typescript: dependencies.has("typescript") || has((file) => file.endsWith("tsconfig.json") || /\.(?:ts|tsx|mts|cts)$/i.test(file)),
    java: has((file) => path.posix.basename(file) === "pom.xml" || file.endsWith(".java")),
    springBoot: pomHasSpringBoot || hasLower(/(?:^|\/)application\.(?:yml|yaml|properties)$/),
    python: has((file) => /(?:^|\/)(?:pyproject\.toml|requirements[^/]*\.txt|pipfile)$/i.test(file) || file.endsWith(".py")),
    fastapi: dependencyMatches(dependencies, /^fastapi$/) || (pythonManifest && manifestContains(root, files, new Set(["pyproject.toml", "requirements.txt", "requirements-dev.txt", "pipfile"]), /fastapi/i)),
    django: dependencyMatches(dependencies, /^django$/) || hasLower(/(?:^|\/)manage\.py$/),
    flask: dependencyMatches(dependencies, /^flask$/) || (pythonManifest && manifestContains(root, files, new Set(["pyproject.toml", "requirements.txt", "requirements-dev.txt", "pipfile"]), /flask/i)),
    go: Boolean(goManifest),
    lowCode: hasLower(/lowcode|low-code|model-driven/),
    react: dependencies.has("react") || hasLower(/(?:^|\/)react(?:\/|[-_.])/),
    angular: dependencies.has("@angular/core") || has((file) => file.endsWith("angular.json")),
    flutter: /sdk:\s*flutter|flutter:\s*$/im.test(pubspec?.text ?? "") || has((file) => file.endsWith(".dart")),
    sql: has((file) => /\.(sql|pls|plsql)$/i.test(file)),
    oracle: dependencies.has("oracledb") || hasLower(/oracle|plsql|\.pls$/),
    postgres: dependencies.has("pg") || dependencyMatches(dependencies, /postgres|postgresql/) || hasLower(/postgres|postgresql|pg_/),
    kafka: dependencyMatches(dependencies, /kafka/) || hasLower(/kafka|avro|schema-registry/),
    batchScheduler: dependencyMatches(dependencies, /quartz|cron/) || hasLower(/batch|scheduler|cron|quartz/),
    kubernetes: has((file) => /(^|\/)(kubernetes|k8s|helm)\//i.test(file) || /deployment\.ya?ml$/i.test(file)),
    terraform: has((file) => file.endsWith(".tf")),
    gitlabCi: has((file) => file === ".gitlab-ci.yml" || path.posix.basename(file) === "Jenkinsfile"),
    regulatedDomain: dependencyMatches(dependencies, /auth|payment|billing|ledger/) ||
      hasLower(/payment|billing|account|transaction|ledger|invoice|compliance|pii|iam|auth/)
  };

  const versions = Object.fromEntries(Object.entries({
    node: packages.find((manifest) => manifest.data.engines?.node)?.data.engines?.node ?? null,
    typescript: dependencyVersion(dependencies, "typescript"),
    react: dependencyVersion(dependencies, "react"),
    angular: dependencyVersion(dependencies, "@angular/core"),
    springBoot: pomHasSpringBoot ? "manifest-detected" : null,
    go: goManifest?.text.match(/^go\s+([^\s]+)$/m)?.[1] ?? null,
    flutter: pubspec?.text.match(/^\s*sdk:\s*["']?([^"'\s]+)["']?\s*$/m)?.[1] ?? null
  }).filter(([, version]) => version));

  const profile = requestedProfile === "auto" ? (tech.regulatedDomain ? "regulated-enterprise" : "generic") : requestedProfile;
  const protectedPaths = ["src/", "app/", "services/", "modules/", "database/", "migrations/", "terraform/", "kubernetes/", "helm/"].filter((dir) =>
    fs.existsSync(path.join(root, dir))
  );
  const manifests = [
    ...packages.map((manifest) => manifest.path),
    ...["pom.xml", "pyproject.toml", "requirements.txt", "go.mod", "pubspec.yaml"]
      .flatMap((basename) => files.filter((file) => path.posix.basename(file).toLowerCase() === basename))
  ].filter((value, index, values) => values.indexOf(value) === index);

  return {
    profile,
    technologies: tech,
    versions,
    manifests,
    protectedPaths,
    sampledFileCount: files.length
  };
}
