const SELECTED_ORGANIZATION_KEY = "meterpilot:selected-organization";

export function readSelectedOrganization() {
  try {
    return globalThis.localStorage?.getItem(SELECTED_ORGANIZATION_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeSelectedOrganization(organizationId: string) {
  try {
    globalThis.localStorage?.setItem(SELECTED_ORGANIZATION_KEY, organizationId);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

export function clearSelectedOrganization() {
  try {
    globalThis.localStorage?.removeItem(SELECTED_ORGANIZATION_KEY);
  } catch {
    // Session cleanup must remain safe when browser storage is unavailable.
  }
}
