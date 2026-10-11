// Local save for what's inherently per-device: today's game in progress, the
// free-play game, streaks and the stats achievements are computed from.
// Identity and leaderboard standing live in Supabase (lib/supabase.ts
// ensureSession + lib/leaderboard.ts).
import type { FinalScore, PlayedWord } from "./letters.ts";

const KEY = "letterezy.save.v1";

/** A game in progress or finished: the words played (as bag positions), so a
 *  reload rebuilds the exact rack. */
export interface GameProgress {
  words: number[][];
  hints: number;
  /** Set once the player finishes. */
  final: FinalScore | null;
}

export interface DailyProgress extends GameProgress {
  date: string;
}

export interface SaveData {
  lastPlayedDate: string | null;
  streak: number;
  maxStreak: number;
  daysPlayed: number;
  threeStarDays: number;
  bestDailyScore: number | null;
  bestFreeScore: number | null;
  bestWordScore: number;
  longestWord: number;
  sevenLetterWords: number;
  cleanBags: number;
  /** Free play (stub until payments exist). */
  unlockedFree: boolean;
  displayName: string | null;
  unlockedAchievements: string[];
  daily: DailyProgress | null;
  free: (GameProgress & { seed: string }) | null;
}

const DEFAULTS: SaveData = {
  lastPlayedDate: null,
  streak: 0,
  maxStreak: 0,
  daysPlayed: 0,
  threeStarDays: 0,
  bestDailyScore: null,
  bestFreeScore: null,
  bestWordScore: 0,
  longestWord: 0,
  sevenLetterWords: 0,
  cleanBags: 0,
  unlockedFree: false,
  displayName: null,
  unlockedAchievements: [],
  daily: null,
  free: null,
};

function read(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable (private mode, etc.) */
  }
}

/** Today's progress, or a fresh one if the saved day is old. */
export function dailyFor(save: SaveData, date: string): DailyProgress {
  return save.daily && save.daily.date === date ? save.daily : { date, words: [], hints: 0, final: null };
}

function wordStats(data: SaveData, played: PlayedWord) {
  data.bestWordScore = Math.max(data.bestWordScore, played.score);
  data.longestWord = Math.max(data.longestWord, played.word.length);
  if (played.word.length >= 7) data.sevenLetterWords += 1;
}

export const localSave = {
  get: read,

  dailyWord(date: string, played: PlayedWord): SaveData {
    const data = read();
    const p = dailyFor(data, date);
    p.words = [...p.words, played.tiles];
    data.daily = p;
    wordStats(data, played);
    write(data);
    return data;
  },

  dailyHint(date: string): SaveData {
    const data = read();
    const p = dailyFor(data, date);
    p.hints += 1;
    data.daily = p;
    write(data);
    return data;
  },

  /** Records the finished daily: streak, stats. Counts once per day. */
  finishDaily(date: string, final: FinalScore, threeStars: boolean): SaveData {
    const data = read();
    const p = dailyFor(data, date);
    if (p.final) return data;
    p.final = final;
    data.daily = p;
    if (data.lastPlayedDate !== date) {
      const yesterday = new Date(Date.parse(date + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
      data.streak = data.lastPlayedDate === yesterday ? data.streak + 1 : 1;
      data.lastPlayedDate = date;
      data.maxStreak = Math.max(data.maxStreak, data.streak);
      data.daysPlayed += 1;
      if (threeStars) data.threeStarDays += 1;
      data.bestDailyScore = data.bestDailyScore === null ? final.total : Math.max(data.bestDailyScore, final.total);
      if (final.cleanBag > 0) data.cleanBags += 1;
    }
    write(data);
    return data;
  },

  startFree(seed: string): SaveData {
    const data = read();
    data.free = { seed, words: [], hints: 0, final: null };
    write(data);
    return data;
  },

  freeWord(played: PlayedWord): SaveData {
    const data = read();
    if (data.free) data.free.words = [...data.free.words, played.tiles];
    wordStats(data, played);
    write(data);
    return data;
  },

  freeHint(): SaveData {
    const data = read();
    if (data.free) data.free.hints += 1;
    write(data);
    return data;
  },

  finishFree(final: FinalScore): SaveData {
    const data = read();
    if (data.free && !data.free.final) {
      data.free.final = final;
      data.bestFreeScore = data.bestFreeScore === null ? final.total : Math.max(data.bestFreeScore, final.total);
      if (final.cleanBag > 0) data.cleanBags += 1;
    }
    write(data);
    return data;
  },

  setUnlockedAchievements(ids: string[]): SaveData {
    const data = read();
    data.unlockedAchievements = ids;
    write(data);
    return data;
  },

  /** Placeholder until a real payment processor is wired up — never call
   *  this from anywhere except a confirmed, server-verified purchase. */
  setUnlocked(value: boolean): SaveData {
    const data = read();
    data.unlockedFree = value;
    write(data);
    return data;
  },
};
