import React from "react";
import { Layers, Sparkles } from "lucide-react";
import { LETTER_SQUARE, WORD_SQUARE, SLOTS, letterValue } from "../lib/letters.ts";

/** A cream letter tile with its points in the corner. */
export const LetterTile: React.FC<{ letter: string; size?: "rack" | "slot" | "chip"; className?: string }> = ({ letter, size = "rack", className = "" }) => {
  const big = size === "rack";
  return (
    <span
      className={`relative w-full h-full flex items-center justify-center rounded-[18%] bg-gradient-to-b from-[#fbf7ee] to-[#e9e1cf] text-ink select-none ${className}`}
      style={{ boxShadow: `inset 0 -${big ? 5 : 3}px 0 #c9bea6, 0 ${big ? 4 : 2}px 0 rgba(0,0,0,.45)` }}
    >
      <span className={`font-sans font-extrabold uppercase leading-none ${big ? "text-[clamp(1.6rem,9vw,2.6rem)]" : size === "slot" ? "text-[clamp(1.05rem,5.4vw,1.5rem)]" : "text-sm"}`}>
        {letter}
      </span>
      {size !== "chip" && (
        <span className={`absolute font-mono font-semibold text-ink/60 ${big ? "right-[10%] bottom-[8%] text-xs" : "right-[8%] bottom-[4%] text-[9px]"}`}>{letterValue(letter)}</span>
      )}
    </span>
  );
};

/** The row of seven squares the word is built in. Tap a letter to send it back. */
export const WordSlots: React.FC<{ letters: string[]; shake: number; flash: boolean; onRemove: (i: number) => void; disabled?: boolean }> = ({
  letters,
  shake,
  flash,
  onRemove,
  disabled,
}) => (
  <div key={shake} className={`grid gap-1.5 w-full max-w-[26rem] ${shake ? "animate-shake" : ""}`} style={{ gridTemplateColumns: `repeat(${SLOTS}, minmax(0, 1fr))` }} aria-label="Your word">
    {Array.from({ length: SLOTS }, (_, i) => {
      const l = letters[i];
      const bonus = i === LETTER_SQUARE ? "letter" : i === WORD_SQUARE ? "word" : null;
      return (
        <button
          key={i}
          type="button"
          disabled={!l || disabled}
          onClick={() => onRemove(i)}
          aria-label={l ? `Letter ${l.toUpperCase()}, tap to remove` : bonus === "letter" ? "Double letter square" : bonus === "word" ? "Double word square" : "Empty square"}
          className={`relative aspect-square rounded-[18%] border-2 border-dashed flex items-center justify-center transition-colors ${
            l
              ? "border-transparent"
              : bonus === "letter"
                ? "border-present/60 bg-present-soft text-present"
                : bonus === "word"
                  ? "border-correct/60 bg-correct-soft text-correct"
                  : "border-rule bg-ink/40"
          } ${flash && l ? "animate-pop" : ""}`}
        >
          {l ? (
            <span className="absolute inset-0">
              <LetterTile letter={l} size="slot" />
              {bonus && (
                <span
                  className={`absolute -top-1.5 left-1/2 -translate-x-1/2 px-1 rounded text-[8px] font-mono font-bold leading-tight ${
                    bonus === "letter" ? "bg-present text-ink" : "bg-correct text-paper"
                  }`}
                >
                  {bonus === "letter" ? "2×L" : "2×W"}
                </span>
              )}
            </span>
          ) : bonus === "letter" ? (
            <span className="flex flex-col items-center leading-none">
              <Layers className="w-4 h-4" />
              <span className="text-[9px] font-mono font-bold mt-0.5">2×L</span>
            </span>
          ) : bonus === "word" ? (
            <span className="flex flex-col items-center leading-none">
              <Sparkles className="w-4 h-4" />
              <span className="text-[9px] font-mono font-bold mt-0.5">2×W</span>
            </span>
          ) : null}
        </button>
      );
    })}
  </div>
);

/** The 3×3 rack. `tiles[i]` is the letter on square i (null when the bag ran out). */
export const Rack: React.FC<{
  tiles: { key: number | null; letter: string | null; picked: boolean }[];
  version: number;
  disabled?: boolean;
  onPick: (key: number) => void;
}> = ({ tiles, version, disabled, onPick }) => (
  <div className="grid grid-cols-3 gap-2.5 w-[min(78vw,19rem)]" aria-label="Your letters">
    {tiles.map((t, i) => (
      <button
        key={`${i}-${t.key ?? "x"}`}
        type="button"
        disabled={disabled || t.key === null || t.picked}
        onClick={() => t.key !== null && onPick(t.key)}
        aria-label={t.letter ? `${t.letter.toUpperCase()}, ${letterValue(t.letter)} point${letterValue(t.letter) === 1 ? "" : "s"}${t.picked ? ", in your word" : ""}` : "Empty"}
        className={`relative aspect-square rounded-[18%] transition-transform active:scale-95 ${t.key === null || t.picked ? "bg-ink/50 border border-rule/70" : ""}`}
      >
        {t.letter && !t.picked && <LetterTile key={version} letter={t.letter} className="animate-rise-in" />}
      </button>
    ))}
  </div>
);
