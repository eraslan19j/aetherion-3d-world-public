import { useEffect, useRef } from "react";
import { game } from "./game/engine";
import { audio } from "./game/audio";
import { settingsStore, uiStore, useStore } from "./game/store";
import { HUD } from "./ui/HUD";
import { TouchControls } from "./ui/Touch";
import { Journal } from "./ui/Journal";
import { Loading, Menu, SettingsPanel, PauseMenu, GameOver, Victory, PortraitHint } from "./ui/Screens";

let started = false;

export default function App() {
  const ref = useRef<HTMLDivElement>(null);
  const ui = useStore(uiStore);

  useEffect(() => {
    if (started) return;
    started = true;
    const s = settingsStore.get();
    audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    game
      .init(ref.current!, (p, t) => uiStore.set({ loadProgress: p, loadText: t }))
      .catch((e) => {
        console.error(e);
        uiStore.set({ loadText: "Bir hata oluştu: " + (e?.message || e) });
      });
    const unlock = () => {
      audio.init();
      audio.setVolumes(audio.vols);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    const prevent = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", prevent as any);
    document.addEventListener("contextmenu", prevent);
  }, []);

  const playing = ui.screen === "playing" || ui.screen === "paused";
  return (
    <div className="game-root">
      <div ref={ref} className="game-canvas" />
      <div className="ui-layer">
        {playing && <HUD touch={ui.isTouch} />}
        {ui.screen === "playing" && ui.isTouch && <TouchControls />}
        {ui.screen === "loading" && <Loading />}
        {ui.screen === "menu" && <Menu />}
        {ui.screen === "paused" && <PauseMenu />}
        {ui.screen === "journal" && <Journal />}
        {ui.screen === "dead" && <GameOver />}
        {ui.screen === "won" && <Victory />}
        {ui.screen === "settings" && <SettingsPanel />}
        {ui.isTouch && ui.portrait && ui.screen !== "loading" && <PortraitHint />}
      </div>
    </div>
  );
}
