/** The 2025 sample appetite table and the challenge glossary, as data the agent can quote. Pure. */

export interface GuidelineRow {
  factor: string;
  acceptable: string;
  target: string;
  notAcceptable: string;
}

export const APPETITE_GUIDELINES: GuidelineRow[] = [
  { factor: "Submission type", acceptable: "New business", target: "—", notAcceptable: "Renewal business" },
  { factor: "Line of business", acceptable: "Property", target: "—", notAcceptable: "All other lines" },
  { factor: "Primary risk state", acceptable: "OH, PA, MD, CO, CA, FL, NC, SC, GA, VA, UT", target: "OH, PA, MD, CO, CA, FL", notAcceptable: "All other states" },
  { factor: "TIV (total insured value)", acceptable: "Up to $150M", target: "$50M–$100M", notAcceptable: "Over $150M" },
  { factor: "Total premium", acceptable: "$50K–$175K", target: "$75K–$100K", notAcceptable: "Under $50K or over $175K" },
  { factor: "Building age", acceptable: "Newer than 1990", target: "Newer than 2010", notAcceptable: "Older than 1990" },
  { factor: "Construction type", acceptable: ">50% joisted masonry, non-combustible/steel, or masonry non-combustible", target: "—", notAcceptable: ">50% other types (e.g. frame)" },
  { factor: "Loss value", acceptable: "Under $100,000", target: "—", notAcceptable: "Over $100,000" },
];

export const REQUIRED_DATA_POINTS = [
  "account name",
  "primary risk state",
  "line of business",
  "effective/expiration dates",
  "TIV",
  "construction type",
  "building year",
  "premium",
  "five-year loss history",
];

export const GLOSSARY: Record<string, string> = {
  insurance: "A financial product that protects against specific risks; the customer pays a premium and the insurer covers certain losses.",
  underwriting: "How insurers evaluate the risk of insuring someone or something, decide whether to accept it, and how much to charge.",
  carrier: "An insurance company.",
  policy: "The contract between the insured and the carrier: what is covered, for how much, under what conditions.",
  premium: "What the customer pays for coverage.",
  submission: "A request for insurance sent by a broker or agent, with details of what is being insured.",
  riskops: "Risk Operations: Federato's tools and workflows that help underwriters decide faster with data and AI.",
  appetite: "The kinds of risks a carrier wants to write, e.g. commercial auto in Texas but not homes in wildfire zones.",
  "in-appetite": "A submission that matches what the carrier wants; high priority.",
  "out-of-appetite": "A submission that does not fit the carrier's guidelines.",
  tiv: "Total Insured Value: the total value of insured property (buildings, contents, business interruption).",
  broker: "The intermediary who brings a submission to the carrier on behalf of the insured.",
  "loss history": "Past claims on the account; here the sum of paid and reserved indemnity and expense.",
  refer: "Send the file to a senior underwriter rather than deciding alone.",
  decline: "Turn the submission down.",
  quote: "Offer terms and a price.",
};

/** Render the guideline table (optionally one factor) as plain text an agent can read aloud or paste. */
export function explainGuidelines(topic?: string): string {
  const q = topic?.trim().toLowerCase();
  if (q) {
    const term = Object.entries(GLOSSARY).find(([k]) => q.includes(k) || k.includes(q));
    const row = APPETITE_GUIDELINES.find((r) => r.factor.toLowerCase().includes(q) || q.includes(r.factor.toLowerCase().split(" ")[0]!));
    const bits: string[] = [];
    if (row) bits.push(`${row.factor}: acceptable ${row.acceptable}; target ${row.target}; not acceptable ${row.notAcceptable}.`);
    if (term) bits.push(`${term[0]}: ${term[1]}`);
    if (bits.length) return bits.join(" ");
  }
  const rows = APPETITE_GUIDELINES.map((r) => `- ${r.factor}: acceptable ${r.acceptable}; target ${r.target}; not acceptable ${r.notAcceptable}`);
  return `2025 commercial property appetite (target beats acceptable; any not-acceptable factor is a red flag):\n${rows.join("\n")}\nRequired data: ${REQUIRED_DATA_POINTS.join(", ")}.`;
}
