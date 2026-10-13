import { getCoin } from "@/lib/store";
import { logoFromMint } from "@/lib/logo";

export const size = { width: 1200, height: 630 };
export const contentType = "image/svg+xml";
export const alt = "Coin share card";

/**
 * Share card. Rendered as SVG because next/og's raster pipeline needs a native
 * font stack that is not present in this environment; SVG has no such
 * dependency and scales losslessly. Route shape matches the reference site's
 * /coin/<mint>/opengraph-image.
 */
export default async function Image({
  params,
}: {
  params: Promise<{ mint: string }>;
}) {
  const { mint } = await params;
  const coin = await getCoin(mint);

  const name = coin?.name ?? "Unknown coin";
  const symbol = coin?.symbol ?? "???";
  const desc = (coin?.description ?? "").split("\n")[0].slice(0, 150);
  const logo = logoFromMint(mint, coin?.imageStyle ?? "auto");
  const inner = logo.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs>
  <clipPath id="c"><rect x="60" y="165" width="300" height="300" rx="16"/></clipPath>
</defs>
<rect width="1200" height="630" fill="#06070f"/>
<g clip-path="url(#c)"><svg x="60" y="165" width="300" height="300" viewBox="0 0 16 16" shape-rendering="crispEdges">${inner}</svg></g>
<rect x="60" y="165" width="300" height="300" rx="16" fill="none" stroke="#2a3050" stroke-width="2"/>
<text x="410" y="215" font-family="monospace" font-size="34" fill="#7cf9c0">${symbol.replace(/[<>&]/g, "")}</text>
<text x="410" y="285" font-family="monospace" font-size="56" fill="#e8eaf2">${name.replace(/[<>&]/g, "")}</text>
<foreignObject x="410" y="320" width="730" height="180">
  <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:monospace;font-size:22px;line-height:1.5;color:#9aa0b8">${desc.replace(/[<>&]/g, "")}</div>
</foreignObject>
<text x="60" y="560" font-family="monospace" font-size="24" fill="#5d6480">VIRAL.forge — anything viral becomes a coin.</text>
</svg>`;

  return new Response(svg, {
    headers: { "content-type": "image/svg+xml; charset=utf-8" },
  });
}
