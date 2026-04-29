import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 px-4">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-1.5 mb-8">
        <span className="text-brand text-3xl">♦</span>
        <span className="text-2xl font-light text-gray-800 tracking-wider">
          vinc<span className="text-brand font-normal">i</span>tu
        </span>
      </Link>

      {/* Card */}
      <div className="w-full max-w-[400px] bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
        {children}
      </div>

      {/* Footer */}
      <p className="mt-6 text-xs text-gray-400">
        © 2026 BetsSolution. Gioca responsabilmente. 18+
      </p>
    </div>
  );
}
