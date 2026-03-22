"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/hooks/use-auth";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const { signIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/sport";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setStatus("Connessione...");
    setLoading(true);

    try {
      setStatus("Autenticazione...");
      const result = await signIn(email, password);

      if (result.error) {
        setError(
          result.error.includes("Invalid")
            ? "Username o password non corretti"
            : result.error
        );
        setLoading(false);
        setStatus("");
        return;
      }

      setStatus("Accesso riuscito, reindirizzamento...");
      window.location.href = redirect;
    } catch (err: any) {
      setError(err?.message || "Errore di connessione. Riprova.");
      setLoading(false);
      setStatus("");
    }
  };

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Bentornato</h1>
      <p className="text-sm text-gray-500 mb-6">
        Accedi al tuo account VinciTu
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Username o Email"
          type="text"
          placeholder="username o nome@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="username"
        />

        <Input
          label="Password"
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
        />

        {status && !error && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 text-sm text-blue-600">
            {status}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 text-gray-600">
            <input type="checkbox" className="rounded border-gray-300" />
            Ricordami
          </label>
          <Link
            href="/forgot-password"
            className="text-brand font-medium hover:underline"
          >
            Password dimenticata?
          </Link>
        </div>

        <Button type="submit" variant="brand" fullWidth size="lg" loading={loading}>
          Accedi
        </Button>
      </form>

      <div className="mt-6 text-center text-sm text-gray-500">
        Non hai un account?{" "}
        <Link href="/register" className="text-brand font-semibold hover:underline">
          Registrati
        </Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
