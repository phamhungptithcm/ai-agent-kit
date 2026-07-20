import fs from "node:fs";
import path from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules", "target", "build", "dist", ".codegraph", ".cocoindex_code", "coverage", ".ai-agent-kit"]);

export function collectRepositoryFiles(root, maxFiles = 5000) {
  const files = [];
  function walk(dir) {
    if (files.length >= maxFiles) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (files.length >= maxFiles) return;
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        walk(full);
      } else {
        files.push(rel);
      }
    }
  }
  walk(root);
  return files;
}

export function detectProfile(root, requestedProfile = "auto") {
  const files = collectRepositoryFiles(root);
  const has = (predicate) => files.some(predicate);
  const tech = {
    java: has((file) => file.endsWith("pom.xml") || file.endsWith(".java")),
    springBoot: has((file) => file.includes("springboot") || file.endsWith("application.yml") || file.endsWith("application.properties")),
    lowCode: has((file) => /lowcode|low-code|model-driven/i.test(file)),
    react: has((file) => file.endsWith("package.json")) && has((file) => file.toLowerCase().includes("react")),
    angular: has((file) => file.endsWith("angular.json") || file.toLowerCase().includes("@angular")),
    flutter: has((file) => file.endsWith("pubspec.yaml") || file.endsWith(".dart")),
    sql: has((file) => /\.(sql|pls|plsql)$/i.test(file)),
    oracle: has((file) => /oracle|plsql|\.pls$/i.test(file)),
    postgres: has((file) => /postgres|postgresql|pg_/i.test(file)),
    kafka: has((file) => /kafka|avro|schema-registry/i.test(file)),
    batchScheduler: has((file) => /batch|scheduler|cron|quartz/i.test(file)),
    kubernetes: has((file) => /(^|\/)(kubernetes|k8s|helm)\//i.test(file) || /deployment\.ya?ml$/i.test(file)),
    terraform: has((file) => file.endsWith(".tf")),
    gitlabCi: has((file) => file === ".gitlab-ci.yml" || file.includes("Jenkinsfile")),
    regulatedDomain: has((file) => /payment|billing|account|transaction|ledger|invoice|compliance|pii|iam|auth/i.test(file))
  };
  const profile = requestedProfile === "auto" ? (tech.regulatedDomain ? "regulated-enterprise" : "generic") : requestedProfile;
  const protectedPaths = ["src/", "app/", "services/", "modules/", "database/", "migrations/", "terraform/", "kubernetes/", "helm/"].filter((dir) =>
    fs.existsSync(path.join(root, dir))
  );
  return { profile, technologies: tech, protectedPaths, sampledFileCount: files.length };
}
