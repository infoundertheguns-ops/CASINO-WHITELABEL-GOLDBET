export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

// E1.F2b — Capability check for event-normalization UI.
// Returns whether server-side LLM stage is available (ANTHROPIC_API_KEY set).
export async function GET() {
  return NextResponse.json({
    llm_available: !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.length > 0),
  });
}
