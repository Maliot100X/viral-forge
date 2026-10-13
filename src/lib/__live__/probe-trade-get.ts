// Reproduces GET /api/trade (the holdings read the sell presets depend on)
// against real devnet, through the production route handler.
import "./env";

async function main() {
  const route = await import("../../app/api/trade/route");
  const url =
    "http://localhost/api/trade?mint=" + process.argv[2] +
    "&holder=CMhM6MXVc1cbAWQk3ReC6pKvPy4NEz3gFqXwgDi9ucmm";
  try {
    const res = await route.GET(new Request(url));
    console.log("HTTP", res.status);
    console.log(JSON.stringify(await res.json()));
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string; stack?: string };
    console.error("GET_THREW", err?.code ?? "", err?.message ?? err);
    console.error((err?.stack ?? "").split("\n").slice(0, 12).join("\n"));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("PROBE_FAILED", e?.message ?? e);
  process.exit(1);
});
