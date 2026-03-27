import { ServiceDetail } from "./ServiceDetail";
import { SERVICES } from "@/lib/utils/services";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function ServicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const service = SERVICES.find((s) => s.id === id);

  if (!service) {
    notFound();
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-purple"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dashboard
      </Link>

      <ServiceDetail serviceId={id} />
    </main>
  );
}
