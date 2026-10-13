"use client";

import { useCallback, useRef, useState } from "react";
import Agent3D from "./Agent3D";
import type { Agent3DHandle } from "./agent-3d-types";

/**
 * The agent's 3D body plus the controls that drive it.
 *
 * The clip buttons are deliberately honest about what happened: three.ws bodies
 * differ in which rig they carry, so a clip can genuinely be absent. A button
 * that reports the miss is better than one that appears to work and does nothing.
 */

const CLIPS = [
  { label: "wave", clip: "Wave" },
  { label: "dance", clip: "Dance" },
  { label: "idle", clip: "Idle" },
  { label: "walk", clip: "Walking" },
] as const;

export default function AgentStage({
  body,
  name,
  accent = "#7cf9c0",
  className = "",
}: {
  body: string;
  name: string;
  accent?: string;
  className?: string;
}) {
  const stage = useRef<Agent3DHandle>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const play = useCallback(async (clip: string) => {
    try {
      const ok = await stage.current?.play(clip, { fade_ms: 400 });
      setNote(ok ? `${clip} ▶` : `This body has no "${clip}" clip.`);
    } catch {
      setNote(`"${clip}" could not be played on this body.`);
    }
  }, []);

  return (
    <div className={className} data-agent-stage={name}>
      <div className="relative h-full w-full">
        <Agent3D
          ref={stage}
          body={body}
          name={name}
          accent={accent}
          mode="section"
          kiosk
          eager
          compact={false}
          onReady={() => setReady(true)}
          onError={(message) => setNote(message)}
        />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-1.5 bg-gradient-to-t from-[var(--bg)] to-transparent p-3">
          <div className="pointer-events-auto flex flex-wrap gap-1.5">
            {CLIPS.map((c) => (
              <button
                key={c.clip}
                type="button"
                className="tab border border-line/70 bg-[var(--bg-soft)]/80 backdrop-blur-sm"
                disabled={!ready}
                onClick={() => void play(c.clip)}
              >
                {c.label}
              </button>
            ))}
          </div>
          {note && (
            <span className="pointer-events-none mono ml-auto text-[10px] text-fg-faint">
              {note}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
