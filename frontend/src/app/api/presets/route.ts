import { NextResponse } from "next/server";
import { presetContracts, templates } from "@/lib/jobs/presets";
import { MIN_INTERVAL_SEC } from "@/lib/jobs/schedule";
import type { Network } from "@/lib/jobs/types";
import { poolAddress, poolV2Address } from "@/lib/pool/abi";

export const dynamic = "force-dynamic";

const NETWORKS: Network[] = ["studio", "bradbury"];

// Prefilled job templates. Shape (lib/jobs/client.ts `PresetsResponse`):
//   { minIntervalSec, pool: { bradbury, v2 }, presets: [{ id, name, description,
//     networks, availability: { studio, bradbury }, template: { steps, schedule, assertions },
//     templates: { studio, bradbury } }] }
// `template` carries the contract addresses of ?network= (default bradbury);
// `templates` has both, since preset contracts live at different addresses.
export async function GET(request: Request) {
  const n = new URL(request.url).searchParams.get("network");
  const network: Network = n === "studio" ? "studio" : "bradbury";
  const byNetwork = Object.fromEntries(NETWORKS.map((x) => [x, templates(x, presetContracts(x))])) as Record<
    Network,
    ReturnType<typeof templates>
  >;
  const presets = byNetwork[network].map((t) => {
    const of = (x: Network) => byNetwork[x].find((y) => y.preset === t.preset)!;
    const tpl = (x: Network) => ({ steps: of(x).steps, schedule: of(x).schedule, assertions: of(x).assertions });
    const networks: Network[] = t.preset === "heartbeat" ? ["bradbury"] : NETWORKS;
    return {
      id: t.preset,
      name: t.title,
      description: t.description,
      networks,
      systemOnly: !!t.systemOnly,
      availability: Object.fromEntries(
        networks.map((x) => [x, of(x).available ? { ok: true } : { ok: false, reason: of(x).unavailableReason }])
      ),
      template: tpl(network),
      templates: Object.fromEntries(networks.map((x) => [x, tpl(x)])),
      jobName: t.name,
    };
  });
  return NextResponse.json({ minIntervalSec: MIN_INTERVAL_SEC, pool: { bradbury: poolAddress(), v2: !!poolV2Address() }, presets });
}
