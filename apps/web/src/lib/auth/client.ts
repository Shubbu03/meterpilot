import { createAuthClient } from "better-auth/react";

import { webConfig } from "../config";

export const authClient = createAuthClient({
  baseURL: webConfig.apiBaseUrl,
});
