/**
 * Verified bodies and animation packs served by three.ws.
 *
 * Every URL here returned HTTP 200 with `content-type: model/gltf-binary`
 * when checked directly against the CDN. Do not add entries without checking
 * the byte count first — a 404 page still renders as "something loaded" in
 * three.js and the failure surfaces much later as an empty scene.
 */

export type AvatarBody = {
  id: string;
  label: string;
  url: string;
  bytes: number;
  /** Humanoid rigs accept /animations clips; the fox does not. */
  humanoid: boolean;
  tags: string[];
};

const CDN = "https://three.ws";

export const AVATAR_BODIES: AvatarBody[] = [
  {
    id: "default",
    label: "Default",
    url: `${CDN}/avatars/default.glb`,
    bytes: 748088,
    humanoid: true,
    tags: ["neutral", "starter"],
  },
  {
    id: "xbot",
    label: "X-Bot",
    url: `${CDN}/avatars/xbot.glb`,
    bytes: 799692,
    humanoid: true,
    tags: ["robot", "ready-player"],
  },
  {
    id: "cz",
    label: "CZ",
    url: `${CDN}/avatars/cz.glb`,
    bytes: 594920,
    humanoid: true,
    tags: ["portrait", "trader"],
  },
  {
    id: "michelle",
    label: "Michelle",
    url: `${CDN}/avatars/michelle.glb`,
    bytes: 849756,
    humanoid: true,
    tags: ["realistic"],
  },
  {
    id: "realistic-male",
    label: "Realistic Male",
    url: `${CDN}/avatars/realistic-male.glb`,
    bytes: 1234460,
    humanoid: true,
    tags: ["realistic", "full-body"],
  },
  {
    id: "realistic-female",
    label: "Realistic Female",
    url: `${CDN}/avatars/realistic-female.glb`,
    bytes: 1143884,
    humanoid: true,
    tags: ["realistic", "full-body"],
  },
  {
    id: "realistic-halfbody",
    label: "Realistic Half-body",
    url: `${CDN}/avatars/realistic-halfbody.glb`,
    bytes: 490760,
    humanoid: true,
    tags: ["realistic", "half-body"],
  },
  {
    id: "studio",
    label: "Studio",
    url: `${CDN}/avatars/studio.glb`,
    bytes: 1838884,
    humanoid: true,
    tags: ["stylised", "broadcast"],
  },
  {
    id: "cesium-man",
    label: "Cesium Man",
    url: `${CDN}/avatars/cesium-man.glb`,
    bytes: 438044,
    humanoid: true,
    tags: ["classic", "light"],
  },
  {
    id: "mannequin",
    label: "Mannequin",
    url: `${CDN}/avatars/mannequin.glb`,
    bytes: 244016,
    humanoid: true,
    tags: ["minimal", "light"],
  },
  {
    id: "brainstem",
    label: "Brainstem",
    url: `${CDN}/avatars/brainstem.glb`,
    bytes: 3194848,
    humanoid: true,
    tags: ["detailed"],
  },
  {
    id: "selfie-girl",
    label: "Selfie Girl",
    url: `${CDN}/avatars/selfie-girl.glb`,
    bytes: 2235548,
    humanoid: true,
    tags: ["stylised"],
  },
  {
    id: "dancing-twerk",
    label: "Dancing",
    url: `${CDN}/avatars/dancing-twerk.glb`,
    bytes: 3588880,
    humanoid: true,
    tags: ["animation", "loud"],
  },
  {
    id: "pumpfun-pill-cupsey",
    label: "Pumpfun Pill",
    url: `${CDN}/avatars/pumpfun-pill-cupsey.glb`,
    bytes: 2591428,
    humanoid: false,
    tags: ["mascot", "pumpfun"],
  },
  {
    id: "parametric-base",
    label: "Parametric Base",
    url: `${CDN}/avatars/parametric-base.glb`,
    bytes: 6806984,
    humanoid: true,
    tags: ["heavy", "ragdoll"],
  },
  {
    id: "fox",
    label: "Fox",
    url: `${CDN}/avatars/fox.glb`,
    bytes: 162852,
    humanoid: false,
    tags: ["animal", "light", "mascot"],
  },
];

/** Rich-clip packs. `robotexpressive` is the one with the emote set. */
export const ANIMATION_PACKS = [
  {
    id: "fox",
    label: "Fox clips",
    url: `${CDN}/animations/robotexpressive.glb`,
    bytes: 218788,
  },
  {
    id: "soldier",
    label: "Soldier clips",
    url: `${CDN}/animations/soldier.glb`,
    bytes: 677896,
  },
] as const;

export const DEFAULT_AVATAR_ID = "xbot";

export function avatarById(id: string | null | undefined): AvatarBody {
  if (!id) return AVATAR_BODIES.find((b) => b.id === DEFAULT_AVATAR_ID)!;
  return (
    AVATAR_BODIES.find((b) => b.id === id) ??
    AVATAR_BODIES.find((b) => b.id === DEFAULT_AVATAR_ID)!
  );
}

export function isKnownAvatarId(id: string): boolean {
  return AVATAR_BODIES.some((b) => b.id === id);
}

/**
 * Accepts either an id from the catalog or an absolute https GLB URL, so a
 * generated body can be attached later without changing the storage shape.
 */
export function resolveAvatarBody(value: string | null | undefined): {
  id: string;
  url: string;
} {
  if (!value) {
    const fallback = avatarById(null);
    return { id: fallback.id, url: fallback.url };
  }
  if (isKnownAvatarId(value)) {
    const body = avatarById(value);
    return { id: body.id, url: body.url };
  }
  if (value.startsWith("https://")) return { id: value, url: value };
  const fallback = avatarById(null);
  return { id: fallback.id, url: fallback.url };
}

export const EMOTE_CLIPS = [
  "Wave",
  "Dance",
  "ThumbsUp",
  "Jump",
  "Punch",
  "Death",
  "Idle",
  "Walking",
  "Running",
  "Sitting",
] as const;

export type EmoteClip = (typeof EMOTE_CLIPS)[number];
