import { puzzleNumber } from "./letters.ts";

export const GAME_URL = "https://letterezy.bgameworld.com/";

/** Spoiler-free result: stars, score, and one row of squares per word
 *  (its length) with its points — never the words themselves. */
export function buildShareText(opts: { date: string; score: number; stars: number; lettersUsed: number; words: { length: number; score: number }[] }): string {
  const stars = "⭐".repeat(opts.stars) + "☆".repeat(3 - opts.stars);
  const rows = opts.words.map((w) => `${(w.length >= 7 ? "🟩" : w.length >= 5 ? "🟨" : "⬜").repeat(w.length)} ${w.score}`).join("\n");
  return (
    `Letterezy #${puzzleNumber(opts.date)} ${stars}\n` +
    `🔤 ${opts.score} points · ${opts.lettersUsed}/25 letters\n` +
    (rows ? rows + "\n" : "") +
    GAME_URL
  );
}

/** Opens the native share sheet where there is one (phones), otherwise
 *  copies to the clipboard. Resolves to what happened, for the button label. */
export async function shareResult(text: string): Promise<"shared" | "copied" | "failed"> {
  try {
    if (typeof navigator !== "undefined" && navigator.share && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      await navigator.share({ text });
      return "shared";
    }
  } catch (err) {
    // The player closing the share sheet isn't a failure worth reporting.
    if ((err as { name?: string })?.name === "AbortError") return "shared";
  }
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
