/** Load the repo-root .env (and a package-local .env override) into process.env. Dev scripts only. */
export function loadEnv(importMetaUrl: string): void {
  const load = (rel: string) => {
    try { process.loadEnvFile(new URL(rel, importMetaUrl)); } catch { /* no file: fine */ }
  };
  load("../../../.env"); // repo root
  load("../.env"); // package-local override
}
