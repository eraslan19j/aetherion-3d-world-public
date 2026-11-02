import { useSyncExternalStore } from "react";

export type Quality = "auto" | "low" | "medium" | "high";

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  quality: Quality;
  sens: number;
  invertY: boolean;
  shake: number;
  showFps: boolean;
}

export const defaultSettings: Settings = {
  master: 0.8,
  music: 0.6,
  sfx: 0.8,
  quality: "auto",
  sens: 1,
  invertY: false,
  shake: 1,
  showFps: false,
};

export function createStore<T extends object>(initial: T) {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<T>) {
      state = { ...state, ...patch };
      subs.forEach((f) => f());
    },
    subscribe(f: () => void) {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}

export function useStore<T extends object>(store: ReturnType<typeof createStore<T>>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem("aetherion.settings");
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...defaultSettings };
}

export const settingsStore = createStore<Settings>(loadSettings());
settingsStore.subscribe(() => {
  try {
    localStorage.setItem("aetherion.settings", JSON.stringify(settingsStore.get()));
  } catch {
    /* ignore */
  }
});

export type Screen = "menu" | "loading" | "playing" | "paused" | "journal" | "dead" | "won" | "settings";

export interface UiState {
  screen: Screen;
  settingsFrom: Screen;
  loadProgress: number;
  loadText: string;
  hasSave: boolean;
  isTouch: boolean;
  fullscreen: boolean;
  portrait: boolean;
  ready: boolean;
  locked: boolean;
}

export const uiStore = createStore<UiState>({
  screen: "loading",
  settingsFrom: "menu",
  loadProgress: 0,
  loadText: "Gökyüzü örülüyor…",
  hasSave: (() => {
    try {
      return !!localStorage.getItem("aetherion.save");
    } catch {
      return false;
    }
  })(),
  isTouch: typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0) && window.matchMedia?.("(pointer: coarse)").matches,
  fullscreen: false,
  portrait: false,
  ready: false,
  locked: false,
});

export interface Toast {
  id: number;
  text: string;
  sub?: string;
  kind: "info" | "shard" | "discover" | "quest" | "warn";
}

export interface HudState {
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  shards: number;
  totalShards: number;
  runes: boolean[];
  region: string;
  regionSub: string;
  regionColor: string;
  objective: string;
  objectiveSub: string;
  prompt: string;
  promptKey: string;
  cds: number[];
  discovered: number;
  totalDiscover: number;
  level: number;
  nextLevel: number;
  fps: number;
  clock: string;
  heading: number;
  combat: boolean;
  gliding: boolean;
  swimming: boolean;
  weather: string;
  kills: number;
  toasts: Toast[];
  banner: { id: number; title: string; sub: string } | null;
  hitFlash: number;
  quality: string;
  resScale: number;
  objHeading: number;
}

export const hudStore = createStore<HudState>({
  hp: 100,
  maxHp: 100,
  energy: 100,
  maxEnergy: 100,
  shards: 0,
  totalShards: 0,
  runes: [false, false, false, false],
  region: "",
  regionSub: "",
  regionColor: "#9fe8ff",
  objective: "",
  objectiveSub: "",
  prompt: "",
  promptKey: "E",
  cds: [0, 0, 0, 0],
  discovered: 0,
  totalDiscover: 0,
  level: 1,
  nextLevel: 5,
  fps: 60,
  clock: "",
  heading: 0,
  combat: false,
  gliding: false,
  swimming: false,
  weather: "",
  kills: 0,
  toasts: [],
  banner: null,
  hitFlash: 0,
  quality: "",
  resScale: 1,
  objHeading: 0,
});

let toastId = 1;
export function pushToast(text: string, kind: Toast["kind"] = "info", sub?: string, ttl = 4200) {
  const id = toastId++;
  const t = hudStore.get().toasts.slice(-3);
  hudStore.set({ toasts: [...t, { id, text, kind, sub }] });
  setTimeout(() => {
    hudStore.set({ toasts: hudStore.get().toasts.filter((x) => x.id !== id) });
  }, ttl);
}

export function showBanner(title: string, sub: string, ttl = 4200) {
  const id = toastId++;
  hudStore.set({ banner: { id, title, sub } });
  setTimeout(() => {
    if (hudStore.get().banner?.id === id) hudStore.set({ banner: null });
  }, ttl);
}

// ---- fullscreen helper (with iOS fallback) ----
export async function toggleFullscreen(): Promise<boolean> {
  const d: any = document;
  const el: any = document.documentElement;
  const isFs = !!(d.fullscreenElement || d.webkitFullscreenElement);
  try {
    if (!isFs) {
      const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (req) {
        await req.call(el, { navigationUI: "hide" });
        try {
          await (screen.orientation as any)?.lock?.("landscape");
        } catch {
          /* not supported */
        }
        return true;
      }
      // iOS iPhone Safari: no Fullscreen API for non-video elements
      document.body.classList.add("pseudo-fs");
      window.scrollTo(0, 1);
      uiStore.set({ fullscreen: true });
      pushToast("Tam ekran bu tarayıcıda kısıtlı", "info", "Safari: Paylaş → Ana Ekrana Ekle ile tam ekran oynayın.", 6000);
      return true;
    } else {
      const ex = d.exitFullscreen || d.webkitExitFullscreen || d.msExitFullscreen;
      if (ex) await ex.call(d);
      document.body.classList.remove("pseudo-fs");
      try {
        (screen.orientation as any)?.unlock?.();
      } catch {
        /* ignore */
      }
      uiStore.set({ fullscreen: false });
      return false;
    }
  } catch {
    return false;
  }
}

if (typeof document !== "undefined") {
  const sync = () => {
    const d: any = document;
    uiStore.set({ fullscreen: !!(d.fullscreenElement || d.webkitFullscreenElement) || document.body.classList.contains("pseudo-fs") });
  };
  document.addEventListener("fullscreenchange", sync);
  document.addEventListener("webkitfullscreenchange", sync);
}
