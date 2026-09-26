// Distinguishes "the tab doesn't exist yet" from any other sync-log read
// failure, so #210's Withings row can say "Not set up yet" instead of
// "Couldn't read the sync log". Its own module: sync-log-api.ts and
// demo-data.ts both need to throw it, and either importing it from the other
// would make them circular.

export class SyncLogNotSetUpError extends Error {}
