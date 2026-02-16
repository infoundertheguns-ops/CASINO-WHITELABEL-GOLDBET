"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/hooks/use-auth";

export default function RegisterPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);

  const { signUp } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Le password non coincidono");
      return;
    }
    if (password.length < 8) {
      setError("La password deve avere almeno 8 caratteri");
      return;
    }
    if (username.length < 3) {
      setError("Il nome utente deve avere almeno 3 caratteri");
      return;
    }
    if (!agreeTerms) {
      setError("Devi accettare i Termini e Condizioni");
      return;
    }

    setLoading(true);
    const result = await signUp(email, password, username);

    if (result.error) {
      setError(
        result.error.includes("already registered")
          ? "Questa email è già registrata"
          : result.error
      );
      setLoading(false);
      return;
    }

    router.push("/sport");
  };

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Crea Account</h1>
      <p className="text-sm text-gray-500 mb-6">
        Unisciti a VinciTu — Scommesse, Casino & Crypto
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nome utente"
          type="text"
          placeholder="il_tuo_nome"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
          required
          hint="Minimo 3 caratteri, solo lettere, numeri e underscore"
        />

        <Input
          label="Email"
          type="email"
          placeholder="nome@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />

        <Input
          label="Password"
          type="password"
          placeholder="Minimo 8 caratteri"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="new-password"
        />

        <Input
          label="Conferma Password"
          type="password"
          placeholder="Ripeti la password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          error={confirmPassword && password !== confirmPassword ? "Le password non coincidono" : undefined}
        />

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-600">
            {error}
          </div>
        )}

        <label className="flex items-start gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={agreeTerms}
            onChange={(e) => setAgreeTerms(e.target.checked)}
            className="rounded border-gray-300 mt-0.5"
          />
          <span>
            Confermo di avere 18+ anni e accetto i{" "}
            <Link href="#" className="text-brand hover:underline">
              Termini e Condizioni
            </Link>{" "}
            e la{" "}
            <Link href="#" className="text-brand hover:underline">
              Privacy Policy
            </Link>
          </span>
        </label>

        <Button type="submit" variant="brand" fullWidth size="lg" loading={loading}>
          Registrati
        </Button>
      </form>

      <div className="mt-6 text-center text-sm text-gray-500">
        Hai già un account?{" "}
        <Link href="/login" className="text-brand font-semibold hover:underline">
          Accedi
        </Link>
      </div>
    </div>
  );
}
