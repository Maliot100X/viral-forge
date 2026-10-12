"use client";

import { useEffect, useRef } from "react";

/**
 * Starfield — the animated background layer from the reference site.
 * Canvas-based, respects prefers-reduced-motion, and pauses when the tab is
 * hidden so it costs nothing in a background tab.
 */
export default function Starfield() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let raf = 0;

    interface Star {
      x: number;
      y: number;
      z: number;
      r: number;
      tw: number;
      hue: string;
    }
    let stars: Star[] = [];

    const HUES = ["#e8eaf2", "#7cf9c0", "#a78bfa", "#9aa0b8"];

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas!.clientWidth;
      h = canvas!.clientHeight;
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(240, Math.floor((w * h) / 9000));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        z: Math.random() * 0.8 + 0.2,
        r: Math.random() * 1.3 + 0.25,
        tw: Math.random() * Math.PI * 2,
        hue: HUES[Math.floor(Math.random() * HUES.length)],
      }));
    }

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      // subtle vignette wash so the stars read against #06070f
      const g = ctx.createRadialGradient(w * 0.5, h * 0.35, 0, w * 0.5, h * 0.35, Math.max(w, h) * 0.75);
      g.addColorStop(0, "rgba(20,26,52,0.55)");
      g.addColorStop(1, "rgba(6,7,15,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      const t = Date.now() * 0.001;
      for (const s of stars) {
        const twinkle = reduced ? 0.85 : 0.55 + 0.45 * Math.sin(t * 0.9 + s.tw);
        ctx.globalAlpha = twinkle * s.z;
        ctx.fillStyle = s.hue;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * s.z, 0, Math.PI * 2);
        ctx.fill();

        if (!reduced) {
          s.y -= s.z * 0.055;
          if (s.y < -2) {
            s.y = h + 2;
            s.x = Math.random() * w;
          }
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    }

    function onVisibility() {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="starfield" aria-hidden="true" />;
}
