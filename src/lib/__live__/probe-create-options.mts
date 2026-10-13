import { readFileSync } from "node:fs";
const raw = readFileSync("/home/coder/.env","utf8");
for (const l of raw.split("\n")) { const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if(m&&!process.env[m[1]]) process.env[m[1]]=m[2].replace(/^["']|["']$/g,""); }
const r = await fetch("https://pumpdev.io/api/health");
const h = await r.json();
console.log("HEALTH:", JSON.stringify(h, null, 2).slice(0, 1500));
