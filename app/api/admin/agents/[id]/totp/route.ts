import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabase();

  // Get agent
  const { data: agent } = await supabase
    .from("agents")
    .select("id, name, totp_secret")
    .eq("id", id)
    .maybeSingle();

  if (!agent) {
    return NextResponse.json({ error: "AGENT_NOT_FOUND" }, { status: 404 });
  }

  // Generate TOTP secret
  const secret = new OTPAuth.Secret();
  const totp = new OTPAuth.TOTP({
    issuer: "BetsSolution",
    label: agent.name,
    secret,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });

  // Generate QR code
  const qrDataUrl = await QRCode.toDataURL(totp.toString());

  // Save secret to DB
  await supabase
    .from("agents")
    .update({ totp_secret: secret.base32 })
    .eq("id", id);

  return NextResponse.json({
    qrDataUrl,
    secret: secret.base32,
    message: "Scan the QR code with Google Authenticator",
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getSupabase();

  await supabase
    .from("agents")
    .update({ totp_secret: null })
    .eq("id", id);

  return NextResponse.json({ success: true });
}
