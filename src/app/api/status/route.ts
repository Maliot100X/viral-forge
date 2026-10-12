import { NextResponse, connection } from "next/server";
import { brainStatus } from "@/lib/forge";
import {
  activeCluster,
  mainnetEnabled,
  walletAddress,
  walletBalanceSol,
} from "@/lib/solana";
import { imageGenAvailable, imageModel } from "@/lib/images";

// Reports which engines are actually wired up.
//
// This exists so the UI can describe itself truthfully instead of hardcoding
// claims like "every coin here is simulated" or "mainnet". A deploy without
// keys and a deploy with keys look completely different here, which is the
// whole point.

export async function GET() {
  await connection();

  const cluster = activeCluster();

  return NextResponse.json({
    brain: brainStatus(),
    image: {
      live: imageGenAvailable(),
      model: imageGenAvailable() ? imageModel() : null,
      label: imageGenAvailable() ? "POLLINATIONS IMAGES" : "PROCEDURAL ART",
    },
    cluster,
    mainnetEnabled: mainnetEnabled(),
    wallet: {
      configured: walletAddress() !== null,
      address: walletAddress(),
      balanceSol: await walletBalanceSol(),
    },
  });
}
