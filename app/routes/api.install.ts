import type { ActionFunctionArgs } from "react-router";
import { ensureCentralShopInstallation } from "../lib/durable-installation.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const authenticated = await authenticate.admin(request);
  const result = await ensureCentralShopInstallation(authenticated);
  return Response.json({ success: result.synchronized }, { status: result.synchronized ? 200 : 503 });
};
