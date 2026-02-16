"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/api/auth/callback?next=/account/reset-password`,
    });

    if (error) {
      setError("Errore nell'invio. Riprova.");
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  };

  if (sent) {
    return (
      <div className="text-center py-4">
        <span className="text-4xl block mb-4">📧</span>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Email inviata</h1>
        <p className="text-sm text-gray-500 mb-6">
          Controlla la tua casella email <strong>{email}</strong> per il link di reset password.
        </p>
        <Link href="/login" className="text-brand font-semibold text-sm hover:underline">
          ← Torna al Login
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Reset Password</h1>
      <p className="text-sm text-gray-500 mb-6">
        Inserisci la tua email e ti invieremo un link per reimpostare la password.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Email"
          type="email"
          placeholder="nome@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-600">
            {error}
          </div>
        )}

        <Button type="submit" variant="brand" fullWidth size="lg" loading={loading}>
          Invia Link Reset
        </Button>
      </form>

      <div className="mt-6 text-center">
        <Link href="/login" className="text-sm text-gray-500 hover:text-brand">
          ← Torna al Login
        </Link>
      </div>
    </div>
  );
}
