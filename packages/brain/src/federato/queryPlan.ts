/**
 * Agentic query planning: inspect schema → decide which Federato queries to run.
 * Pure — returns query payloads; the agent server executes them.
 */

export interface SchemaField {
  type: string;
  optional?: boolean;
  resource?: string;
  cardinality?: string;
  fields?: Record<string, SchemaField>;
  itemSchema?: SchemaField;
}

export interface SchemaResource {
  type: string;
  fields: Record<string, SchemaField>;
}

export type FederatoSchema = Record<string, SchemaResource>;

export interface PlannedQuery {
  id: string;
  goal: string;
  payload: Record<string, unknown>;
}

/** Map appetite factors → schema fields we need expanded. */
const APPETITE_FIELD_HINTS = [
  "line_of_business",
  "business_type",
  "premium",
  "insured",
  "claims",
  "exposure_units",
  "submission",
  "buildings",
  "year_built",
  "construction_type",
  "tiv",
  "state",
  "hazard_tags",
] as const;

function hasField(resource: SchemaResource | undefined, name: string): boolean {
  if (!resource) return false;
  if (name in resource.fields) return true;
  for (const f of Object.values(resource.fields)) {
    if (f.fields && name in f.fields) return true;
    if (f.itemSchema?.fields && name in f.itemSchema.fields) return true;
  }
  return false;
}

/**
 * Given discovered schema, plan the minimum queries to score commercial property appetite.
 */
export function planAppetiteQueries(schema: FederatoSchema): PlannedQuery[] {
  const resources = Object.keys(schema);
  const plans: PlannedQuery[] = [];

  plans.push({
    id: "discover_schema",
    goal: "Learn available resources and fields before querying",
    payload: { action: "schema" },
  });

  if (!resources.includes("Policy")) {
    plans.push({
      id: "fallback_list_resources",
      goal: `Schema missing Policy; available: ${resources.join(", ")}`,
      payload: { resource: resources[0] ?? "Policy", pagination: { limit: 5 } },
    });
    return plans;
  }

  const policy = schema.Policy;
  const expand: Record<string, unknown> = {};

  if (hasField(policy, "insured") || "insured" in (policy?.fields ?? {})) {
    expand.insured = true;
  }
  if ("claims" in (policy?.fields ?? {})) {
    expand.claims = true;
  }
  if ("submission" in (policy?.fields ?? {})) {
    expand.submission = true;
  }
  if ("exposure_units" in (policy?.fields ?? {})) {
    // Nested expand for location.buildings when schema supports references
    expand.exposure_units = { location: { buildings: true } };
  }

  const matchedHints = APPETITE_FIELD_HINTS.filter(
    (h) =>
      hasField(policy, h) ||
      hasField(schema.Building, h) ||
      hasField(schema.Location, h) ||
      hasField(schema.Claim, h),
  );

  plans.push({
    id: "property_policies_expanded",
    goal: `Score property book against appetite using fields: ${matchedHints.join(", ")}`,
    payload: {
      resource: "Policy",
      where: { line_of_business: "property" },
      expand,
      pagination: { limit: 100 },
    },
  });

  if (resources.includes("Submission")) {
    plans.push({
      id: "submissions_page",
      goal: "Join submission queue metadata (status, broker, received_date)",
      payload: {
        resource: "Submission",
        expand: { insured: true, broker: true },
        pagination: { limit: 200 },
      },
    });
  }

  return plans;
}

export function explainQueryPlan(plans: PlannedQuery[]): string[] {
  return plans.map((p) => `[${p.id}] ${p.goal}`);
}
