import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildImagePrompt,
  generateImage,
  imageGenAvailable,
  imageModel,
  seedFromMint,
} from "./images";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL)) delete process.env[k];
  }
  Object.assign(process.env, ORIGINAL);
});

describe("imageGenAvailable", () => {
  it("is false without a key", () => {
    delete process.env.POLLINATIONS_API_KEY;
    expect(imageGenAvailable()).toBe(false);
  });

  it("is true with a key", () => {
    process.env.POLLINATIONS_API_KEY = "k";
    expect(imageGenAvailable()).toBe(true);
  });

  it("defaults to flux.1-schnell", () => {
    delete process.env.POLLINATIONS_IMAGE_MODEL;
    expect(imageModel()).toBe("black-forest-labs/flux.1-schnell");
  });
});

describe("seedFromMint", () => {
  it("is deterministic for the same mint", () => {
    expect(seedFromMint("abc123")).toBe(seedFromMint("abc123"));
  });

  it("differs between mints", () => {
    expect(seedFromMint("abc123")).not.toBe(seedFromMint("abc124"));
  });

  it("stays non-negative", () => {
    for (const m of ["a", "zzz", "CmhM6MXVc1cbAWQk3ReC6pKvPy4NEz3gFqXwgDi9ucmm"]) {
      expect(seedFromMint(m)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("buildImagePrompt", () => {
  it("includes the style direction and a no-text instruction", () => {
    const p = buildImagePrompt("a frog wizard", "cartoon");
    expect(p).toContain("a frog wizard");
    expect(p).toContain("cartoon");
    expect(p).toMatch(/no text/i);
  });

  it("produces a distinct prompt per style", () => {
    expect(buildImagePrompt("x", "anime")).not.toBe(buildImagePrompt("x", "meme"));
  });
});

describe("generateImage", () => {
  it("returns null without a key and never calls the network", async () => {
    delete process.env.POLLINATIONS_API_KEY;
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await generateImage({ prompt: "x" })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns real bytes on success", async () => {
    process.env.POLLINATIONS_API_KEY = "k";
    const payload = new Uint8Array(4096).fill(7);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(payload, {
            status: 200,
            headers: {
              "content-type": "image/jpeg",
              "x-model-used": "black-forest-labs/flux.1-schnell",
            },
          }),
      ),
    );
    const out = await generateImage({ prompt: "a frog", style: "cartoon" });
    expect(out).not.toBeNull();
    expect(out!.bytes.byteLength).toBe(4096);
    expect(out!.contentType).toBe("image/jpeg");
    expect(out!.provenance).toBe("pollinations");
    expect(out!.model).toBe("black-forest-labs/flux.1-schnell");
  });

  it("rejects a 200 response with a trivially small body", async () => {
    // A 200 with no real payload is not success — this exact failure mode was
    // observed against a different provider that returned 200 with 0 bytes.
    process.env.POLLINATIONS_API_KEY = "k";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(0), { status: 200 })),
    );
    expect(await generateImage({ prompt: "x" })).toBeNull();
  });

  it("returns null on a non-200", async () => {
    process.env.POLLINATIONS_API_KEY = "k";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    expect(await generateImage({ prompt: "x" })).toBeNull();
  });

  it("returns null when the request throws", async () => {
    process.env.POLLINATIONS_API_KEY = "k";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("timeout");
      }),
    );
    expect(await generateImage({ prompt: "x" })).toBeNull();
  });

  it("sends the seed, model and dimensions to the provider", async () => {
    process.env.POLLINATIONS_API_KEY = "k";
    const spy = vi.fn((url: string, init?: RequestInit) => {
      void url;
      void init;
      return Promise.resolve(new Response(new Uint8Array(2048), { status: 200 }));
    });
    vi.stubGlobal("fetch", spy);
    await generateImage({ prompt: "x", seed: 99, width: 256, height: 256 });
    const called = String(spy.mock.calls[0]?.[0]);
    expect(called).toContain("seed=99");
    expect(called).toContain("width=256");
    expect(called).toContain("flux.1-schnell");
  });
});
