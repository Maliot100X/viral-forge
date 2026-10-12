import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.SITE_URL ?? "https://viral-forge.vercel.app";
  const now = new Date();

  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${base}/coins`, lastModified: now, changeFrequency: "hourly", priority: 0.8 },
    { url: `${base}/radar`, lastModified: now, changeFrequency: "hourly", priority: 0.7 },
    { url: `${base}/tokenomics`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
  ];
}
