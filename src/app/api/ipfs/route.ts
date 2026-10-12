import { NextResponse } from "next/server";
import { z } from "zod";

// IPFS metadata endpoint.
//
// The reference site pins token metadata to IPFS and returns the resulting URI.
// No pinning provider is configured in this build, so the endpoint returns a
// deterministic content-addressed URI derived from the metadata itself, plus the
// full metadata document. The URI shape (ipfs://<cid-like>) matches what the UI
// expects, and — importantly — it never claims a real pin occurred.

const Body = z.object({
  name: z.string().min(1).max(60),
  symbol: z.string().min(1).max(10),
  description: z.string().max(800).default(""),
  image: z.string().default(""),
  tags: z.array(z.string()).max(8).default([]),
});

function pseudoCid(input: string): string {
  // FNV-1a over the canonical metadata, expanded to a 46-char base58 string so
  // it renders like a real CIDv0 without pretending to be one.
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let h1 = 2166136261;
  let h2 = 2246822519;
  for (let i = 0; i < input.length; i++) {
    h1 ^= input.charCodeAt(i); h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ input.charCodeAt(i), 3266489917) >>> 0;
  }
  let out = "Qm";
  let state = h1 || 1;
  for (let i = 0; i < 44; i++) {
    state = (Math.imul(state, 1664525) + 1013904223 + h2) >>> 0;
    out += B58[state % B58.length];
  }
  return out;
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const metadata = {
    name: parsed.data.name,
    symbol: parsed.data.symbol,
    description: parsed.data.description,
    image: parsed.data.image,
    tags: parsed.data.tags,
    properties: { platform: "viral-forge" },
  };

  const cid = pseudoCid(JSON.stringify(metadata));

  return NextResponse.json({
    uri: `ipfs://${cid}`,
    cid,
    metadata,
    pinned: false,
    note: "No pinning provider configured — URI derived locally from metadata.",
  });
}
