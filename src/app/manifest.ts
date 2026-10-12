import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VIRAL.forge",
    short_name: "VIRAL.forge",
    description:
      "Anything viral becomes a coin. Forge a meme coin from a prompt, a post, a hashtag, an image, a TikTok or whatever is trending.",
    start_url: "/",
    display: "standalone",
    background_color: "#06070f",
    theme_color: "#06070f",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
