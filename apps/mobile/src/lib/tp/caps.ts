/**
 * Is the tour plan item API live? Detected at runtime (no import cycles: model.ts reads it too).
 * null = not known yet; false = the route is missing (404), so the app uses the device-local mock.
 */
export const tpCaps: { live: boolean | null } = { live: null };
