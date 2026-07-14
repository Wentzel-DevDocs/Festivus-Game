import type { AcademyMission } from "./types";

export interface AcademyCheckResult {
  id: string;
  label: string;
  passed: boolean;
  failureMessage: string;
}

/**
 * Deterministic validation shared by the browser and the cohort server. The
 * source string is inspected and immediately discarded; it is never executed.
 */
export function runAcademyMissionChecks(
  mission: AcademyMission,
  code: string,
): AcademyCheckResult[] {
  return mission.checks.map((check) => {
    let passed = false;
    try {
      passed = new RegExp(check.pattern, check.flags).test(code);
    } catch {
      passed = false;
    }
    return { ...check, passed };
  });
}
