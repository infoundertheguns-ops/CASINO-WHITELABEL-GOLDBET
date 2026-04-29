#!/usr/bin/env tsx
/**
 * CLI entrypoint: runs the normalization engine against Supabase.
 * Usage:  npm run normalize:markets -- --chunk 500
 */
import { createClient } from "@supabase/supabase-js";
import { runEngine } from "../lib/normalize/engine";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const chunkArg = process.argv.indexOf("--chunk");
  const chunkSize = chunkArg >= 0 ? parseInt(process.argv[chunkArg + 1], 10) : 500;

  const client = createClient(url, key, { auth: { persistSession: false } });

  console.log(`[normalize-markets] starting with chunkSize=${chunkSize}`);
  const summary = await runEngine({ client, chunkSize });
  console.log("[normalize-markets] done:", JSON.stringify(summary, null, 2));

  if (summary.remaining > 0) {
    console.log(`[normalize-markets] ${summary.remaining} rows still unmapped. Re-run to continue.`);
  }
}

main().catch((e) => {
  console.error("[normalize-markets] FATAL", e);
  process.exit(1);
});
