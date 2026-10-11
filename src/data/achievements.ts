// Achievement definitions — computed from the per-device SaveData, so
// unlocking one doesn't require an account.
import type { SaveData } from "../lib/localSave.ts";

export interface Achievement {
  id: string;
  title: string;
  description: string;
  /** lucide-react icon name, resolved by the component that renders these. */
  icon: "Star" | "Flame" | "Zap" | "Gauge" | "Target" | "Trophy";
  isUnlocked: (save: SaveData) => boolean;
  /** Shown under a locked achievement, e.g. "Best streak: 2". */
  progress?: (save: SaveData) => string;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first_day",
    title: "Bag Opened",
    description: "Finish your first daily bag.",
    icon: "Star",
    isUnlocked: (s) => s.daysPlayed >= 1,
  },
  {
    id: "three_stars",
    title: "Three Stars",
    description: "Reach the day's target score.",
    icon: "Target",
    isUnlocked: (s) => s.threeStarDays >= 1,
  },
  {
    id: "word_30",
    title: "Big Word",
    description: "Score 30 points with one word.",
    icon: "Zap",
    isUnlocked: (s) => s.bestWordScore >= 30,
    progress: (s) => `Best word: ${s.bestWordScore}`,
  },
  {
    id: "seven",
    title: "Full Row",
    description: "Play a 7-letter word.",
    icon: "Gauge",
    isUnlocked: (s) => s.sevenLetterWords >= 1,
    progress: (s) => `Longest word: ${s.longestWord} letters`,
  },
  {
    id: "clean_bag",
    title: "Clean Bag",
    description: "Use all 25 letters.",
    icon: "Trophy",
    isUnlocked: (s) => s.cleanBags >= 1,
  },
  {
    id: "streak_3",
    title: "On a Roll",
    description: "Play the daily 3 days in a row.",
    icon: "Flame",
    isUnlocked: (s) => s.maxStreak >= 3,
    progress: (s) => `Best streak: ${s.maxStreak}`,
  },
  {
    id: "streak_7",
    title: "Week Streak",
    description: "Play the daily 7 days in a row.",
    icon: "Flame",
    isUnlocked: (s) => s.maxStreak >= 7,
    progress: (s) => `Best streak: ${s.maxStreak}`,
  },
  {
    id: "dedicated_25",
    title: "Dedicated",
    description: "Play 25 daily bags.",
    icon: "Trophy",
    isUnlocked: (s) => s.daysPlayed >= 25,
    progress: (s) => `${s.daysPlayed} / 25`,
  },
];

/** Ids of achievements newly true in `save` that weren't already unlocked. */
export function diffNewlyUnlocked(save: SaveData, prevUnlockedIds: string[]): string[] {
  const prev = new Set(prevUnlockedIds);
  return ACHIEVEMENTS.filter((a) => !prev.has(a.id) && a.isUnlocked(save)).map((a) => a.id);
}
