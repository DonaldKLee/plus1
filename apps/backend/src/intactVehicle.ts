/**
 * Real vehicle data via NHTSA vPIC (free, no API key). The one external data
 * call in the Intact toolset — decodes a VIN to make / model / year / body so
 * the quote is grounded in an actual vehicle rather than what someone typed.
 */

export interface DecodedVehicle {
  vin: string;
  year?: number;
  make?: string;
  model?: string;
  bodyClass?: string;
  vehicleType?: string;
}

const cache = new Map<string, DecodedVehicle>();

const clean = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s !== "Not Applicable" && s !== "0" ? s : undefined;
};

/** Decode a 17-char VIN. Returns null on a bad VIN or if vPIC is unreachable. */
export async function vehicleLookup(vin: string): Promise<DecodedVehicle | null> {
  const id = vin.trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{11,17}$/.test(id)) return null;
  if (cache.has(id)) return cache.get(id)!;

  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(id)}?format=json`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const json = (await res.json()) as { Results?: Record<string, string>[] };
    const r = json.Results?.[0];
    if (!r) return null;
    const yearStr = clean(r.ModelYear);
    const decoded: DecodedVehicle = {
      vin: id,
      year: yearStr ? Number(yearStr) : undefined,
      make: clean(r.Make),
      model: clean(r.Model),
      bodyClass: clean(r.BodyClass),
      vehicleType: clean(r.VehicleType),
    };
    if (!decoded.make && !decoded.model && !decoded.year) return null; // nothing useful
    cache.set(id, decoded);
    return decoded;
  } catch {
    return null;
  }
}

/** A one-line, spoken-friendly summary of a decoded vehicle. */
export function describeVehicle(v: DecodedVehicle): string {
  const parts = [v.year, v.make, v.model].filter(Boolean).join(" ");
  const body = v.bodyClass ? ` (${v.bodyClass})` : "";
  return parts ? `${parts}${body}` : "that vehicle";
}
