/** The rule a refused request broke. */
export type DecoyErrorCode =
  | "unknownFundingWallet"
  | "gradeNotAcknowledged"
  | "unknownAsset"
  | "noLadderTerms"
  | "tooManyLadderTerms"
  | "invalidLadderTerm"
  | "notHeld"
  | "invalidAmount"
  | "insufficientBalance"
  | "invalidAddress"
  | "noBurners"
  | "duplicateBurner"
  | "unknownBurner"
  | "burnerAlreadyFolded"
  | "emptyHolder"
  | "unknownViewKey"
  | "viewKeyAlreadyRevoked"
  | "invalidRpcUrl"
  | "invalidAutoLock";

/** A request the client refused before it reached the backend. The message names the value that broke the rule. */
export class DecoyError extends Error {
  readonly code: DecoyErrorCode;

  constructor(code: DecoyErrorCode, message: string) {
    super(message);
    this.name = "DecoyError";
    this.code = code;
  }
}
