export interface DatabaseTargetIdentity { host: string; database: string }

export function databaseTargetIdentity(connectionString: string): DatabaseTargetIdentity {
  let parsed: URL;
  try { parsed = new URL(connectionString); } catch { throw new Error("DATABASE_URL is invalid"); }
  if (!parsed.hostname || !parsed.pathname.slice(1)) throw new Error("DATABASE_URL target is incomplete");
  return { host: parsed.hostname.toLowerCase(), database: decodeURIComponent(parsed.pathname.slice(1).split("/")[0]!) };
}

export function assertExpectedDatabaseTarget(connectionString: string, expectedHost?: string, expectedDatabase?: string) {
  const identity = databaseTargetIdentity(connectionString);
  if (expectedHost && identity.host !== expectedHost.trim().toLowerCase()) throw new Error("DATABASE_URL host does not match EXPECTED_DATABASE_HOST");
  if (expectedDatabase && identity.database !== expectedDatabase.trim()) throw new Error("DATABASE_URL database does not match EXPECTED_DATABASE_NAME");
  return identity;
}
