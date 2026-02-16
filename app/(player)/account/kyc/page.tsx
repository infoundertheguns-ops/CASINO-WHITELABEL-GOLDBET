"use client";

import { useState } from "react";
import { useAuth } from "@/lib/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

type DocType = "id_front" | "id_back" | "proof_address" | "selfie";

interface KYCDoc {
  type: DocType;
  label: string;
  desc: string;
  icon: string;
  file?: File;
  uploaded: boolean;
}

export default function KYCPage() {
  const { user } = useAuth();
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState(1);
  const [docs, setDocs] = useState<KYCDoc[]>([
    { type: "id_front", label: "Documento ID (Fronte)", desc: "Carta d'identità, passaporto o patente", icon: "🪪", uploaded: false },
    { type: "id_back", label: "Documento ID (Retro)", desc: "Retro del documento di identità", icon: "🔄", uploaded: false },
    { type: "proof_address", label: "Prova di Residenza", desc: "Bolletta utenze o estratto conto (max 3 mesi)", icon: "🏠", uploaded: false },
    { type: "selfie", label: "Selfie con Documento", desc: "Foto con documento visibile accanto al viso", icon: "🤳", uploaded: false },
  ]);
  const [personalInfo, setPersonalInfo] = useState({
    first_name: "",
    last_name: "",
    date_of_birth: "",
    address: "",
    city: "",
    postal_code: "",
    country: "IT",
    phone: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleFileSelect = (type: DocType, file: File) => {
    setDocs(docs.map(d => d.type === type ? { ...d, file, uploaded: true } : d));
  };

  const handleSubmitKYC = async () => {
    if (!user) return;
    setSubmitting(true);

    // Upload docs to Supabase Storage (simulated — in production use supabase.storage)
    const docNames = docs.filter(d => d.file).map(d => d.type);

    // Update user KYC status
    await supabase.from("users").update({
      kyc_status: "submitted",
      kyc_submitted_at: new Date().toISOString(),
      kyc_documents: docNames,
      country: personalInfo.country,
    }).eq("id", user.id);

    setSubmitting(false);
    setSubmitted(true);
  };

  if (!user) return <div className="p-8 text-center text-gray-400">Caricamento...</div>;

  if (user.kyc_status === "verified") {
    return (
      <div className="p-4 lg:p-0">
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <span className="text-5xl block mb-3">✅</span>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Account Verificato</h2>
          <p className="text-sm text-gray-400 mb-4">Il tuo account è stato verificato con successo.</p>
          <button onClick={() => router.push("/account")} className="px-6 py-2 rounded-xl bg-brand text-white text-sm font-bold">
            Torna al Profilo
          </button>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="p-4 lg:p-0">
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <span className="text-5xl block mb-3">📨</span>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Documenti Inviati</h2>
          <p className="text-sm text-gray-400 mb-1">La verifica richiede solitamente 24-48 ore.</p>
          <p className="text-sm text-gray-400 mb-4">Riceverai una notifica quando sarà completata.</p>
          <button onClick={() => router.push("/account")} className="px-6 py-2 rounded-xl bg-brand text-white text-sm font-bold">
            Torna al Profilo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-0 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Verifica Identità (KYC)</h1>
        <p className="text-xs text-gray-400 mt-1">Necessaria per prelievi superiori a $100 e conformità regolamentare</p>
      </div>

      {/* Steps */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3].map(s => (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
              step >= s ? "bg-brand text-white" : "bg-gray-100 text-gray-400"
            )}>{s}</div>
            <span className={cn("text-xs font-semibold", step >= s ? "text-gray-800" : "text-gray-400")}>
              {s === 1 ? "Dati Personali" : s === 2 ? "Documenti" : "Conferma"}
            </span>
            {s < 3 && <div className={cn("flex-1 h-0.5", step > s ? "bg-brand" : "bg-gray-200")} />}
          </div>
        ))}
      </div>

      {/* Step 1: Personal Info */}
      {step === 1 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Dati Personali</h3>
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: "first_name", label: "Nome", type: "text", placeholder: "Mario" },
              { key: "last_name", label: "Cognome", type: "text", placeholder: "Rossi" },
              { key: "date_of_birth", label: "Data di Nascita", type: "date", placeholder: "" },
              { key: "phone", label: "Telefono", type: "tel", placeholder: "+39 333 1234567" },
              { key: "address", label: "Indirizzo", type: "text", placeholder: "Via Roma 1", full: true },
              { key: "city", label: "Città", type: "text", placeholder: "Milano" },
              { key: "postal_code", label: "CAP", type: "text", placeholder: "20100" },
            ].map(field => (
              <div key={field.key} className={(field as any).full ? "col-span-2" : ""}>
                <label className="text-[10px] text-gray-400 font-semibold block mb-1">{field.label}</label>
                <input
                  type={field.type}
                  value={(personalInfo as any)[field.key]}
                  onChange={(e) => setPersonalInfo({ ...personalInfo, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-brand"
                />
              </div>
            ))}
          </div>
          <button onClick={() => setStep(2)}
            disabled={!personalInfo.first_name || !personalInfo.last_name || !personalInfo.date_of_birth}
            className="w-full mt-4 py-2.5 rounded-xl bg-brand text-white text-sm font-bold disabled:opacity-50">
            Continua →
          </button>
        </div>
      )}

      {/* Step 2: Documents */}
      {step === 2 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Carica Documenti</h3>
          <div className="space-y-3">
            {docs.map(doc => (
              <div key={doc.type} className={cn(
                "rounded-xl border-2 border-dashed p-4 transition-all",
                doc.uploaded ? "border-emerald-300 bg-emerald-50" : "border-gray-200 hover:border-brand"
              )}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{doc.icon}</span>
                  <div className="flex-1">
                    <div className="text-xs font-bold text-gray-800">{doc.label}</div>
                    <div className="text-[10px] text-gray-400">{doc.desc}</div>
                  </div>
                  {doc.uploaded ? (
                    <span className="text-emerald-500 text-sm font-bold">✓ Caricato</span>
                  ) : (
                    <label className="px-3 py-1.5 rounded-lg bg-brand text-white text-[10px] font-bold cursor-pointer hover:bg-brand-dark">
                      Carica
                      <input type="file" accept="image/*,.pdf" className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleFileSelect(doc.type, e.target.files[0])} />
                    </label>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => setStep(1)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-bold">
              ← Indietro
            </button>
            <button onClick={() => setStep(3)}
              disabled={docs.filter(d => d.uploaded).length < 3}
              className="flex-1 py-2.5 rounded-xl bg-brand text-white text-sm font-bold disabled:opacity-50">
              Continua →
            </button>
          </div>
          <p className="text-[9px] text-gray-400 text-center mt-2">Minimo 3 documenti richiesti. Formati: JPG, PNG, PDF (max 10MB)</p>
        </div>
      )}

      {/* Step 3: Confirm */}
      {step === 3 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-bold text-gray-900 mb-4">Conferma e Invia</h3>
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><span className="text-gray-400">Nome:</span> <span className="font-semibold">{personalInfo.first_name} {personalInfo.last_name}</span></div>
              <div><span className="text-gray-400">Nascita:</span> <span className="font-semibold">{personalInfo.date_of_birth}</span></div>
              <div className="col-span-2"><span className="text-gray-400">Indirizzo:</span> <span className="font-semibold">{personalInfo.address}, {personalInfo.city} {personalInfo.postal_code}</span></div>
              <div><span className="text-gray-400">Documenti:</span> <span className="font-semibold">{docs.filter(d => d.uploaded).length}/4 caricati</span></div>
            </div>
          </div>

          <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 mb-4">
            <p className="text-[10px] text-blue-700">
              ℹ️ I tuoi documenti verranno verificati entro 24-48 ore. Riceverai una notifica via email al completamento.
              I dati sono protetti e trattati secondo GDPR.
            </p>
          </div>

          <label className="flex items-start gap-2 mb-4">
            <input type="checkbox" className="mt-0.5 rounded border-gray-300" />
            <span className="text-[10px] text-gray-500">
              Confermo che le informazioni fornite sono veritiere e autorizzo il trattamento dei dati personali secondo la Privacy Policy.
            </span>
          </label>

          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-bold">
              ← Indietro
            </button>
            <button onClick={handleSubmitKYC} disabled={submitting}
              className={cn("flex-1 py-2.5 rounded-xl text-white text-sm font-bold",
                submitting ? "bg-gray-400" : "bg-emerald-500 hover:bg-emerald-600"
              )}>
              {submitting ? "⏳ Invio..." : "✓ Invia Documenti"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
