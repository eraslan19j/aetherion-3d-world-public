import { ReactNode } from "react";
import { audio } from "../game/audio";
import { toggleFullscreen, useStore, uiStore } from "../game/store";

export function RuneButton({
  children,
  onClick,
  primary,
  danger,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`rune-btn ${primary ? "primary" : ""} ${danger ? "danger" : ""}`}
      disabled={disabled}
      onMouseEnter={() => audio.uiHover()}
      onClick={() => {
        audio.init();
        audio.uiClick();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

export function Icon({ name, size = 28, color = "currentColor" }: { name: string; size?: number; color?: string }) {
  const p = { width: size, height: size, viewBox: "0 0 32 32", fill: "none", stroke: color, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "bolt":
      return (
        <svg {...p}>
          <circle cx="16" cy="16" r="4.5" fill={color} fillOpacity=".35" />
          <path d="M3 16h7M22 16h7M16 3v7M16 22v7M7 7l5 5M20 20l5 5M25 7l-5 5M12 20l-5 5" />
        </svg>
      );
    case "wave":
      return (
        <svg {...p}>
          <ellipse cx="16" cy="21" rx="4" ry="2" fill={color} fillOpacity=".4" />
          <ellipse cx="16" cy="21" rx="9" ry="4.5" />
          <ellipse cx="16" cy="21" rx="14" ry="7.5" strokeOpacity=".6" />
          <path d="M16 4v10M12 8l4-4 4 4" />
        </svg>
      );
    case "storm":
      return (
        <svg {...p}>
          <path d="M18 2L7 18h8l-3 12L25 12h-8z" fill={color} fillOpacity=".35" />
        </svg>
      );
    case "portal":
      return (
        <svg {...p}>
          <ellipse cx="16" cy="16" rx="7" ry="12" />
          <ellipse cx="16" cy="16" rx="3.5" ry="7" strokeOpacity=".7" />
          <path d="M2 16h5M25 16h5" strokeOpacity=".8" />
        </svg>
      );
    case "jump":
      return (
        <svg {...p}>
          <path d="M16 26V8M8 15l8-8 8 8" />
          <path d="M9 28h14" strokeOpacity=".6" />
        </svg>
      );
    case "hand":
      return (
        <svg {...p}>
          <path d="M16 4l2.5 7H26l-6 4.5 2.3 7.5L16 18l-6.3 5 2.3-7.5L6 11h7.5z" fill={color} fillOpacity=".3" />
        </svg>
      );
    case "pause":
      return (
        <svg {...p}>
          <path d="M11 7v18M21 7v18" strokeWidth={3.5} />
        </svg>
      );
    case "book":
      return (
        <svg {...p}>
          <path d="M5 6c4-2 8-2 11 1 3-3 7-3 11-1v19c-4-2-8-2-11 1-3-3-7-3-11-1z" />
          <path d="M16 7v19" />
        </svg>
      );
    case "full":
      return (
        <svg {...p}>
          <path d="M5 12V5h7M20 5h7v7M27 20v7h-7M12 27H5v-7" />
        </svg>
      );
    case "exit":
      return (
        <svg {...p}>
          <path d="M5 12V5h7M20 5h7v7M27 20v7h-7M12 27H5v-7" transform="rotate(180 16 16) scale(.7) translate(7 7)" />
          <path d="M12 12l-4-4M20 12l4-4M12 20l-4 4M20 20l4 4" />
        </svg>
      );
    case "gem":
      return (
        <svg {...p}>
          <path d="M16 3l9 8-9 18-9-18z" fill={color} fillOpacity=".3" />
          <path d="M7 11h18M16 3l-4 8 4 18 4-18z" strokeOpacity=".7" />
        </svg>
      );
    case "gear":
      return (
        <svg {...p}>
          <circle cx="16" cy="16" r="4.5" />
          <path d="M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M25.2 6.8l-2.8 2.8M9.6 22.4l-2.8 2.8" />
        </svg>
      );
    default:
      return null;
  }
}

export function FullscreenButton({ className = "" }: { className?: string }) {
  const ui = useStore(uiStore);
  return (
    <button
      className={`chip-btn ${className}`}
      title={ui.fullscreen ? "Tam ekrandan çık" : "Tam ekran"}
      aria-label="Tam ekran"
      onMouseEnter={() => audio.uiHover()}
      onClick={() => {
        audio.init();
        audio.uiClick();
        toggleFullscreen();
      }}
    >
      <Icon name={ui.fullscreen ? "exit" : "full"} size={20} />
    </button>
  );
}

export function Slider({ label, value, onChange, max = 1, min = 0, step = 0.01, fmt }: { label: string; value: number; onChange: (v: number) => void; max?: number; min?: number; step?: number; fmt?: (v: number) => string }) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <div className="mb-4">
      <div className="flex justify-between text-[13px] tracking-[0.12em] uppercase text-[#d9ccaa] mb-2">
        <span>{label}</span>
        <span className="text-[#ffe9a8]">{fmt ? fmt(value) : Math.round(value * 100) + "%"}</span>
      </div>
      <input
        className="rng"
        style={{ ["--p" as any]: p + "%" }}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={() => audio.uiClick()}
      />
    </div>
  );
}
