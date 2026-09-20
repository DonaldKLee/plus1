/** Shared types for Federato underwriting skill pack ↔ dashboard console. */

export type AppetiteTier = "target" | "acceptable" | "not_acceptable" | "missing";

export type UnderwriteDecision = "quote" | "refer" | "decline" | "investigate";

export interface FactorScore {
  factor: string;
  tier: AppetiteTier;
  value: string;
  rule: string;
  points: number;
}

export interface RankedSubmission {
  rank: number;
  submissionId: number;
  submissionNumber: string;
  policyId: number | null;
  policyNumber: string | null;
  accountName: string;
  lineOfBusiness: string;
  businessType: string | null;
  primaryState: string | null;
  premium: number | null;
  tiv: number | null;
  score: number;
  maxScore: number;
  decision: UnderwriteDecision;
  explanation: string;
  factors: FactorScore[];
  queryTrace: string[];
}

export interface MindHop {
  stage: string;
  ms: number;
  detail?: string;
}

export interface FederatoMindEvent {
  id: string;
  t: number;
  kind: "federato_rank" | "federato_deep_dive" | "federato_browse";
  hops: MindHop[];
  ranked?: RankedSubmission[];
  deepDive?: DeepDiveResult;
  browse?: BrowseSession;
}

export interface DeepDiveResult {
  policyId: number;
  policyNumber: string;
  accountName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  latitude: number | null;
  longitude: number | null;
  hazardTags: string[];
  decision: UnderwriteDecision;
  explanation: string;
  factors: FactorScore[];
  memoMarkdown: string;
  contradictionNotes: string[];
  /** External risk data for the primary location, when enrichment ran (shape: brain HazardEnrichment). */
  enrichment?: unknown;
  /** Decision the appetite rules alone would have given, when enrichment changed it. */
  decisionWithoutEnrichment?: UnderwriteDecision;
}

export interface BrowseSession {
  sessionId: string;
  liveViewUrl: string;
  debuggerUrl?: string;
  status: "starting" | "running" | "done" | "error";
  steps: { label: string; ok: boolean; detail?: string }[];
  screenshotPath?: string;
  error?: string;
}

export interface RankResponse {
  generatedAt: string;
  schemaResources: string[];
  queryTrace: string[];
  totalSubmissions: number;
  propertyPolicies: number;
  ranked: RankedSubmission[];
  hops: MindHop[];
  /** True when external risk data was folded into the scores. */
  enriched?: boolean;
  /** The raw expanded policy records, when requested (portfolio aggregation). */
  policies?: unknown[];
}

export interface DeepDiveResponse {
  deepDive: DeepDiveResult;
  browse: BrowseSession | null;
  hops: MindHop[];
}

/** One open submission after ingest → enrich → classify. */
export interface SubmissionIntake {
  rank: number;
  submissionId: number;
  submissionNumber: string;
  status: string;
  receivedDate: string | null;
  targetEffectiveDate: string | null;
  requestedLimit: number | null;
  accountName: string;
  broker: string | null;
  brokerTier: string | null;
  lineOfBusiness: string;
  businessType: "new" | "renewal";
  /** Where the exposure came from (insured's policies on file). */
  basis: { priorPolicies: number; priorSameLine: number; locations: number; claims: number; note: string };
  primaryState: string | null;
  tiv: number | null;
  score: number;
  maxScore: number;
  decision: UnderwriteDecision;
  explanation: string;
  factors: FactorScore[];
  /** What to ask the broker for before this can be classified with confidence. */
  requests: string[];
  /** External risk data for the primary location, when enrichment ran. */
  enrichment?: unknown;
  /** Stage timings for the console: INGEST / ENRICH / CLASSIFY. */
  hops: MindHop[];
}

export interface SubmissionIntakeResponse {
  generatedAt: string;
  openSubmissions: number;
  enriched: boolean;
  ranked: SubmissionIntake[];
  hops: MindHop[];
}
