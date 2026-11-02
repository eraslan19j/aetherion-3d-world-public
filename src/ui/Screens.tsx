import { useEffect, useState } from "react";
import { game } from "../game/engine";
import { settingsStore, uiStore, useStore, hudStore, defaultSettings, Quality } from "../game/store";
import { audio } from "../game/audio";
import { RuneButton, FullscreenButton, Slider, Icon } from "./common";

const TIPS = [
  "İpucu: Havadayken Boşluk tuşunu basılı tut — Eter kanatları seni süzülttürür.",
  "İpucu: Sandıkları ve çömlekleri kır, Eter Özü ve can küreleri düşer.",
  "İpucu: Titan Dalgası yakındaki nesneleri savurur ve düşmanları sersemletir.",
  "İpucu: Kristal rezonansı yalnızca Yıldırım'a tepki verir.",
  "İpucu: Kadim Sunaklar canını yeniler ve seni yeniden doğuş noktasına bağlar.",
  "İpucu: Gizemli ışık sütunu seni gökyüzüne taşıyabilir.",
];

export function Loading() {
  const ui = useStore(uiStore);
  const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  return (
    <div className="absolute inset-0 grid place-items-center pe" style={{ background: "radial-gradient(ellipse at 50% 40%, #12204a 0%, #05070f 70%)" }}>
      <div className="text-center px-6 w-full max-w-xl">
        <div className="title-aether" style={{ fontSize: "clamp(2rem,7vw,4.4rem)" }}>
          AETHERION
        </div>
        <div className="subtitle mt-3">HAYAL ÖTESİ DİYAR</div>
        <div className="mt-12 mx-auto w-full max-w-md">
          <div className="h-[6px] bg-white/10 relative overflow-hidden border border-[#d6b262]/40">
            <div className="absolute inset-y-0 left-0 transition-all duration-300" style={{ width: `${Math.round(ui.loadProgress * 100)}%`, background: "linear-gradient(90deg,#8fe9ff,#ffe49a)", boxShadow: "0 0 14px #8fe9ff" }} />
          </div>
          <div className="display mt-4 text-[13px] tracking-[0.3em] text-[#cfe9f2] uppercase">{ui.loadText}</div>
          <div className="mt-10 text-[13px] text-[#a9b7c9] italic">{tip}</div>
        </div>
      </div>
    </div>
  );
}

export function Menu() {
  const ui = useStore(uiStore);
  const [showCtl, setShowCtl] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="absolute inset-0 pe fade-in" style={{ background: "linear-gradient(180deg, rgba(3,6,16,0.55) 0%, rgba(3,6,16,0.05) 35%, rgba(3,6,16,0.55) 100%)" }}>
      <div className="absolute inset-0 vignette" />
      <div className="absolute top-3 right-3 flex gap-2 z-10">
        <FullscreenButton />
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center overflow-y-auto scroll py-6">
        <div className="text-center float-up">
          <div className="subtitle mb-3 opacity-80">— EFSANE YENİDEN UYANIYOR —</div>
          <div className="title-aether">AETHERION</div>
          <div className="subtitle mt-4">HAYAL ÖTESİ DİYAR</div>
        </div>
        <div className="mt-8 sm:mt-12 flex flex-col items-center gap-1 float-up" style={{ animationDelay: "0.25s" }}>
          {ui.hasSave && (
            <RuneButton primary onClick={() => game.continueGame()}>
              Devam Et
            </RuneButton>
          )}
          <RuneButton primary={!ui.hasSave} onClick={() => (ui.hasSave ? setConfirm(true) : game.startNew())}>
            Yeni Oyun
          </RuneButton>
          <RuneButton onClick={() => setShowCtl(true)}>Kontroller</RuneButton>
          <RuneButton onClick={() => uiStore.set({ screen: "settings", settingsFrom: "menu" })}>Ayarlar</RuneButton>
        </div>
        <div className="mt-6 text-[11px] tracking-[0.25em] text-[#9fb2c8]/70 uppercase text-center px-4">Dört obeliski uyandır · Eterya Kapısı'nı aç</div>
      </div>
      {confirm && (
        <Modal onClose={() => setConfirm(false)} title="Yeni Yolculuk">
          <p className="text-[#cdd6e4] text-sm leading-relaxed mb-6">Mevcut kayıtlı ilerlemen silinecek ve yolculuk baştan başlayacak. Emin misin?</p>
          <div className="flex flex-col items-center gap-1">
            <RuneButton danger onClick={() => game.startNew()}>
              Evet, Baştan Başla
            </RuneButton>
            <RuneButton onClick={() => setConfirm(false)}>Vazgeç</RuneButton>
          </div>
        </Modal>
      )}
      {showCtl && (
        <Modal onClose={() => setShowCtl(false)} title="Kontroller" wide>
          <Controls />
          <div className="flex justify-center mt-4">
            <RuneButton onClick={() => setShowCtl(false)}>Kapat</RuneButton>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="absolute inset-0 grid place-items-center dim z-20 p-4 pe fade-in" onClick={onClose}>
      <div className={`panel w-full ${wide ? "max-w-3xl" : "max-w-md"} max-h-[92vh] overflow-y-auto scroll p-6 sm:p-8`} onClick={(e) => e.stopPropagation()}>
        <div className="display text-center text-2xl text-[#ffe9a8] tracking-[0.3em] uppercase mb-2" style={{ textShadow: "0 0 16px rgba(255,220,140,.4)" }}>
          {title}
        </div>
        <div className="divider mb-5" />
        {children}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: React.ReactNode; v: string }) {
  return (
    <div className="flex items-center justify-between py-[7px] border-b border-white/5 text-[13px]">
      <span className="text-[#d9ccaa]">{v}</span>
      <span>{k}</span>
    </div>
  );
}

export function Controls() {
  const touch = useStore(uiStore).isTouch;
  return (
    <div className="grid sm:grid-cols-2 gap-x-10">
      <div>
        <div className="display text-[#8fe9ff] text-xs tracking-[0.3em] mb-1 uppercase">Hareket</div>
        <Row v="Yürü" k={<><span className="kbd">W</span><span className="kbd">A</span><span className="kbd">S</span><span className="kbd">D</span></>} />
        <Row v="Koş" k={<span className="kbd">Shift</span>} />
        <Row v="Zıpla / Çift zıpla" k={<span className="kbd">Boşluk</span>} />
        <Row v="Süzül (havada)" k={<span className="kbd">Boşluk basılı</span>} />
        <Row v="Kamera" k={<span className="kbd">Fare</span>} />
        <Row v="Etkileşim" k={<span className="kbd">E</span>} />
      </div>
      <div>
        <div className="display text-[#8fe9ff] text-xs tracking-[0.3em] mb-1 uppercase">Büyüler</div>
        <Row v="Aether Oku" k={<><span className="kbd">Sol Tık</span><span className="kbd">1</span></>} />
        <Row v="Titan Dalgası" k={<><span className="kbd">Sağ Tık</span><span className="kbd">Q</span></>} />
        <Row v="Yıldırım" k={<><span className="kbd">R</span><span className="kbd">3</span></>} />
        <Row v="Portal Adımı" k={<><span className="kbd">C</span><span className="kbd">4</span></>} />
        <Row v="Yetenek defteri / Harita" k={<span className="kbd">Tab</span>} />
        <Row v="Duraklat" k={<span className="kbd">Esc</span>} />
      </div>
      {touch && <div className="sm:col-span-2 mt-3 text-[13px] text-[#cfe9f2]">Dokunmatik: Sol joystick ile hareket, sağ yarıyı sürükleyerek kamera, sağdaki düğmelerle büyü ve zıplama. Joystick'i sonuna kadar itersen koşarsın.</div>}
    </div>
  );
}

export function SettingsPanel() {
  const s = useStore(settingsStore);
  const ui = useStore(uiStore);
  const set = (p: Partial<typeof s>) => settingsStore.set(p);
  const quals: [Quality, string][] = [
    ["auto", "Otomatik"],
    ["low", "Düşük"],
    ["medium", "Orta"],
    ["high", "Yüksek"],
  ];
  return (
    <Modal title="Ayarlar" onClose={() => uiStore.set({ screen: ui.settingsFrom })} wide>
      <div className="grid sm:grid-cols-2 gap-x-10">
        <div>
          <div className="display text-[#8fe9ff] text-xs tracking-[0.3em] mb-3 uppercase">Ses</div>
          <Slider label="Ana ses" value={s.master} onChange={(v) => set({ master: v })} />
          <Slider label="Müzik" value={s.music} onChange={(v) => set({ music: v })} />
          <Slider label="Efektler ve ortam" value={s.sfx} onChange={(v) => set({ sfx: v })} />
        </div>
        <div>
          <div className="display text-[#8fe9ff] text-xs tracking-[0.3em] mb-3 uppercase">Grafik</div>
          <div className="mb-4">
            <div className="text-[13px] tracking-[0.12em] uppercase text-[#d9ccaa] mb-2">Kalite profili</div>
            <div className="seg flex-wrap">
              {quals.map(([q, l]) => (
                <button key={q} className={s.quality === q ? "on" : ""} onClick={() => { audio.uiClick(); set({ quality: q }); }}>
                  {l}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-[#9fb2c8] mt-2">Otomatik: cihaza göre seçilir ve çözünürlük kare hızına göre ayarlanır.</div>
          </div>
          <div className="flex items-center justify-between mb-4">
            <span className="text-[13px] tracking-[0.12em] uppercase text-[#d9ccaa]">Kare hızı göstergesi</span>
            <div className={`switch ${s.showFps ? "on" : ""}`} onClick={() => { audio.uiClick(); set({ showFps: !s.showFps }); }} />
          </div>
        </div>
        <div className="sm:col-span-2 grid sm:grid-cols-2 gap-x-10">
          <div>
            <div className="display text-[#8fe9ff] text-xs tracking-[0.3em] mb-3 uppercase">Kontrol</div>
            <Slider label="Kamera hassasiyeti" value={s.sens} min={0.3} max={2.5} step={0.05} onChange={(v) => set({ sens: v })} fmt={(v) => v.toFixed(2) + "x"} />
          </div>
          <div>
            <div className="display text-[#8fe9ff] text-xs tracking-[0.3em] mb-3 uppercase opacity-0">.</div>
            <Slider label="Ekran sarsıntısı" value={s.shake} onChange={(v) => set({ shake: v })} />
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] tracking-[0.12em] uppercase text-[#d9ccaa]">Y eksenini ters çevir</span>
              <div className={`switch ${s.invertY ? "on" : ""}`} onClick={() => { audio.uiClick(); set({ invertY: !s.invertY }); }} />
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center gap-1 mt-4">
        <div className="flex gap-3 items-center">
          <FullscreenButton />
          <span className="text-xs text-[#9fb2c8] tracking-widest uppercase">Tam ekran</span>
        </div>
        <RuneButton onClick={() => settingsStore.set({ ...defaultSettings })}>Varsayılanlar</RuneButton>
        <RuneButton primary onClick={() => uiStore.set({ screen: ui.settingsFrom })}>
          Geri
        </RuneButton>
      </div>
    </Modal>
  );
}

export function PauseMenu() {
  const [confirm, setConfirm] = useState<null | "restart" | "menu">(null);
  return (
    <div className="absolute inset-0 overflow-y-auto flex dim pe fade-in">
      <div className="fixed top-3 right-3 flex gap-2 z-10">
        <FullscreenButton />
      </div>
      <div className="text-center m-auto py-4">
        <div className="display text-3xl sm:text-5xl text-[#ffe9a8] tracking-[0.4em] pl-[0.4em] mb-1" style={{ textShadow: "0 0 24px rgba(255,220,140,.5)" }}>
          DURAKLATILDI
        </div>
        <div className="divider w-72 mx-auto mb-8" />
        <div className="flex flex-col items-center gap-1">
          <RuneButton primary onClick={() => game.resume()}>
            Devam Et
          </RuneButton>
          <RuneButton onClick={() => game.openJournal()}>Yetenek Defteri</RuneButton>
          <RuneButton onClick={() => uiStore.set({ screen: "settings", settingsFrom: "paused" })}>Ayarlar</RuneButton>
          <RuneButton onClick={() => setConfirm("restart")}>Yeniden Başlat</RuneButton>
          <RuneButton danger onClick={() => setConfirm("menu")}>
            Ana Menü
          </RuneButton>
        </div>
      </div>
      {confirm && (
        <Modal title={confirm === "restart" ? "Yeniden Başlat" : "Ana Menü"} onClose={() => setConfirm(null)}>
          <p className="text-[#cdd6e4] text-sm mb-6 text-center">{confirm === "restart" ? "Tüm ilerleme silinecek ve yolculuk baştan başlayacak." : "İlerleme kaydedilecek ve ana menüye dönülecek."}</p>
          <div className="flex flex-col items-center gap-1">
            <RuneButton danger onClick={() => (confirm === "restart" ? game.startNew() : game.toMenu())}>
              Onayla
            </RuneButton>
            <RuneButton onClick={() => setConfirm(null)}>Vazgeç</RuneButton>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function GameOver() {
  const hud = useStore(hudStore);
  return (
    <div className="absolute inset-0 overflow-y-auto flex pe fade-in" style={{ background: "radial-gradient(ellipse at center, rgba(60,5,15,0.55), rgba(5,2,6,0.93))" }}>
      <div className="text-center px-4 m-auto py-4">
        <div className="display text-4xl sm:text-6xl tracking-[0.4em] pl-[0.4em] text-[#ff9a9a]" style={{ textShadow: "0 0 30px rgba(255,60,80,.6)" }}>
          ESİR DÜŞTÜN
        </div>
        <div className="subtitle mt-4 opacity-80">Gölgeler seni yuttu, ama Eter seni çağırıyor</div>
        <div className="divider w-80 mx-auto my-8" />
        <div className="flex justify-center gap-8 text-sm mb-8 text-[#d9ccaa]">
          <div>
            <div className="text-2xl text-[#8fe9ff]">{hud.shards}</div>
            <div className="text-[11px] tracking-[0.2em] uppercase">Eter Özü</div>
          </div>
          <div>
            <div className="text-2xl text-[#ffe9a8]">{hud.kills}</div>
            <div className="text-[11px] tracking-[0.2em] uppercase">Yenilen Gölge</div>
          </div>
          <div>
            <div className="text-2xl text-[#c59bff]">{hud.discovered}/{hud.totalDiscover}</div>
            <div className="text-[11px] tracking-[0.2em] uppercase">Keşif</div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <RuneButton primary onClick={() => game.respawn()}>
            Sunakta Yeniden Doğ
          </RuneButton>
          <RuneButton onClick={() => game.startNew()}>Baştan Başla</RuneButton>
          <RuneButton danger onClick={() => game.toMenu()}>
            Ana Menü
          </RuneButton>
        </div>
      </div>
    </div>
  );
}

export function Victory() {
  const hud = useStore(hudStore);
  useEffect(() => {
    audio.victory();
  }, []);
  return (
    <div className="absolute inset-0 overflow-y-auto flex pe fade-in" style={{ background: "radial-gradient(ellipse at center, rgba(255,235,170,0.35), rgba(8,14,34,0.93) 70%)" }}>
      <div className="text-center px-4 m-auto py-4">
        <div className="subtitle mb-4">EFSANE TAMAMLANDI</div>
        <div className="title-aether" style={{ fontSize: "clamp(2.2rem,8vw,5.6rem)" }}>
          ETER UYANDI
        </div>
        <div className="subtitle mt-5 opacity-90">Eterya Kapısı açıldı, diyar yeniden ışıldıyor</div>
        <div className="divider w-96 max-w-full mx-auto my-8" />
        <div className="flex justify-center gap-8 text-sm mb-8 text-[#d9ccaa]">
          <div>
            <div className="text-2xl text-[#8fe9ff]">{hud.shards}/{hud.totalShards}</div>
            <div className="text-[11px] tracking-[0.2em] uppercase">Eter Özü</div>
          </div>
          <div>
            <div className="text-2xl text-[#ffe9a8]">{hud.kills}</div>
            <div className="text-[11px] tracking-[0.2em] uppercase">Yenilen Gölge</div>
          </div>
          <div>
            <div className="text-2xl text-[#c59bff]">{hud.discovered}/{hud.totalDiscover}</div>
            <div className="text-[11px] tracking-[0.2em] uppercase">Keşif</div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <RuneButton primary onClick={() => game.startNew()}>
            Yeni Yolculuk
          </RuneButton>
          <RuneButton onClick={() => game.toMenu()}>Ana Menü</RuneButton>
        </div>
      </div>
    </div>
  );
}

export function PortraitHint() {
  return (
    <div className="absolute inset-0 grid place-items-center z-40 pe" style={{ background: "rgba(3,6,16,0.94)" }}>
      <div className="text-center px-8">
        <div className="mx-auto mb-5 w-16 h-28 border-2 border-[#d6b262] rounded-xl relative" style={{ animation: "rot 2.2s ease-in-out infinite" }}>
          <div className="absolute left-1/2 -translate-x-1/2 bottom-2 w-5 h-1 bg-[#d6b262]/70 rounded" />
        </div>
        <style>{`@keyframes rot{0%,20%{transform:rotate(0)}60%,100%{transform:rotate(-90deg)}}`}</style>
        <div className="display text-xl text-[#ffe9a8] tracking-[0.25em] uppercase">Cihazı yatay çevir</div>
        <div className="text-sm text-[#cfe9f2] mt-3">En iyi deneyim için telefonunu yatay konuma getir ve tam ekranı aç.</div>
        <div className="mt-6 flex justify-center">
          <FullscreenButton />
        </div>
      </div>
    </div>
  );
}

export { Icon };
