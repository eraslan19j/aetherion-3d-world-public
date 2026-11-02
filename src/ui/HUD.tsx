import { useEffect, useRef } from "react";
import { game, SPELLS } from "../game/engine";
import { hudStore, settingsStore, uiStore, useStore } from "../game/store";
import { Icon, FullscreenButton } from "./common";
import { audio } from "../game/audio";

const norm = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

function Compass() {
  const h = useStore(hudStore);
  const cam = 180 - h.heading;
  const obj = 180 - (h as any).objHeading;
  const items: { a: number; label?: string; major?: boolean }[] = [];
  const names: Record<number, string> = { 0: "K", 45: "KD", 90: "D", 135: "GD", 180: "G", 225: "GB", 270: "B", 315: "KB" };
  for (let a = 0; a < 360; a += 15) items.push({ a, label: names[a], major: a % 45 === 0 });
  const span = 100;
  const od = norm(obj - cam);
  return (
    <div className="absolute left-1/2 -translate-x-1/2 top-2 pointer-events-none" style={{ width: "min(460px, 46vw)" }}>
      <div className="relative h-[30px] overflow-hidden" style={{ maskImage: "linear-gradient(90deg, transparent, #000 20%, #000 80%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, #000 20%, #000 80%, transparent)" }}>
        {items.map((it) => {
          const d = norm(it.a - cam);
          if (Math.abs(d) > span) return null;
          const left = 50 + (d / span) * 50;
          return (
            <div key={it.a} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: left + "%" }}>
              {it.label ? <div className={`display text-[12px] leading-[16px] ${it.label.length === 1 ? "text-[#ffe9a8] font-bold" : "text-[#cfe9f2]/80"}`}>{it.label}</div> : <div className="h-[16px]" />}
              <div className="mx-auto bg-[#d6b262]" style={{ width: 1, height: it.major ? 8 : 4, opacity: 0.8 }} />
            </div>
          );
        })}
        {Math.abs(od) < span && (
          <div className="absolute -translate-x-1/2 top-[14px]" style={{ left: 50 + (od / span) * 50 + "%" }}>
            <div className="w-2.5 h-2.5 rotate-45 bg-[#ffe9a8]" style={{ boxShadow: "0 0 10px #ffd98a" }} />
          </div>
        )}
      </div>
      <div className="absolute left-1/2 -translate-x-1/2 -bottom-[3px] w-0 h-0" style={{ borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "6px solid #ffe9a8" }} />
    </div>
  );
}

function Minimap({ size }: { size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size * dpr;
    cv.height = size * dpr;
    const ctx = cv.getContext("2d")!;
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 66) return;
      last = t;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      try {
        game.drawMinimap(ctx, size, "mini");
      } catch {
        /* ignore */
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [size]);
  return <canvas ref={ref} style={{ width: size, height: size, borderRadius: "50%" }} />;
}

export function HUD({ touch }: { touch: boolean }) {
  const h = useStore(hudStore);
  const s = useStore(settingsStore);
  const ui = useStore(uiStore);
  const mmSize = touch ? 112 : 156;
  const lowHp = h.hp / h.maxHp < 0.3;
  return (
    <div className="absolute inset-0 pointer-events-none select-none">
      {/* status */}
      <div className="absolute left-3 top-3" style={{ width: "min(310px, 40vw)" }}>
        <div className="flex items-center gap-2 mb-1">
          <div className="relative grid place-items-center w-[42px] h-[42px] shrink-0 rotate-45 border-2 border-[#d6b262] bg-[radial-gradient(circle,#2a4a8a,#0a1230)]" style={{ boxShadow: "0 0 14px rgba(127,231,255,.4)" }}>
            <span className="-rotate-45 display font-bold text-[#fff2cc] text-lg">{h.level}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className={`bar hp ${lowHp ? "animate-pulse" : ""}`} style={{ height: 17 }}>
              <b style={{ transform: `scaleX(${Math.max(0, h.hp / h.maxHp)})` }} />
              <i style={{ transform: `scaleX(${Math.max(0, h.hp / h.maxHp)})` }} />
            </div>
            <div className="bar en mt-[3px]" style={{ height: 12 }}>
              <i style={{ transform: `scaleX(${Math.max(0, h.energy / h.maxEnergy)})` }} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[12px] text-[#ffe9a8] pl-[50px]">
          <span className="display tracking-widest">{Math.ceil(h.hp)}/{h.maxHp}</span>
          <span className="flex items-center gap-1 text-[#8fe9ff]">
            <Icon name="gem" size={14} color="#8fe9ff" />
            <b className="display">{h.shards}</b>
            <span className="opacity-60 text-[11px]">/{h.totalShards}</span>
          </span>
          {h.gliding && <span className="text-[#8fe9ff] display tracking-widest text-[11px]">SÜZÜLÜYOR</span>}
          {h.swimming && <span className="text-[#8fe9ff] display tracking-widest text-[11px]">YÜZÜYOR</span>}
        </div>
        {/* objective */}
        <div className="panel mt-3 px-3 py-2" style={{ maxWidth: 300 }}>
          <div className="flex items-center gap-1.5 mb-1">
            {h.runes.map((r, i) => (
              <div key={i} className="w-2.5 h-2.5 rotate-45 border border-[#d6b262]" style={{ background: r ? "#8fe9ff" : "transparent", boxShadow: r ? "0 0 8px #8fe9ff" : "none" }} />
            ))}
            <span className="text-[10px] tracking-[0.25em] text-[#d6b262] uppercase ml-1">Görev</span>
          </div>
          <div className="display text-[13px] text-[#fff2cc] leading-tight">{h.objective}</div>
          <div className="text-[11px] text-[#a9c0d4] mt-0.5 leading-snug">{h.objectiveSub}</div>
        </div>
        {h.combat && <div className="display text-[11px] tracking-[0.4em] text-[#ff8a8a] mt-2 animate-pulse pl-1">SAVAŞ</div>}
      </div>

      <Compass />

      {/* top right */}
      <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
        <div className="flex items-start gap-2">
          <div className="flex flex-col gap-2 pe">
            <button className="chip-btn" onClick={() => { audio.uiClick(); game.pause(); }} aria-label="Duraklat" style={{ width: touch ? 34 : 40, height: touch ? 34 : 40 }}>
              <Icon name="pause" size={18} />
            </button>
            <button className="chip-btn" onClick={() => { audio.uiClick(); game.openJournal(); }} aria-label="Defter" style={{ width: touch ? 34 : 40, height: touch ? 34 : 40 }}>
              <Icon name="book" size={18} />
            </button>
            <FullscreenButton />
          </div>
          <div className="relative rounded-full" style={{ padding: 4, background: "conic-gradient(from 0deg, #d6b262, #6b5424, #d6b262, #6b5424, #d6b262)", boxShadow: "0 0 24px rgba(0,0,0,.6)" }}>
            <div className="rounded-full overflow-hidden bg-[#050a18] relative">
              <Minimap size={mmSize} />
              <div className="absolute top-0.5 left-1/2 -translate-x-1/2 display text-[10px] font-bold text-[#ffe9a8]" style={{ textShadow: "0 1px 2px #000" }}>K</div>
            </div>
          </div>
        </div>
        <div className="text-right" style={{ width: mmSize + 54 }}>
          <div className="display text-[13px] tracking-[0.18em] uppercase leading-tight" style={{ color: h.regionColor, textShadow: "0 0 10px " + h.regionColor + "88" }}>
            {h.region}
          </div>
          <div className="text-[11px] text-[#cfe9f2]/80 tracking-widest">
            {h.clock} {h.weather && <span className="text-[#c59bff]">· {h.weather}</span>}
          </div>
          {s.showFps && (
            <div className="text-[11px] text-[#9fe8a0] mt-1">
              {h.fps} FPS · {h.quality} · {Math.round(h.resScale * 100)}%
            </div>
          )}
        </div>
      </div>

      {/* crosshair */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-80">
        <div className="w-[6px] h-[6px] rotate-45 border border-[#fff2cc]" style={{ boxShadow: "0 0 6px #7fe7ff" }} />
        {[0, 90, 180, 270].map((r) => (
          <div key={r} className="absolute left-1/2 top-1/2 w-[2px] h-[7px] bg-[#fff2cc]/80" style={{ transform: `translate(-50%,-50%) rotate(${r}deg) translateY(-14px)` }} />
        ))}
      </div>

      {/* interaction prompt */}
      {h.prompt && (
        <div className="absolute left-1/2 -translate-x-1/2" style={{ top: "62%" }}>
          <div className="panel px-5 py-2 flex items-center gap-3 prompt">
            <span className="kbd" style={{ fontSize: 14, padding: "3px 10px" }}>
              {h.promptKey}
            </span>
            <span className="display text-[#fff2cc] tracking-[0.15em] uppercase text-sm">{h.prompt}</span>
          </div>
        </div>
      )}

      {/* abilities (desktop) */}
      {!touch && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-5 flex items-end" style={{ gap: "clamp(20px,3.6vmin,36px)" }}>
          {SPELLS.map((sp, i) => {
            const cd = h.cds[i];
            const cost = sp.cost;
            const ready = cd <= 0.001 && h.energy >= cost;
            const keys = ["1", "2", "3", "4"];
            return (
              <div key={i} className="relative" style={{ ["--glow" as any]: sp.color }}>
                <div className={`ability ${ready ? "ready" : ""} ${h.energy < cost && cd <= 0.001 ? "nomana" : ""}`}>
                  <div className="inner" style={{ color: sp.color }}>
                    <Icon name={["bolt", "wave", "storm", "portal"][i]} size={30} />
                  </div>
                  {cd > 0.001 && <div className="cd" style={{ transform: `scaleY(${cd})` }} />}
                  <div className="key">{keys[i]}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* toasts */}
      <div className="absolute right-3 flex flex-col items-end gap-2" style={{ top: touch ? 190 : 250 }}>
        {h.toasts.map((t) => {
          const col = t.kind === "shard" ? "#8fe9ff" : t.kind === "discover" ? "#c59bff" : t.kind === "quest" ? "#ffe9a8" : t.kind === "warn" ? "#ff8a8a" : "#d6b262";
          return (
            <div key={t.id} className="toast" style={{ ["--tc" as any]: col }}>
              <div className="display text-[14px] tracking-[0.1em] uppercase" style={{ color: col }}>
                {t.text}
              </div>
              {t.sub && <div className="text-[12px] text-[#cfe0ee] leading-snug">{t.sub}</div>}
            </div>
          );
        })}
      </div>

      {/* banner */}
      {h.banner && (
        <div key={h.banner.id} className="absolute left-1/2 -translate-x-1/2 text-center w-full px-4" style={{ top: "17%" }}>
          <div className="banner-title">{h.banner.title}</div>
          <div className="divider w-64 mx-auto my-2 opacity-70" />
          <div className="banner-sub uppercase">{h.banner.sub}</div>
        </div>
      )}

      {!touch && !ui.locked && ui.screen === "playing" && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-24 display text-[12px] tracking-[0.3em] text-[#ffe9a8] uppercase animate-pulse">Kamerayı etkinleştirmek için ekrana tıkla</div>
      )}
    </div>
  );
}
