import { normalizeTeamSurface, safeTeamId, teamControlDigest, teamSurfacesOverlap } from "./team-control-contract.mjs";

const PROTECTED_KINDS = new Set(["API", "SCHEMA", "MIGRATION", "DEPENDENCY", "GENERATED"]);

export function analyzeTeamConflicts(options = {}) {
  const packages = (options.packages ?? []).map((item) => ({
    package_id: safeTeamId(item.package_id, "change package id"),
    task_id: safeTeamId(item.task_id, "task id"),
    surfaces: (item.surfaces ?? []).map(normalizeTeamSurface)
  }));
  if (!packages.length || packages.length > 500) throw new Error("conflict analysis requires 1-500 change packages");
  const conflicts = [];
  for (let leftIndex = 0; leftIndex < packages.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < packages.length; rightIndex += 1) {
      const left = packages[leftIndex]; const right = packages[rightIndex];
      for (const leftSurface of left.surfaces) for (const rightSurface of right.surfaces) {
        if (!teamSurfacesOverlap(leftSurface, rightSurface)) continue;
        const protectedSurface = PROTECTED_KINDS.has(leftSurface.kind);
        conflicts.push({
          conflict_id: `conflict-${teamControlDigest({ left: left.package_id, right: right.package_id, kind: leftSurface.kind, name: leftSurface.name }).slice(0, 24)}`,
          left_package_id: left.package_id, right_package_id: right.package_id,
          kind: leftSurface.kind, name: leftSurface.name,
          severity: protectedSurface ? "HIGH" : "MEDIUM",
          status: "OPEN", reason: protectedSurface ? "protected contract surface overlaps" : "write-capable surface overlaps"
        });
      }
    }
  }
  const unknowns = packages.flatMap((item) => item.surfaces.filter((surface) => PROTECTED_KINDS.has(surface.kind) && surface.kind === "GENERATED" && !surface.source).map((surface) => ({ package_id: item.package_id, kind: surface.kind, name: surface.name, reason: "generated surface has no canonical source binding" })));
  return { schema_version: 1, status: conflicts.length || unknowns.length ? "BLOCKED" : "CLEAR", analyzed_packages: packages.length, conflicts, unknowns, analysis_hash: teamControlDigest({ packages, conflicts, unknowns }) };
}
