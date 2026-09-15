import type { HygieneGrade } from "../domain/types";

/** Grades that need an explicit acknowledgement before a deposit continues. */
export function needsAcknowledgement(grade: HygieneGrade): boolean {
  return grade === "C" || grade === "D";
}
