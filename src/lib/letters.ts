// Letterezy rules, the daily bag and scoring. Pure functions only.
//
// Rules:
// - Each day's bag holds 25 letters, the same for everyone, in a fixed order.
// - Nine are on your rack at a time. Spell a word of 3–7 letters from them;
//   the letters leave the rack and it refills from the bag.
// - A word scores its letters' points. The 4th letter scores double, and a
//   word that reaches the 5th square doubles. A 7-letter word adds a bonus.
// - When you finish, letters still on the rack or in the bag count against
//   you. Use every letter for a clean-bag bonus.
import { makeRng } from "./rng.ts";
import { VALID_WORDS, COMMON_WORDS } from "../data/words.ts";

export const BAG_SIZE = 25;
export const RACK_SIZE = 9;
export const SLOTS = 7;
export const MIN_WORD = 3;
/** 0-based square whose letter scores double. */
export const LETTER_SQUARE = 3;
/** 0-based square that doubles the whole word once a word reaches it. */
export const WORD_SQUARE = 4;
export const FULL_ROW_BONUS = 20;
export const CLEAN_BAG_BONUS = 25;
/** Hints per game: the daily has one, free play three. */
export const DAILY_HINTS = 1;
export const FREE_HINTS = 3;

/** Scrabble letter points. */
export const VALUES: Record<string, number> = {
  a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1, m: 3,
  n: 1, o: 1, p: 3, q: 10, r: 1, s: 1, t: 1, u: 1, v: 4, w: 4, x: 8, y: 4, z: 10,
};
/** The Scrabble tile mix (no blanks), which the bag is drawn from. */
const POOL = "aaaaaaaaabbccddddeeeeeeeeeeeeffggghhiiiiiiiiijkllllmmnnnnnnooooooooppqrrrrrrssssttttttuuuuvvwwxyyz";
const VOWELS = new Set(["a", "e", "i", "o", "u"]);

let validSet: Set<string> | null = null;
let validByLen: string[][] | null = null;
let commonList: string[] | null = null;
export function isWord(w: string): boolean {
  if (!validSet) validSet = new Set(VALID_WORDS.split(" "));
  return validSet.has(w.toLowerCase());
}
function valid(): string[][] {
  if (!validByLen) {
    validByLen = Array.from({ length: SLOTS + 1 }, () => [] as string[]);
    for (const w of VALID_WORDS.split(" ")) validByLen[w.length].push(w);
  }
  return validByLen;
}
function common(): string[] {
  if (!commonList) commonList = COMMON_WORDS.split(" ");
  return commonList;
}
/** Every accepted word (the hint falls back to these when no everyday word fits). */
export function validWords(): string[] {
  return valid().flat();
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface WordScore {
  score: number;
  letterBonus: boolean;
  wordBonus: boolean;
  fullRow: boolean;
}

export function wordScore(word: string): WordScore {
  const w = word.toLowerCase();
  let s = 0;
  for (let i = 0; i < w.length; i++) s += (VALUES[w[i]] ?? 0) * (i === LETTER_SQUARE ? 2 : 1);
  const wordBonus = w.length > WORD_SQUARE;
  if (wordBonus) s *= 2;
  const fullRow = w.length === SLOTS;
  if (fullRow) s += FULL_ROW_BONUS;
  return { score: s, letterBonus: w.length > LETTER_SQUARE, wordBonus, fullRow };
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export interface PlayedWord {
  /** Bag positions of the letters used, in word order. */
  tiles: number[];
  word: string;
  score: number;
}

export interface GameState {
  /** Rack squares 0–8: the bag position of the letter there, or null. */
  rack: (number | null)[];
  /** Next bag position to draw. */
  next: number;
  words: PlayedWord[];
}

export function startState(): GameState {
  return { rack: Array.from({ length: RACK_SIZE }, (_, i) => i), next: RACK_SIZE, words: [] };
}

export type PlayError = "short" | "long" | "not_a_word" | "not_on_rack";

/** Plays the word spelled by `tiles` (bag positions on the rack, in order). */
export function playWord(state: GameState, bag: string[], tiles: number[]): { state: GameState; played: PlayedWord } | { error: PlayError } {
  if (tiles.length < MIN_WORD) return { error: "short" };
  if (tiles.length > SLOTS) return { error: "long" };
  const onRack = new Set(state.rack.filter((t): t is number => t !== null));
  if (new Set(tiles).size !== tiles.length || tiles.some((t) => !onRack.has(t))) return { error: "not_on_rack" };
  const word = tiles.map((t) => bag[t]).join("");
  if (!isWord(word)) return { error: "not_a_word" };

  const used = new Set(tiles);
  const rack = state.rack.map((t) => (t !== null && used.has(t) ? null : t));
  let next = state.next;
  for (let i = 0; i < rack.length && next < bag.length; i++) {
    if (rack[i] === null) rack[i] = next++;
  }
  const played = { tiles, word, score: wordScore(word).score };
  return { state: { rack, next, words: [...state.words, played] }, played };
}

/** Rebuilds a game from the words played so far. */
export function replay(bag: string[], words: number[][]): GameState {
  let s = startState();
  for (const w of words) {
    const r = playWord(s, bag, w);
    if ("error" in r) break;
    s = r.state;
  }
  return s;
}

/** Bag positions not yet played: the rack, then what's left in the bag. */
export function remaining(state: GameState, bag: string[]): number[] {
  const out = state.rack.filter((t): t is number => t !== null);
  for (let i = state.next; i < bag.length; i++) out.push(i);
  return out;
}

export interface FinalScore {
  words: number;
  penalty: number;
  cleanBag: number;
  total: number;
  lettersUsed: number;
}

export function finalScore(state: GameState, bag: string[]): FinalScore {
  const left = remaining(state, bag);
  const words = state.words.reduce((s, w) => s + w.score, 0);
  const penalty = left.reduce((s, t) => s + VALUES[bag[t]], 0);
  const cleanBag = left.length === 0 ? CLEAN_BAG_BONUS : 0;
  return { words, penalty, cleanBag, total: words - penalty + cleanBag, lettersUsed: bag.length - left.length };
}

// ---------------------------------------------------------------------------
// Finding words on a rack
// ---------------------------------------------------------------------------

function counts(letters: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of letters) m.set(l, (m.get(l) ?? 0) + 1);
  return m;
}

function fits(word: string, avail: Map<string, number>): boolean {
  const need = new Map<string, number>();
  for (const ch of word) {
    const n = (need.get(ch) ?? 0) + 1;
    if (n > (avail.get(ch) ?? 0)) return false;
    need.set(ch, n);
  }
  return true;
}

/** Maps a word back to rack tiles (bag positions), using each tile once. */
export function tilesFor(word: string, state: GameState, bag: string[]): number[] | null {
  const pool = state.rack.filter((t): t is number => t !== null);
  const out: number[] = [];
  for (const ch of word) {
    const i = pool.findIndex((t) => bag[t] === ch);
    if (i < 0) return null;
    out.push(pool[i]);
    pool.splice(i, 1);
  }
  return out;
}

/** The best-scoring everyday word on the rack (longer wins ties), or null. */
export function bestWord(state: GameState, bag: string[], list: string[] = common()): string | null {
  const avail = counts(state.rack.filter((t): t is number => t !== null).map((t) => bag[t]));
  let best: string | null = null;
  let bestScore = -1;
  for (const w of list) {
    if (w.length > SLOTS || !fits(w, avail)) continue;
    const s = wordScore(w).score;
    if (s > bestScore || (s === bestScore && best && w.length > best.length)) {
      best = w;
      bestScore = s;
    }
  }
  return best;
}

/** Whether any accepted word can still be made from the rack. */
export function canPlay(state: GameState, bag: string[]): boolean {
  const letters = state.rack.filter((t): t is number => t !== null).map((t) => bag[t]);
  if (letters.length < MIN_WORD) return false;
  const avail = counts(letters);
  const byLen = valid();
  for (let len = MIN_WORD; len <= Math.min(SLOTS, letters.length); len++) {
    for (const w of byLen[len]) if (fits(w, avail)) return true;
  }
  return false;
}

/** Plays a bag out greedily with everyday words: the day's target score. */
export function solve(bag: string[]): { state: GameState; final: FinalScore } {
  let s = startState();
  for (;;) {
    const w = bestWord(s, bag);
    if (!w) break;
    const r = playWord(s, bag, tilesFor(w, s, bag)!);
    if ("error" in r) break;
    s = r.state;
  }
  return { state: s, final: finalScore(s, bag) };
}

// ---------------------------------------------------------------------------
// Bags
// ---------------------------------------------------------------------------

export interface Bag {
  letters: string[];
  /** What the greedy solver scores: three stars at or above this. */
  target: number;
}

const HARD = new Set(["j", "k", "q", "x", "z"]);

/** Draws a bag that plays out well: balanced vowels, few awkward letters,
 *  and the greedy solver uses nearly every letter. Same seed, same bag. */
export function makeBag(seed: string): Bag {
  for (let k = 0; ; k++) {
    const rng = makeRng(`${seed}:${k}`);
    const pool = POOL.split("");
    const letters: string[] = [];
    for (let i = 0; i < BAG_SIZE; i++) letters.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    const vowels = letters.filter((l) => VOWELS.has(l)).length;
    if (vowels < 9 || vowels > 11) continue;
    if (letters.filter((l) => HARD.has(l)).length > 2) continue;
    if (letters.includes("q") && !letters.includes("u")) continue;
    // No long dry spell: every run of 6 in bag order has a vowel.
    let dry = false;
    for (let i = 0; i + 6 <= BAG_SIZE; i++) if (!letters.slice(i, i + 6).some((l) => VOWELS.has(l))) dry = true;
    if (dry) continue;
    const firstRackVowels = letters.slice(0, RACK_SIZE).filter((l) => VOWELS.has(l)).length;
    if (firstRackVowels < 3 || firstRackVowels > 5) continue;
    const { final } = solve(letters);
    if (k < 40 && final.lettersUsed < BAG_SIZE - 3) continue;
    return { letters, target: Math.max(30, final.total) };
  }
}

export function starsFor(score: number, target: number): number {
  if (score >= target) return 3;
  if (score >= Math.round(target * 0.75)) return 2;
  if (score >= Math.round(target * 0.45)) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

const bagCache = new Map<string, Bag>();
export function dailyBag(date: string): Bag {
  const key = `letterezy:daily:${date}`;
  if (!bagCache.has(key)) bagCache.set(key, makeBag(key));
  return bagCache.get(key)!;
}
export function freeBag(seed: string): Bag {
  if (!bagCache.has(seed)) bagCache.set(seed, makeBag(seed));
  return bagCache.get(seed)!;
}

export function msUntilNextPuzzle(now: number = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
}

export const LAUNCH_DATE = "2026-10-11";
export function puzzleNumber(date: string): number {
  return Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(LAUNCH_DATE + "T00:00:00Z")) / 86400000) + 1;
}

export const FREE_SEED_PREFIX = "letterezy:free:";
export function randomFreeSeed(): string {
  return `${FREE_SEED_PREFIX}${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

export function letterValue(l: string): number {
  return VALUES[l.toLowerCase()] ?? 0;
}

/** True for each letter in `tiles` that is a vowel — used by the stuck check UI. */
export function isVowel(l: string): boolean {
  return VOWELS.has(l.toLowerCase());
}
