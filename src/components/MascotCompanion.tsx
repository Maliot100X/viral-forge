"use client";

import { useEffect, useState } from "react";

/**
 * MascotCompanion — the floating corner companion from the reference site.
 * Bottom-right, dismissible, cycles through short quips about what's on screen.
 */
const QUIPS = [
  "images work too.",
  "no wallet needed to forge.",
  "the AI names it, you add the socials.",
  "logos are generated locally.",
  "the radar runs when you tell it to.",
  "every coin here is simulated.",
];

export default function MascotCompanion() {
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setI((v) => (v + 1) % QUIPS.length), 7000);
    return () => clearInterval(t);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed bottom-4 left-4 z-40 flex items-end gap-2">
      <div
        className="mono rounded-md border border-line-bright bg-bg-card/95 px-3 py-2 text-xs text-fg-dim backdrop-blur"
        style={{ maxWidth: "16rem" }}
      >
        {QUIPS[i]}
      </div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Dismiss companion"
        className="btn px-2 py-1 text-fg-faint"
      >
        ×
      </button>
    </div>
  );
}
