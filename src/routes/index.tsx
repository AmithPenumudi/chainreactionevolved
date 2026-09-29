import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { HomeScreen } from "@/components/game/HomeScreen";
import { SetupScreen, MatchConfig } from "@/components/game/SetupScreen";
import { GameScreen } from "@/components/game/GameScreen";
import { SettingsScreen } from "@/components/game/SettingsScreen";
import { SettingsProvider } from "@/components/game/SettingsProvider";
import { ProfileProvider } from "@/components/game/ProfileProvider";
import { ProfileScreen } from "@/components/game/ProfileScreen";
import { HowToPlayScreen } from "@/components/game/HowToPlayScreen";
import { ChallengeProvider } from "@/components/game/ChallengeProvider";
import { ChallengesScreen } from "@/components/game/ChallengesScreen";
import { PuzzlesScreen } from "@/components/game/PuzzlesScreen";
import { PuzzleGame } from "@/components/game/PuzzleGame";
import { PUZZLE_ORDER, type PuzzleDef } from "@/game/puzzles";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Chain Reaction: Evolved — Grid Strategy Game" },
      {
        name: "description",
        content:
          "Chain Reaction is a fast-paced multiplayer strategy game where every move can trigger an explosive chain reaction. Place orbs, capture opponents, and take contr",
      },
      { property: "og:title", content: "Chain Reaction: Evolved — Grid Strategy Game" },
      {
        property: "og:description",
        content:
          "Chain Reaction is a fast-paced multiplayer strategy game where every move can trigger an explosive chain reaction. Place orbs, capture opponents, and take contr",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type View =
  | { kind: "home" }
  | { kind: "setup" }
  | { kind: "settings" }
  | { kind: "profile" }
  | { kind: "howto" }
  | { kind: "challenges" }
  | { kind: "puzzles" }
  | { kind: "puzzle"; puzzle: PuzzleDef }
  | { kind: "game"; config: MatchConfig; nonce: number };

function Index() {
  return (
    <SettingsProvider>
      <ProfileProvider>
        <ChallengeProvider>
          <Screens />
        </ChallengeProvider>
      </ProfileProvider>
    </SettingsProvider>
  );
}

function Screens() {
  const [view, setViewState] = useState<View>({ kind: "home" });
  // The screens the user has walked through, bottom = Home. Each history entry records its
  // own depth, so the Android hardware Back button (and browser Back) returns to the screen
  // that was actually open before, instead of closing the app.
  const stack = useRef<View[]>([{ kind: "home" }]);

  const setView = useCallback((next: View) => {
    const s = stack.current;
    const top = s.length - 1;
    if (next.kind === s[top].kind) {
      // Same screen (e.g. rematch, next puzzle): replace rather than stack.
      s[top] = next;
      window.history.replaceState({ cr: top }, "");
      setViewState(next);
      return;
    }
    // Navigating to a screen already in the stack (Home, Puzzles list…) unwinds to it.
    for (let j = top - 1; j >= 0; j--) {
      if (s[j].kind === next.kind) {
        s[j] = next;
        window.history.go(-(top - j)); // the popstate handler shows it
        return;
      }
    }
    s.push(next);
    window.history.pushState({ cr: top + 1 }, "");
    setViewState(next);
  }, []);

  useEffect(() => {
    const onPop = () => {
      const depth = Math.min(
        Math.max(0, Number(window.history.state?.cr ?? 0)),
        stack.current.length - 1,
      );
      stack.current.length = depth + 1;
      setViewState(stack.current[depth]);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // A new screen always starts at the top (the previous screen's scroll offset carries over).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view.kind]);

  if (view.kind === "home") {
    return (
      <HomeScreen
        onQuickPlay={() => setView({ kind: "setup" })}
        onSettings={() => setView({ kind: "settings" })}
        onProfile={() => setView({ kind: "profile" })}
        onHowToPlay={() => setView({ kind: "howto" })}
        onChallenges={() => setView({ kind: "challenges" })}
        onPuzzles={() => setView({ kind: "puzzles" })}
      />
    );
  }
  if (view.kind === "puzzles") {
    return (
      <PuzzlesScreen
        onBack={() => setView({ kind: "home" })}
        onPlay={(puzzle) => setView({ kind: "puzzle", puzzle })}
      />
    );
  }
  if (view.kind === "puzzle") {
    const i = PUZZLE_ORDER.findIndex((p) => p.id === view.puzzle.id);
    const next = i >= 0 ? PUZZLE_ORDER[i + 1] : undefined;
    return (
      <PuzzleGame
        key={view.puzzle.id}
        puzzle={view.puzzle}
        onBack={() => setView({ kind: "puzzles" })}
        onNext={next ? () => setView({ kind: "puzzle", puzzle: next }) : undefined}
      />
    );
  }
  if (view.kind === "challenges") {
    return (
      <ChallengesScreen
        onBack={() => setView({ kind: "home" })}
        onPuzzles={() => setView({ kind: "puzzles" })}
      />
    );
  }

  if (view.kind === "howto") {
    return <HowToPlayScreen onBack={() => setView({ kind: "home" })} />;
  }
  if (view.kind === "profile") {
    return <ProfileScreen onBack={() => setView({ kind: "home" })} />;
  }
  if (view.kind === "settings") {
    return <SettingsScreen onBack={() => setView({ kind: "home" })} />;
  }
  if (view.kind === "setup") {
    return (
      <SetupScreen
        onBack={() => setView({ kind: "home" })}
        onStart={(config) => setView({ kind: "game", config, nonce: Date.now() })}
      />
    );
  }
  return (
    <GameScreen
      key={view.nonce}
      config={view.config}
      onExit={() => setView({ kind: "home" })}
      onRematch={() => setView({ kind: "game", config: view.config, nonce: Date.now() })}
    />
  );
}
