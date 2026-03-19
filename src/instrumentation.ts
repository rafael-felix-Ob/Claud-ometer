/**
 * Next.js instrumentation hook — runs once on server startup.
 * Starts the ingest scheduler only in the Node.js runtime (not Edge).
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startIngestScheduler } = await import('./lib/ingest');
    startIngestScheduler();
  }
}
