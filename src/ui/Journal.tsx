import { useEffect, useMemo, useRef, useState } from "react";
import { game } from "../game/engine";
import { RuneButton, Icon } from "./common";
import { audio } from "../game/audio";

const DESC = [
  "Staffından yoğunlaşmış bir Eter oku fırlatır. Çömlek ve sandıkları kırar, rünleri ve gölgeleri vurur. Basılı tutarak seri atış yap.",
  "Ayaklarından Eter dalgası yayar. Yakındaki nesneleri savurur, çimleri ezer ve düşmanları sersemletir. Kadim kayaları itmek için ideal.",
  "Hedeflediğin noktaya gökten yıldırım çağırır. Alanda yüksek hasar verir ve kristal rezonanslarını uyandırır.",
  "Baktığın yönde Eter kapısı açıp seni ileri taşır. Uçurumları ve engelleri aşmak, düşmandan kaçmak için kullan.",
];
const KEYS = [
  ["Sol Tık", "1"],
  ["Sağ Tık", "Q"],
  ["R", "3"],
  ["C", "4"],
];
const ICONS = ["bolt", "wave", "storm", "portal"];

export function Journal() {
  const [tab, setTab] = useState<"skills" | "map" | "log">("skills");
  const data = useMemo(() => game.journal(), []);
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (tab !== "map") return;
    const c = cv.current!;
    const size = 460;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    const loop = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      try {
        game.drawMinimap(ctx, size, "full");
      } catch {
        /* ignore */
      }
      raf = window.setTimeout(loop, 120) as any;
    };
    loop();
    return () => clearTimeout(raf);
  }, [tab]);
  const tabs: [typeof tab, string][] = [
    ["skills", "Yetenekler"],
    ["map", "Harita"],
    ["log", "Keşifler"],
  ];
  const nextAt = data.level * 6;
  const prog = (data.shards - (data.level - 1) * 6) / 6;
  return (
    <div className="absolute inset-0 grid place-items-center dim pe fade-in p-3" onClick={() => game.closeJournal()}>
      <div className="panel w-full max-w-4xl max-h-[94vh] flex flex-col p-4 sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <div className="display text-xl sm:text-2xl text-[#ffe9a8] tracking-[0.3em] uppercase" style={{ textShadow: "0 0 16px rgba(255,220,140,.4)" }}>
            Gezgin Defteri
          </div>
          <div className="seg">
            {tabs.map(([k, l]) => (
              <button key={k} className={tab === k ? "on" : ""} onClick={() => { audio.uiClick(); setTab(k); }}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="divider mb-4" />
        <div className="overflow-y-auto scroll flex-1 pr-1">
          {tab === "skills" && (
            <div>
              <div className="flex items-center gap-4 mb-4">
                <div className="grid place-items-center w-14 h-14 rotate-45 border-2 border-[#d6b262] bg-[radial-gradient(circle,#2a4a8a,#0a1230)]">
                  <span className="-rotate-45 display text-2xl font-bold text-[#fff2cc]">{data.level}</span>
                </div>
                <div className="flex-1">
                  <div className="text-xs tracking-[0.2em] uppercase text-[#d9ccaa] mb-1">
                    Seviye {data.level} · Sonraki seviye için {Math.max(0, nextAt - data.shards)} Eter Özü
                  </div>
                  <div className="h-2 bg-white/10 border border-[#d6b262]/40 overflow-hidden">
                    <div className="h-full" style={{ width: `${Math.round(prog * 100)}%`, background: "linear-gradient(90deg,#8fe9ff,#ffe49a)" }} />
                  </div>
                </div>
                <div className="text-right text-sm text-[#8fe9ff] flex items-center gap-1">
                  <Icon name="gem" size={18} color="#8fe9ff" /> {data.shards}/{data.totalShards}
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {data.spells.map((s, i) => (
                  <div key={i} className="border border-[#d6b262]/30 bg-black/25 p-3 flex gap-3">
                    <div className="shrink-0 w-14 h-14 grid place-items-center rotate-45 border-2" style={{ borderColor: s.color, boxShadow: `0 0 16px ${s.color}55`, color: s.color }}>
                      <div className="-rotate-45">
                        <Icon name={ICONS[i]} size={30} />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="display text-[15px] tracking-[0.1em] uppercase" style={{ color: s.color }}>
                        {s.name}
                      </div>
                      <div className="text-[11px] text-[#d9ccaa] mb-1">
                        {KEYS[i].map((k) => (
                          <span key={k} className="kbd">
                            {k}
                          </span>
                        ))}{" "}
                        Enerji {s.cost} · Bekleme {s.cd}s
                      </div>
                      <div className="text-[12px] text-[#bfcddd] leading-snug">{DESC[i]}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 border border-[#d6b262]/30 bg-black/25 p-3 text-[12px] text-[#bfcddd] leading-relaxed">
                <b className="text-[#ffe9a8] display tracking-widest">Eter Yetenekleri:</b> <span className="kbd">Boşluk</span> iki kez basarak havada çift zıpla (8 enerji). Düşerken <span className="kbd">Boşluk</span> tuşunu basılı tutarak Eter kanatlarıyla süzül. Sunaklar canını yeniler.
              </div>
            </div>
          )}
          {tab === "map" && (
            <div className="flex flex-col md:flex-row gap-4 items-center md:items-start">
              <canvas ref={cv} style={{ width: "min(460px, 52vh, 90vw)", height: "min(460px, 52vh, 90vw)", border: "2px solid rgba(214,178,98,.6)", boxShadow: "0 0 30px rgba(0,0,0,.6)", background: "#050a18" }} />
              <div className="flex-1 text-[12px] text-[#cfdbe8] space-y-2">
                <div className="display text-[#8fe9ff] text-xs tracking-[0.3em] uppercase">Simgeler</div>
                <div><span className="inline-block w-2.5 h-2.5 rotate-45 bg-[#ffe9a8] mr-2" /> Obelisk (parlayan = hazır)</div>
                <div><span className="inline-block w-2.5 h-2.5 bg-[#7fe7ff] mr-2" /> Kadim Sunak</div>
                <div><span className="inline-block w-2.5 h-2.5 bg-[#ffd98a] mr-2" /> Sandık</div>
                <div><span className="inline-block w-2.5 h-2.5 rounded-full bg-[#ff5a5a] mr-2" /> Gölge / Golem</div>
                <div><span className="inline-block w-2.5 h-2.5 rotate-45 bg-[#8ff3ff] mr-2" /> Eter Özü (yakında)</div>
                <div className="divider my-3" />
                <div className="display text-[#8fe9ff] text-xs tracking-[0.3em] uppercase">Obeliskler</div>
                {data.obelisks.map((o, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <span className="mt-1 inline-block w-2.5 h-2.5 rotate-45 shrink-0" style={{ background: o.state === 2 ? "#fff" : o.color, boxShadow: `0 0 8px ${o.color}` }} />
                    <div>
                      <div className="text-[#fff2cc]">{o.name} {o.state === 2 ? "✓" : o.state === 1 ? "· hazır" : ""}</div>
                      {o.state < 2 && <div className="text-[#9fb2c8]">{o.hint}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {tab === "log" && (
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1">
              <div className="sm:col-span-2 flex gap-6 text-[12px] text-[#d9ccaa] mb-2">
                <span>Keşif: <b className="text-[#c59bff]">{data.discoveries.filter((d) => d.found).length}/{data.discoveries.length}</b></span>
                <span>Sunak: <b className="text-[#7fe7ff]">{data.shrines.filter((s) => s.active).length}/{data.shrines.length}</b></span>
                <span>Sandık: <b className="text-[#ffd98a]">{data.chestsOpened}/{data.chests}</b></span>
                <span>Gölge: <b className="text-[#ff8a8a]">{data.kills}</b></span>
              </div>
              {data.discoveries.map((d, i) => (
                <div key={i} className={`py-1.5 border-b border-white/5 flex gap-2 ${d.found ? "" : "opacity-40"}`}>
                  <span className="mt-1 inline-block w-2 h-2 rotate-45 shrink-0" style={{ background: d.found ? "#c59bff" : "transparent", border: "1px solid #c59bff" }} />
                  <div>
                    <div className="text-[13px] text-[#fff2cc]">{d.found ? d.name : "???"}</div>
                    <div className="text-[11px] text-[#9fb2c8]">{d.found ? d.sub : "Henüz keşfedilmedi"}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-center mt-3">
          <RuneButton primary onClick={() => game.closeJournal()}>
            Kapat
          </RuneButton>
        </div>
      </div>
    </div>
  );
}
