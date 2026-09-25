import type { Address, FundingWallet, HygieneGrade } from "../domain/types";
import { HYGIENE_GRADE_THRESHOLDS } from "../protocol/parameters";

/** Grades that need an explicit acknowledgement before a deposit continues. */
export function needsAcknowledgement(grade: HygieneGrade): boolean {
  return grade === "C" || grade === "D";
}

/** What the chain shows about how a wallet was funded. */
export interface FundingEvidence {
  /** Distinct addresses that sent it value: tokens always, and ether too when `seesEther`. */
  readonly senders: number;
  /** When value first reached it, as far as the evidence shows, or null when none ever did. */
  readonly firstFundedAt: Date | null;
  /** Whether ether sent to it was seen. Event logs record token transfers only; a transfer index records both. */
  readonly seesEther: boolean;
}

const MS_PER_DAY = 86_400_000;

/**
 * A: many sources and old. B: more than one source and not new. C: one of the two. D: a single source, and new or of
 * unknown age, which is the funding pattern that deanonymised most Umbra users.
 */
export function gradeOf(inboundEdges: number, ageDays: number | null): HygieneGrade {
  const age = ageDays ?? 0;
  const { a, b } = HYGIENE_GRADE_THRESHOLDS;
  if (inboundEdges >= a.minInboundEdges && age >= a.minAgeDays) return "A";
  if (inboundEdges >= b.minInboundEdges && age >= b.minAgeDays) return "B";
  if (inboundEdges >= b.minInboundEdges || age >= b.minAgeDays) return "C";
  return "D";
}

/** The funding wallet as the deposit screen shows it: its evidence, graded. */
export function gradeFundingWallet(address: Address, label: string, evidence: FundingEvidence, now: Date): FundingWallet {
  const ageDays =
    evidence.firstFundedAt === null
      ? null
      : Math.max(0, Math.floor((now.getTime() - evidence.firstFundedAt.getTime()) / MS_PER_DAY));
  return {
    address,
    label,
    inboundEdges: evidence.senders,
    ageDays,
    singleSourceFunding: evidence.senders <= 1,
    grade: gradeOf(evidence.senders, ageDays),
  };
}
