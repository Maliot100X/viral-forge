import "./env";

async function main() {
  const { query } = await import("../db");
  const rows = await query<{ ticker: string }>(
    "select ticker from coins where name = 'Fed Pigeon Chad' limit 1",
  );
  const t = rows[0].ticker;
  console.log("raw         :", JSON.stringify(t));
  console.log("length      :", t.length, "implicit in String(t)");
  console.log("codePoints  :", [...t].map((c) => c.codePointAt(0)));
  console.log("startsWith$ :", t.startsWith("$"));
  console.log("charCodes   :", Array.from(t).map((c) => c.charCodeAt(0)));
}
main().catch((e) => { console.error(e); process.exit(1); });
