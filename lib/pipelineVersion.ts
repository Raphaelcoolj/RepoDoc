/**
 * Current documentation pipeline version.
 * Bump ONLY for material quality changes (prompts, validation, provider order).
 * A bump is treated like a migration: existing docs become pipeline-outdated and
 * are lazily regenerated on their next authenticated submission — never in bulk.
 */
export const PIPELINE_VERSION = 1;
