/**
 * Shared defaults for OpenCLI exec calls.
 * Centralized to avoid drift across modules.
 */

export const OPENCLI_TIMEOUT_MS = 60_000;
export const OPENCLI_MAX_BUFFER = 50 * 1024 * 1024;
export const DOCTOR_TIMEOUT_MS = 10_000;
export const REGISTRY_REFRESH_TIMEOUT_MS = 30_000;
export const REGISTRY_REFRESH_MAX_BUFFER = 50 * 1024 * 1024;
export const RESEARCH_EXEC_TIMEOUT_MS = 90_000;
export const RESEARCH_EXEC_MAX_BUFFER = 50 * 1024 * 1024;
export const CAPABILITIES_PROBE_TIMEOUT_MS = 5_000;
