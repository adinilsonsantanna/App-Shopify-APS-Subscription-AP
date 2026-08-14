import type { ActionFunctionArgs } from "react-router";
import { processAppUninstalledWebhook } from "../lib/app-uninstalled.server";

export const action = ({ request }: ActionFunctionArgs) =>
  processAppUninstalledWebhook(request);
