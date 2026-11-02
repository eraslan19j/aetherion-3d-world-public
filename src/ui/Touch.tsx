import { useRef, useState, ReactNode } from "react";
import { game, SPELLS } from "../game/engine";
import { hudStore, settingsStore, useStore } from "../game/store";
import { Icon } from "./common";

function TBtn({
  style,
  onDown,
  onUp,
  children,
  cd = 0,
  glow = "#7fe7ff",
  label,
}: {
  style: React.CSSProperties;
  onDown: () => void;
  onUp?: () => void;
  children: ReactNode;
  cd?: number;
  glow?: string;
  label?: string;
}) {
  const [down, setDown] = useState(false);
  return (
    <div
      className={`t-btn ${down ? "down" : ""}`}
      aria-label={label}
      style={{ ...style, ["--glow" as any]: glow, color: glow }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDown(true);
        onDown();
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        setDown(false);
        onUp?.();
      }}
      onPointerCancel={() => {
        setDown(false);
        onUp?.();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
      {cd > 0.001 && <div className="cdm" style={{ transform: `scaleY(${cd})` }} />}
    </div>
  );
}

export function TouchControls() {
  const h = useStore(hudStore);
  const inp = game.input;
  const [stick, setStick] = useState<{ ox: number; oy: number; x: number; y: number } | null>(null);
  const stickId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });
  const R = 56;

  const sens = () => settingsStore.get().sens;

  const onStickDown = (e: React.PointerEvent) => {
    if (stickId.current !== null) return;
    stickId.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    inp.isTouchActive = true;
    setStick({ ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY });
  };
  const onStickMove = (e: React.PointerEvent) => {
    if (e.pointerId !== stickId.current || !stick) return;
    let dx = e.clientX - stick.ox;
    let dy = e.clientY - stick.oy;
    const l = Math.hypot(dx, dy);
    if (l > R) {
      dx = (dx / l) * R;
      dy = (dy / l) * R;
    }
    setStick({ ...stick, x: stick.ox + dx, y: stick.oy + dy });
    const dead = 0.12;
    let nx = dx / R;
    let ny = -dy / R;
    const m = Math.hypot(nx, ny);
    if (m < dead) {
      nx = 0;
      ny = 0;
    } else {
      const k = (m - dead) / (1 - dead) / m;
      nx *= k;
      ny *= k;
    }
    inp.touchX = nx;
    inp.touchY = ny;
  };
  const onStickUp = (e: React.PointerEvent) => {
    if (e.pointerId !== stickId.current) return;
    stickId.current = null;
    inp.touchX = 0;
    inp.touchY = 0;
    setStick(null);
  };

  const onLookDown = (e: React.PointerEvent) => {
    if (lookId.current !== null) return;
    lookId.current = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    lookLast.current = { x: e.clientX, y: e.clientY };
  };
  const onLookMove = (e: React.PointerEvent) => {
    if (e.pointerId !== lookId.current) return;
    const dx = e.clientX - lookLast.current.x;
    const dy = e.clientY - lookLast.current.y;
    lookLast.current = { x: e.clientX, y: e.clientY };
    inp.lookDX += dx * 1.55 * sens();
    inp.lookDY += dy * 1.55 * sens();
  };
  const onLookUp = (e: React.PointerEvent) => {
    if (e.pointerId === lookId.current) lookId.current = null;
  };

  const small = "clamp(48px, 10.5vmin, 76px)";
  const big = "clamp(64px, 15vmin, 108px)";
  const med = "clamp(54px, 12vmin, 88px)";
  const sp = (i: number) => SPELLS[i];
  const dim = (i: number) => (h.energy < SPELLS[i].cost ? 0.55 : 1);

  return (
    <div className="absolute inset-0" style={{ touchAction: "none" }} onContextMenu={(e) => e.preventDefault()}>
      {/* joystick zone */}
      <div className="absolute left-0 bottom-0 pe" style={{ width: "42%", height: "72%", touchAction: "none" }} onPointerDown={onStickDown} onPointerMove={onStickMove} onPointerUp={onStickUp} onPointerCancel={onStickUp} />
      {/* look zone */}
      <div className="absolute right-0 top-0 pe" style={{ width: "58%", height: "100%", touchAction: "none" }} onPointerDown={onLookDown} onPointerMove={onLookMove} onPointerUp={onLookUp} onPointerCancel={onLookUp} />

      {!stick && (
        <div className="absolute pointer-events-none opacity-40" style={{ left: "9vmin", bottom: "10vmin", width: 112, height: 112, borderRadius: "50%", border: "2px dashed #d6b262" }}>
          <div className="absolute inset-0 grid place-items-center text-[#d6b262] display text-[10px] tracking-widest">HAREKET</div>
        </div>
      )}
      {stick && (
        <div className="absolute pointer-events-none" style={{ left: stick.ox - R - 6, top: stick.oy - R - 6, width: (R + 6) * 2, height: (R + 6) * 2 }}>
          <div className="absolute inset-0 rounded-full" style={{ border: "2px solid rgba(214,178,98,.7)", background: "radial-gradient(circle, rgba(20,40,90,.25), rgba(8,12,30,.45))", boxShadow: "0 0 22px rgba(127,231,255,.25)" }} />
          <div
            className="absolute rounded-full"
            style={{
              width: 56,
              height: 56,
              left: R + 6 - 28 + (stick.x - stick.ox),
              top: R + 6 - 28 + (stick.y - stick.oy),
              background: "radial-gradient(circle at 40% 30%, #fff2cc, #c79a3d)",
              boxShadow: "0 0 18px rgba(255,220,140,.7)",
            }}
          />
        </div>
      )}

      {/* action buttons */}
      <TBtn style={{ right: "3vmin", bottom: "5vmin", width: big, height: big }} glow={sp(0).color} cd={0} label="Aether Oku" onDown={() => { inp.touchFire = true; }} onUp={() => { inp.touchFire = false; }}>
        <div style={{ opacity: dim(0) }}>
          <Icon name="bolt" size={42} />
        </div>
      </TBtn>
      <TBtn style={{ right: "calc(3vmin + " + big + " + 2.5vmin)", bottom: "2.5vmin", width: med, height: med }} glow="#fff2cc" label="Zıpla" onDown={() => { inp.jumpPressed = true; inp.jumpHeldTouch = true; }} onUp={() => { inp.jumpHeldTouch = false; }}>
        <Icon name="jump" size={34} />
      </TBtn>
      <TBtn style={{ right: "3vmin", bottom: "calc(5vmin + " + big + " + 2vmin)", width: small, height: small }} glow={sp(1).color} cd={h.cds[1]} label="Titan Dalgası" onDown={() => inp.spellQueue.push(1)}>
        <div style={{ opacity: dim(1) }}>
          <Icon name="wave" size={28} />
        </div>
      </TBtn>
      <TBtn style={{ right: "calc(3vmin + " + small + " + 2vmin)", bottom: "calc(5vmin + " + big + " + 0.5vmin)", width: small, height: small }} glow={sp(2).color} cd={h.cds[2]} label="Yıldırım" onDown={() => inp.spellQueue.push(2)}>
        <div style={{ opacity: dim(2) }}>
          <Icon name="storm" size={28} />
        </div>
      </TBtn>
      <TBtn style={{ right: "calc(3vmin + " + big + " + 2.5vmin + " + med + " + 2vmin)", bottom: "3.5vmin", width: small, height: small }} glow={sp(3).color} cd={h.cds[3]} label="Portal Adımı" onDown={() => inp.spellQueue.push(3)}>
        <div style={{ opacity: dim(3) }}>
          <Icon name="portal" size={28} />
        </div>
      </TBtn>
      {h.prompt && (
        <TBtn style={{ left: "50%", marginLeft: "-" + "clamp(30px,7vmin,48px)", bottom: "30vmin", width: "clamp(60px,14vmin,96px)", height: "clamp(60px,14vmin,96px)" }} glow="#ffe9a8" label={h.prompt} onDown={() => { inp.interactPressed = true; }}>
          <div className="text-center leading-tight">
            <Icon name="hand" size={30} />
            <div className="display text-[9px] tracking-wider uppercase mt-0.5">{h.prompt.length > 14 ? "Dokun" : h.prompt}</div>
          </div>
        </TBtn>
      )}
    </div>
  );
}
