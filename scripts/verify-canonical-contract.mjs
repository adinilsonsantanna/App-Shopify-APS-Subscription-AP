import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const canonical = resolve(here, "../../../aps-subscription-api/aps-subscription-api/src/contracts/subscription-cycle.v1.ts");
const generated = resolve(here, "../app/contracts/subscription-cycle.v1.generated.ts");
if (!existsSync(generated)) throw new Error("generated contract missing");
const normalized = value => value.replace(/^\/\/ Generated mirror[^\n]*\n/, "").replace(/\s+/g, "");
if (existsSync(canonical) && normalized(readFileSync(canonical, "utf8")) !== normalized(readFileSync(generated, "utf8"))) throw new Error("generated contract drift: regenerate from API canonical v1");
console.log(JSON.stringify({ contract: "aps.subscription-cycle.v1", generatedSha256: createHash("sha256").update(readFileSync(generated)).digest("hex"), canonicalCompared: existsSync(canonical) }));
