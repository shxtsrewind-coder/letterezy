import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Lock, Sparkles, Flame, WifiOff, Award, Share2, Check, X, Shuffle, Lightbulb, Flag, CircleHelp, Users, Star, Infinity as InfinityIcon } from "lucide-react";
import { LetterTile, WordSlots, Rack } from "../components/LetterBoard.tsx";
import { Leaderboard } from "../components/Leaderboard.tsx";
import { AuthModal } from "../components/AuthModal.tsx";
import { Confetti } from "../components/Confetti.tsx";
import { AchievementToastStack } from "../components/AchievementToast.tsx";
import { AchievementsModal } from "../components/AchievementsModal.tsx";
import {
  bestWord,
  canPlay,
  dailyBag,
  finalScore,
  freeBag,
  isWord,
  msUntilNextPuzzle,
  playWord,
  puzzleNumber,
  randomFreeSeed,
  remaining,
  replay,
  starsFor,
  tilesFor,
  todayUtc,
  validWords,
  wordScore,
  letterValue,
  BAG_SIZE,
  CLEAN_BAG_BONUS,
  DAILY_HINTS,
  FREE_HINTS,
  FULL_ROW_BONUS,
  RACK_SIZE,
  SLOTS,
  type Bag,
  type FinalScore,
  type GameState,
  type PlayedWord,
} from "../lib/letters.ts";
import { localSave, dailyFor, type SaveData } from "../lib/localSave.ts";
import { submitScore, ensureProfile, getDailyStats, type DailyStats } from "../lib/leaderboard.ts";
import { supabase, ensureSession, currentUser, withTimeout, BOOT_STEP_MS } from "../lib/supabase.ts";
import { formatCountdown } from "../hooks/useTimer.ts";
import { ACHIEVEMENTS, diffNewlyUnlocked, type Achievement } from "../data/achievements.ts";
import { buildShareText, shareResult } from "../lib/share.ts";

type Mode = "daily" | "free";
type Phase = "auth_checking" | "choice" | "ready";

const PLAY_CHOICE_KEY = "letterezy.playChoice";
const SEEN_HELP_KEY = "letterezy.seenHelp";

const OTHER_GAMES = [
  { name: "Wordezy", url: "https://wordezy.bgameworld.com/" },
  { name: "Wordezy Search", url: "https://wordezysearch.bgameworld.com/" },
  { name: "Wordezy Scramble", url: "https://wordezyscramble.bgameworld.com/" },
  { name: "Wordezy Ladder", url: "https://wordezyladder.bgameworld.com/" },
  { name: "Mergezy", url: "https://mergezy.bgameworld.com/" },
  { name: "Sortezy", url: "https://sortezy.bgameworld.com/" },
  { name: "Lingoezy", url: "https://lingoezy.bgameworld.com/" },
  { name: "When & Where", url: "https://whenandwhere.bgameworld.com/" },
];

const Wordmark: React.FC = () => (
  <span className="flex gap-[3px] shrink-0" aria-hidden="true">
    {["L", "E", "T"].map((l) => (
      <span key={l} className="w-[18px] h-[22px] block">
        <LetterTile letter={l} size="chip" />
      </span>
    ))}
  </span>
);

const StarRow: React.FC<{ count: number; size?: string }> = ({ count, size = "w-6 h-6" }) => (
  <span className="inline-flex gap-1" aria-label={`${count} of 3 stars`}>
    {[1, 2, 3].map((i) => (
      <Star key={i} className={`${size} ${i <= count ? "text-present fill-present" : "text-faint"}`} />
    ))}
  </span>
);

const ERRORS: Record<string, (w: string) => string> = {
  short: () => "Words need at least 3 letters",
  long: () => `Words can be up to ${SLOTS} letters`,
  not_a_word: (w) => `“${w.toUpperCase()}” isn't in the word list`,
  not_on_rack: () => "Those letters aren't all on your rack",
};

/** One game's live play: the rack, the word being built, and messages. */
function useLetterGame(bag: Bag | null, words: number[][] | null) {
  const state = useMemo(() => (bag && words ? replay(bag.letters, words) : null), [bag, words]);
  const [picked, setPicked] = useState<number[]>([]);
  const [order, setOrder] = useState<number[]>(() => Array.from({ length: RACK_SIZE }, (_, i) => i));
  const [shake, setShake] = useState(0);
  const [message, setMessage] = useState<{ text: string; tone: "good" | "bad" | "info" } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setPicked([]);
    setMessage(null);
    // Only a new bag resets the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bag]);

  const say = (text: string, tone: "good" | "bad" | "info") => {
    setMessage({ text, tone });
  };
  const word = bag ? picked.map((t) => bag.letters[t]).join("") : "";
  const tiles =
    bag && state
      ? order.map((sq) => {
          const key = state.rack[sq];
          return { key, letter: key === null ? null : bag.letters[key], picked: key !== null && picked.includes(key) };
        })
      : [];

  return {
    state,
    picked,
    word,
    tiles,
    shake,
    message,
    version,
    pick: (t: number) => {
      setMessage(null);
      setPicked((p) => (p.length >= SLOTS || p.includes(t) ? p : [...p, t]));
    },
    removeAt: (i: number) => {
      setMessage(null);
      setPicked((p) => p.filter((_, k) => k !== i));
    },
    pop: () => {
      setMessage(null);
      setPicked((p) => p.slice(0, -1));
    },
    clear: () => {
      setMessage(null);
      setPicked([]);
    },
    setPicked,
    shuffle: () => {
      setOrder((o) => {
        const a = o.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      });
      setVersion((v) => v + 1);
    },
    /** Tries the word; returns the played word or null (after showing why). */
    submit: (): { state: GameState; played: PlayedWord } | null => {
      if (!bag || !state) return null;
      const r = playWord(state, bag.letters, picked);
      if ("error" in r) {
        say(ERRORS[r.error](word), "bad");
        setShake((s) => s + 1);
        return null;
      }
      const ws = wordScore(r.played.word);
      const notes = [ws.wordBonus ? "2× word" : "", ws.fullRow ? `+${FULL_ROW_BONUS} full row` : ""].filter(Boolean).join(" · ");
      say(`${r.played.word.toUpperCase()} +${r.played.score}${notes ? ` (${notes})` : ""}`, "good");
      setPicked([]);
      setVersion((v) => v + 1);
      return r;
    },
    say,
  };
}

export const GamePage: React.FC = () => {
  const [phase, setPhase] = useState<Phase>("auth_checking");
  // Sign-in couldn't be reached: the game plays, the leaderboard waits.
  const [offline, setOffline] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("Player");
  const [hasProfile, setHasProfile] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  const [mode, setMode] = useState<Mode>("daily");
  const [save, setSave] = useState(() => localSave.get());
  const [today] = useState(() => todayUtc());
  const bag = useMemo(() => dailyBag(today), [today]);
  const progress = dailyFor(save, today);
  const daily = useLetterGame(bag, progress.words);
  const fBag = useMemo(() => (save.free ? freeBag(save.free.seed) : null), [save.free?.seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const free = useLetterGame(fBag, save.free?.words ?? null);

  const [stats, setStats] = useState<DailyStats | null>(null);
  const [leaderboardKey, setLeaderboardKey] = useState(0);
  const [scoreStatus, setScoreStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [showAchievements, setShowAchievements] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState<Mode | null>(null);
  const [newlyUnlocked, setNewlyUnlocked] = useState<Achievement[] | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "shared" | "copied" | "failed">("idle");

  const refreshStats = useCallback(() => {
    getDailyStats(today).then(setStats).catch(() => setStats(null));
  }, [today]);

  const unlockAchievements = useCallback((updated: SaveData) => {
    const prev = updated.unlockedAchievements;
    const newIds = diffNewlyUnlocked(updated, prev);
    if (newIds.length === 0) return updated;
    setNewlyUnlocked(ACHIEVEMENTS.filter((a) => newIds.includes(a.id)));
    return localSave.setUnlockedAchievements([...prev, ...newIds]);
  }, []);

  const submitDaily = useCallback(
    (final: FinalScore, words: number) => {
      setScoreStatus("saving");
      submitScore({ puzzleDate: today, score: final.total, words, lettersUsed: final.lettersUsed, target: bag.target })
        .then(() => {
          setScoreStatus("saved");
          setLeaderboardKey((k) => k + 1);
          refreshStats();
        })
        .catch(() => setScoreStatus("failed"));
    },
    [today, bag.target, refreshStats]
  );

  const resubmitToday = useCallback(() => {
    const p = dailyFor(localSave.get(), todayUtc());
    if (p.final) submitDaily(p.final, p.words.length);
  }, [submitDaily]);

  /** `quiet` retries in the background (the Retry link, coming back online)
   *  without swapping the game out for the loading screen. */
  const bootAuth = useCallback(async (quiet = false) => {
    if (!quiet) setPhase("auth_checking");
    try {
      const session = await ensureSession();
      if (!session.ok) {
        // Offline, blocked or down. The puzzle doesn't need the server, so
        // play locally; scores sync once a later retry gets through.
        setOffline(true);
        setPhase("ready");
        return;
      }
      setOffline(false);
      const user = await currentUser();
      const anon = user?.is_anonymous ?? true;
      setUserId(user?.id ?? null);
      const name = await withTimeout(ensureProfile(), BOOT_STEP_MS, null);
      if (name) {
        setDisplayName(name);
        setHasProfile(true);
        // A finish from earlier today that never reached the server gets
        // another try. Only the first finish ever counts.
        resubmitToday();
      }
      refreshStats();
      const choiceDone = typeof window !== "undefined" && sessionStorage.getItem(PLAY_CHOICE_KEY) === "true";
      setPhase(!anon || choiceDone || name || quiet ? "ready" : "choice");
    } catch (err) {
      console.error("Failed to establish session:", err);
      setOffline(true);
      setPhase("ready");
    }
  }, [refreshStats, resubmitToday]);

  useEffect(() => {
    bootAuth();
  }, [bootAuth]);

  useEffect(() => {
    if (!offline) return;
    const retry = () => bootAuth(true);
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [offline, bootAuth]);

  // First visit: show how to play once the game is on screen.
  useEffect(() => {
    if (phase !== "ready") return;
    try {
      if (!localStorage.getItem(SEEN_HELP_KEY)) {
        localStorage.setItem(SEEN_HELP_KEY, "1");
        setShowHelp(true);
      }
    } catch {
      /* storage blocked — skip the auto help */
    }
  }, [phase]);

  const handleAuthResolved = useCallback(
    (opts: { isAnonymous: boolean; displayName?: string }) => {
      if (typeof window !== "undefined") sessionStorage.setItem(PLAY_CHOICE_KEY, "true");
      setShowAuth(false);
      setPhase("ready");
      if (!opts.displayName && opts.isAnonymous) return;
      if (opts.displayName) setDisplayName(opts.displayName);
      setHasProfile(true);
      supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
      resubmitToday();
    },
    [resubmitToday]
  );

  // ---- Playing -----------------------------------------------------------

  const game = mode === "daily" ? daily : free;
  const activeBag = mode === "daily" ? bag : fBag;
  const activeProgress = mode === "daily" ? progress : save.free;
  const finished = !!activeProgress?.final;
  const hintsAllowed = mode === "daily" ? DAILY_HINTS : FREE_HINTS;
  const hintsLeft = Math.max(0, hintsAllowed - (activeProgress?.hints ?? 0));
  const lettersLeft = game.state && activeBag ? remaining(game.state, activeBag.letters).length : 0;
  const stuck = !!game.state && !!activeBag && !finished && lettersLeft > 0 && !canPlay(game.state, activeBag.letters);
  const live = game.state && activeBag ? game.state.words.reduce((s, w) => s + w.score, 0) : 0;

  const finishGame = useCallback(
    (m: Mode) => {
      setConfirmFinish(null);
      if (m === "daily") {
        const s = replay(bag.letters, dailyFor(localSave.get(), today).words);
        const final = finalScore(s, bag.letters);
        const updated = unlockAchievements(localSave.finishDaily(today, final, final.total >= bag.target));
        setSave(updated);
        if (final.total >= bag.target) {
          setShowConfetti(true);
          setTimeout(() => setShowConfetti(false), 1800);
        }
        if (hasProfile) submitDaily(final, s.words.length);
      } else {
        const f = localSave.get().free;
        if (!f) return;
        const fb = freeBag(f.seed);
        const final = finalScore(replay(fb.letters, f.words), fb.letters);
        setSave(unlockAchievements(localSave.finishFree(final)));
      }
    },
    [bag, today, hasProfile, submitDaily, unlockAchievements]
  );

  const submitWord = () => {
    if (finished || !activeBag) return;
    const r = game.submit();
    if (!r) return;
    const updated = unlockAchievements(mode === "daily" ? localSave.dailyWord(today, r.played) : localSave.freeWord(r.played));
    setSave(updated);
    if (remaining(r.state, activeBag.letters).length === 0) finishGame(mode);
  };

  const useHint = () => {
    if (finished || !game.state || !activeBag) return;
    if (hintsLeft <= 0) {
      game.say("No hints left in this game", "info");
      return;
    }
    const w = bestWord(game.state, activeBag.letters) ?? bestWord(game.state, activeBag.letters, validWords());
    if (!w) {
      game.say("No words left on this rack — finish to see your score", "info");
      return;
    }
    game.setPicked(tilesFor(w, game.state, activeBag.letters) ?? []);
    game.say(`Hint: ${w.toUpperCase()} is worth ${wordScore(w).score}`, "info");
    setSave(mode === "daily" ? localSave.dailyHint(today) : localSave.freeHint());
  };

  // Typing on a keyboard: letters pick tiles, Backspace, Enter, Escape.
  useEffect(() => {
    if (phase !== "ready") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || showAuth || showHelp || showAchievements || confirmFinish) return;
      if (finished || !game.state || !activeBag) return;
      const k = e.key.toLowerCase();
      if (k === "enter") {
        e.preventDefault();
        submitWord();
      } else if (k === "backspace") {
        game.pop();
      } else if (k === "escape") {
        game.clear();
      } else if (/^[a-z]$/.test(k)) {
        const t = game.tiles.find((x) => x.key !== null && !x.picked && x.letter === k);
        if (t && t.key !== null) game.pick(t.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const handleShare = async () => {
    if (!progress.final) return;
    const s = replay(bag.letters, progress.words);
    const text = buildShareText({
      date: today,
      score: progress.final.total,
      stars: starsFor(progress.final.total, bag.target),
      lettersUsed: progress.final.lettersUsed,
      words: s.words.map((w) => ({ length: w.word.length, score: w.score })),
    });
    const result = await shareResult(text);
    setShareState(result);
    setTimeout(() => setShareState("idle"), 2200);
  };

  const handleUnlock = () => {
    // Stub — no payment processor wired up yet. Replace with a real
    // server-verified purchase flow before this ever ships.
    alert("Payments aren't set up yet — free play will unlock for $2 once that's wired in.");
  };

  // ---- Screens -------------------------------------------------------------

  if (phase === "auth_checking") {
    return (
      <div className="min-h-screen bg-ink text-paper flex items-center justify-center">
        <Wordmark />
      </div>
    );
  }
  if (phase === "choice") {
    return <AuthModal currentDisplayName={displayName} onResolved={handleAuthResolved} />;
  }

  const modalOpen = showAuth || showAchievements || showHelp || confirmFinish !== null;
  const target = mode === "daily" ? bag.target : (fBag?.target ?? 100);
  const validNow = game.word.length >= 3 && isWord(game.word);
  const penaltyNow = game.state && activeBag ? remaining(game.state, activeBag.letters).reduce((s, t) => s + letterValue(activeBag.letters[t]), 0) : 0;

  const statsLine = stats && stats.players > 0 && (
    <p className="text-xs font-mono text-muted flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5" aria-label="Today's players">
      <span className="inline-flex items-center gap-1.5">
        <Users className="w-3.5 h-3.5" />
        {stats.players} player{stats.players === 1 ? "" : "s"} today
      </span>
      <span>· avg {stats.average}</span>
      <span>· best {stats.best}</span>
    </p>
  );

  const board = game.state && activeBag && (
    <>
      <div className="w-full max-w-[26rem] grid grid-cols-[1fr_auto_auto_1.2fr] items-stretch gap-2">
        <div className="rounded-xl border border-rule bg-surface px-3 py-1.5 flex flex-col justify-center" aria-label="Letters left">
          <span className="text-[10px] font-mono uppercase tracking-wide text-muted leading-tight">Letters</span>
          <span className="font-sans font-extrabold text-xl tabular-nums leading-tight">{lettersLeft}</span>
        </div>
        <button
          type="button"
          onClick={useHint}
          disabled={modalOpen}
          aria-label={`Hint, ${hintsLeft} left`}
          className="relative w-12 rounded-xl border border-present-dim/60 bg-present-soft text-present flex items-center justify-center hover:border-present transition-colors"
        >
          <Lightbulb className="w-5 h-5" />
          <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-ink border border-present-dim/60 text-[11px] font-mono flex items-center justify-center">{hintsLeft}</span>
        </button>
        <button
          type="button"
          onClick={() => setConfirmFinish(mode)}
          disabled={modalOpen}
          aria-label="Finish"
          className="w-12 rounded-xl border border-danger/60 bg-danger-soft text-danger flex items-center justify-center hover:border-danger transition-colors"
        >
          <Flag className="w-5 h-5" />
        </button>
        <div className="rounded-xl border border-rule bg-surface px-3 pt-1.5 pb-2 flex flex-col justify-center" aria-label="Score">
          <span className="text-[10px] font-mono uppercase tracking-wide text-muted leading-tight">Score</span>
          <span className="font-sans font-extrabold text-xl tabular-nums leading-tight">{live}</span>
          <div className="relative h-1.5 rounded-full bg-ink mt-1 overflow-hidden" aria-hidden="true">
            <div className="absolute inset-y-0 left-0 bg-correct rounded-full transition-all" style={{ width: `${Math.min(100, (live / target) * 100)}%` }} />
            {[0.45, 0.75].map((f) => (
              <span key={f} className="absolute inset-y-0 w-px bg-paper/30" style={{ left: `${f * 100}%` }} />
            ))}
          </div>
        </div>
      </div>

      <WordSlots letters={game.word.split("")} shake={game.shake} flash={false} onRemove={game.removeAt} disabled={modalOpen} />

      <div className="h-6 flex items-center justify-center text-sm" role="status" aria-live="polite">
        {game.message ? (
          <span className={`font-mono ${game.message.tone === "good" ? "text-correct" : game.message.tone === "bad" ? "text-danger" : "text-present"}`}>{game.message.text}</span>
        ) : game.word.length > 0 ? (
          validNow ? (
            <span className="font-mono text-correct">
              {game.word.toUpperCase()} · {wordScore(game.word).score} pts
            </span>
          ) : (
            <span className="font-mono text-muted">{game.word.toUpperCase()}</span>
          )
        ) : (
          <span className="font-mono text-muted text-xs uppercase tracking-wide">Spell a word (3+ letters)</span>
        )}
      </div>

      <Rack tiles={game.tiles} version={game.version} disabled={modalOpen} onPick={game.pick} />

      <div className="grid grid-cols-3 gap-2.5 w-[min(78vw,19rem)]">
        <button type="button" onClick={game.clear} disabled={modalOpen || game.picked.length === 0} aria-label="Clear" className="h-12 rounded-xl bg-danger/90 hover:bg-danger text-white flex items-center justify-center transition-colors disabled:opacity-40">
          <X className="w-6 h-6" />
        </button>
        <button type="button" onClick={game.shuffle} disabled={modalOpen} aria-label="Shuffle" className="h-12 rounded-xl bg-present hover:bg-present-dim text-ink flex items-center justify-center transition-colors">
          <Shuffle className="w-6 h-6" />
        </button>
        <button type="button" onClick={submitWord} disabled={modalOpen || game.picked.length < 3} aria-label="Play word" className="h-12 rounded-xl bg-correct hover:bg-correct-dim text-white flex items-center justify-center transition-colors disabled:opacity-40">
          <Check className="w-6 h-6" />
        </button>
      </div>

      {stuck && (
        <div className="w-full max-w-[26rem] rounded-xl border border-present-dim/50 bg-present-soft px-4 py-3 text-sm text-center space-y-2" role="status">
          <p className="text-present">No more words can be made from this rack.</p>
          <button type="button" onClick={() => finishGame(mode)} className="px-4 py-1.5 rounded-md bg-correct hover:bg-correct-dim text-white text-sm font-medium">
            Finish and see your score
          </button>
        </div>
      )}

      <PlayedList words={game.state.words} />
    </>
  );

  return (
    <div className="min-h-screen bg-ink text-paper flex flex-col items-center px-4 py-6 gap-4">
      <header className="w-full max-w-xl flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Wordmark />
          <h1 className="font-display font-semibold text-lg truncate">Letterezy</h1>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {save.streak > 0 && (
            <div className="flex items-center gap-1 text-sm text-present font-mono" title="Daily streak">
              <Flame className="w-4 h-4" />
              {save.streak}
            </div>
          )}
          <button type="button" onClick={() => setShowHelp(true)} className="text-muted hover:text-paper transition-colors" aria-label="How to play">
            <CircleHelp className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => setShowAchievements(true)}
            className="flex items-center gap-1.5 text-sm text-muted hover:text-paper transition-colors"
            aria-label="Achievements"
          >
            <Award className="w-4 h-4" />
            {save.unlockedAchievements.length}/{ACHIEVEMENTS.length}
          </button>
        </div>
      </header>

      {showConfetti && <Confetti durationMs={1800} />}
      {newlyUnlocked && newlyUnlocked.length > 0 && <AchievementToastStack achievements={newlyUnlocked} onDone={() => setNewlyUnlocked(null)} />}
      {showAchievements && <AchievementsModal save={save} onClose={() => setShowAchievements(false)} />}
      {showAuth && <AuthModal currentDisplayName={displayName} onResolved={handleAuthResolved} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {confirmFinish && (
        <ConfirmFinish lettersLeft={lettersLeft} penalty={penaltyNow} onCancel={() => setConfirmFinish(null)} onConfirm={() => finishGame(confirmFinish)} />
      )}

      <div className="flex items-center gap-1 p-1 bg-surface border border-rule rounded-lg">
        {(["daily", "free"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === m ? "bg-correct text-white" : "text-muted hover:text-white"}`}
          >
            {m === "daily" ? `Daily No. ${puzzleNumber(today)}` : "Free play"}
            {m === "free" && !save.unlockedFree && <Lock className="w-3.5 h-3.5" />}
          </button>
        ))}
      </div>

      <main className="w-full max-w-xl flex flex-col items-center gap-4">
        {offline && (
          <div role="status" className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-rule bg-surface text-xs text-muted">
            <WifiOff className="w-4 h-4 shrink-0 text-present" aria-hidden="true" />
            <span className="flex-1">Playing offline. Your game saves on this device; the leaderboard comes back when you reconnect.</span>
            <button type="button" onClick={() => bootAuth(true)} className="shrink-0 font-medium text-paper underline underline-offset-2">
              Retry
            </button>
          </div>
        )}
        {mode === "daily" && !progress.final && (
          <>
            <p className="text-xs font-mono text-muted text-center -mb-1">
              Target <span className="text-paper">{bag.target}</span> for three stars · everyone has the same bag today
            </p>
            {board}
            {statsLine}
          </>
        )}

        {mode === "daily" && progress.final && (
          <>
            <Result
              title={`Letterezy No. ${puzzleNumber(today)}`}
              final={progress.final}
              target={bag.target}
              state={replay(bag.letters, progress.words)}
              bag={bag}
              streak={save.streak}
              footer={
                <>
                  <button type="button" onClick={handleShare} className="inline-flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-correct hover:bg-correct-dim text-white font-medium text-sm transition-colors">
                    {shareState === "copied" ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                    {shareState === "copied" ? "Copied — paste it anywhere" : shareState === "failed" ? "Couldn't copy — try again" : "Share result"}
                  </button>
                  <button type="button" onClick={() => setMode("free")} className="w-full py-2 rounded-lg border border-rule text-sm text-paper/90 hover:border-muted/60 transition-colors">
                    Keep playing — Free play
                  </button>
                  <DailyFooter hasProfile={hasProfile} scoreStatus={scoreStatus} onJoin={() => setShowAuth(true)} statsLine={statsLine} />
                </>
              }
            />
            <Leaderboard date={today} target={bag.target} currentPlayerId={userId} refreshKey={leaderboardKey} />
          </>
        )}

        {mode === "free" && !save.unlockedFree && (
          <section className="w-full max-w-sm bg-surface border border-rule rounded-xl p-6 text-center space-y-4 mt-2">
            <div className="w-12 h-12 rounded-full bg-present-soft border border-present-dim/50 flex items-center justify-center text-present mx-auto">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-display font-semibold text-lg">Free play</h2>
              <p className="text-sm text-muted mt-1.5">A fresh bag of 25 letters whenever you like, with three hints a game. The daily stays free forever.</p>
            </div>
            <button type="button" onClick={handleUnlock} className="w-full py-2.5 px-4 rounded-md bg-correct hover:bg-correct-dim text-white font-medium text-sm transition-colors">
              Unlock free play for $2
            </button>
          </section>
        )}

        {mode === "free" && save.unlockedFree && (!save.free || save.free.final) && (
          save.free?.final && fBag ? (
            <Result
              title="Free play"
              final={save.free.final}
              target={fBag.target}
              state={replay(fBag.letters, save.free.words)}
              bag={fBag}
              streak={0}
              footer={
                <button type="button" onClick={() => setSave(localSave.startFree(randomFreeSeed()))} className="inline-flex items-center justify-center gap-2 w-full py-3 rounded-lg bg-correct hover:bg-correct-dim text-white font-medium transition-colors">
                  <InfinityIcon className="w-4 h-4" />
                  New bag
                </button>
              }
            />
          ) : (
            <section className="w-full bg-surface border border-rule rounded-xl p-6 text-center space-y-4 animate-rise-in">
              <h2 className="font-display font-semibold text-xl">Free play</h2>
              <p className="text-sm text-muted">A fresh bag of 25 letters every game.{save.bestFreeScore !== null ? ` Your best: ${save.bestFreeScore}.` : ""}</p>
              <button type="button" onClick={() => setSave(localSave.startFree(randomFreeSeed()))} className="inline-flex items-center justify-center gap-2 w-full max-w-xs py-3 rounded-lg bg-correct hover:bg-correct-dim text-white font-medium transition-colors">
                <InfinityIcon className="w-4 h-4" />
                Open a bag
              </button>
            </section>
          )
        )}

        {mode === "free" && save.unlockedFree && save.free && !save.free.final && (
          <>
            <p className="text-xs font-mono text-muted text-center -mb-1">
              Target <span className="text-paper">{fBag?.target}</span> for three stars
            </p>
            {board}
          </>
        )}
      </main>

      <footer className="w-full max-w-xl mt-auto pt-6 border-t border-rule/60 text-center space-y-2">
        <p className="text-xs text-muted">More free games on bgameworld</p>
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm">
          {OTHER_GAMES.map((g) => (
            <a key={g.url} href={g.url} className="text-paper/80 hover:text-correct transition-colors">
              {g.name}
            </a>
          ))}
          <a href="https://bgameworld.com/" className="text-muted hover:text-paper transition-colors">
            All games
          </a>
        </nav>
      </footer>
    </div>
  );
};

const PlayedList: React.FC<{ words: PlayedWord[] }> = ({ words }) =>
  words.length === 0 ? null : (
    <ul className="w-full max-w-[26rem] flex flex-wrap justify-center gap-1.5" aria-label="Words played">
      {words.map((w, i) => (
        <li key={i} className="px-2 py-1 rounded-md bg-surface border border-rule font-mono text-xs">
          {w.word.toUpperCase()} <span className="text-correct">{w.score}</span>
        </li>
      ))}
    </ul>
  );

const Rules: React.FC = () => (
  <ul className="text-sm text-paper/80 space-y-2.5 text-left">
    <li>
      Today's bag holds <b className="text-paper">{BAG_SIZE} letters</b>, the same for everyone. {RACK_SIZE} are on your rack at a time.
    </li>
    <li>Tap letters (or type) to spell a word of 3 to {SLOTS} letters, then press ✓. Your rack refills from the bag.</li>
    <li>
      Each letter scores its points. The <b className="text-present">4th letter scores double</b>, and a word that reaches the{" "}
      <b className="text-correct">5th square doubles</b>. Seven letters add +{FULL_ROW_BONUS}.
    </li>
    <li>
      Finish with the flag. Letters you didn't use <b className="text-danger">count against you</b>; use all {BAG_SIZE} for +{CLEAN_BAG_BONUS}.
    </li>
    <li>One hint a day shows a good word on your rack.</li>
  </ul>
);

const HelpModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div role="dialog" aria-modal="true" aria-label="How to play" className="fixed inset-0 z-50 bg-white/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
    <div className="w-full max-w-md bg-surface border border-rule rounded-2xl p-6 space-y-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-lg">How to play</h2>
        <button type="button" onClick={onClose} className="text-muted hover:text-paper transition-colors" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>
      <Rules />
      <button type="button" onClick={onClose} className="w-full py-2.5 rounded-lg bg-correct hover:bg-correct-dim text-white font-medium text-sm transition-colors">
        Let's play
      </button>
    </div>
  </div>
);

const ConfirmFinish: React.FC<{ lettersLeft: number; penalty: number; onCancel: () => void; onConfirm: () => void }> = ({ lettersLeft, penalty, onCancel, onConfirm }) => (
  <div role="dialog" aria-modal="true" aria-label="Finish" className="fixed inset-0 z-50 bg-white/75 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
    <div className="w-full max-w-sm bg-surface border border-rule rounded-2xl p-6 space-y-4 text-center" onClick={(e) => e.stopPropagation()}>
      <h2 className="font-display font-semibold text-lg">Finish now?</h2>
      <p className="text-sm text-muted">
        {lettersLeft > 0 ? (
          <>
            You have {lettersLeft} letter{lettersLeft === 1 ? "" : "s"} left. They'll cost you <span className="text-danger font-mono">−{penalty}</span> points.
          </>
        ) : (
          "Every letter is used."
        )}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="py-2.5 rounded-lg border border-rule text-sm text-paper/90 hover:border-muted/60 transition-colors">
          Keep playing
        </button>
        <button type="button" onClick={onConfirm} className="py-2.5 rounded-lg bg-correct hover:bg-correct-dim text-white font-medium text-sm transition-colors">
          Finish
        </button>
      </div>
    </div>
  </div>
);

const Result: React.FC<{
  title: string;
  final: FinalScore;
  target: number;
  state: GameState;
  bag: Bag;
  streak: number;
  footer: React.ReactNode;
}> = ({ title, final, target, state, bag, streak, footer }) => {
  const stars = starsFor(final.total, target);
  const left = remaining(state, bag.letters);
  return (
    <section className="w-full bg-surface border border-rule rounded-xl p-6 space-y-5 animate-rise-in">
      <div className="text-center space-y-2">
        <p className="text-xs font-mono text-muted uppercase tracking-wide">{title}</p>
        <StarRow count={stars} size="w-8 h-8" />
        <p className="font-sans font-extrabold text-5xl text-correct tabular-nums">{final.total}</p>
        <p className="text-xs text-muted">
          Target {target} · {final.lettersUsed}/{BAG_SIZE} letters used{streak > 1 ? ` · ${streak}-day streak` : ""}
        </p>
      </div>
      <dl className="max-w-xs mx-auto text-sm font-mono space-y-1">
        <div className="flex justify-between">
          <dt className="text-muted">{state.words.length} word{state.words.length === 1 ? "" : "s"}</dt>
          <dd>+{final.words}</dd>
        </div>
        {final.penalty > 0 && (
          <div className="flex justify-between">
            <dt className="text-muted">
              Left over: {left.map((t) => bag.letters[t].toUpperCase()).join(" ")}
            </dt>
            <dd className="text-danger">−{final.penalty}</dd>
          </div>
        )}
        {final.cleanBag > 0 && (
          <div className="flex justify-between">
            <dt className="text-muted">Clean bag</dt>
            <dd className="text-correct">+{final.cleanBag}</dd>
          </div>
        )}
      </dl>
      <PlayedList words={state.words} />
      {footer}
    </section>
  );
};

const DailyFooter: React.FC<{ hasProfile: boolean; scoreStatus: "idle" | "saving" | "saved" | "failed"; onJoin: () => void; statsLine: React.ReactNode }> = ({
  hasProfile,
  scoreStatus,
  onJoin,
  statsLine,
}) => {
  const [countdown, setCountdown] = useState(() => msUntilNextPuzzle());
  useEffect(() => {
    const id = setInterval(() => setCountdown(msUntilNextPuzzle()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="text-center space-y-1.5">
      {statsLine}
      <p className="text-xs font-mono text-muted">Next bag in {formatCountdown(countdown)}</p>
      {!hasProfile ? (
        <button type="button" onClick={onJoin} className="text-xs text-correct hover:underline">
          Create a free account to put today's score on the leaderboard
        </button>
      ) : scoreStatus === "failed" ? (
        <p className="text-xs text-muted">Saved on this device — the leaderboard couldn't be reached.</p>
      ) : null}
    </div>
  );
};
