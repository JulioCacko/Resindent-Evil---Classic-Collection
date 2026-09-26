import { useState, useEffect, useCallback, useRef, startTransition } from "react";
import { useNavigate, useParams } from "react-router";

// RE1 versions
import MainMenuRe1 from "../../imports/MainMenuRe1";
import MainMenuRe4 from "../../imports/MainMenuRe4";

// RE2 versions
import MainMenuRe2 from "../../imports/MainMenuRe2";
import MainMenuRe5 from "../../imports/MainMenuRe5";

// RE3 versions
import MainMenuRe3 from "../../imports/MainMenuRe3";
import MainMenuRe6 from "../../imports/MainMenuRe6";

type GameId = "re1" | "re2" | "re3";

const versionScreens: Record<GameId, React.ComponentType[]> = {
  re1: [MainMenuRe1, MainMenuRe4],
  re2: [MainMenuRe2, MainMenuRe5],
  re3: [MainMenuRe3, MainMenuRe6],
};

const versionCounts: Record<GameId, number> = {
  re1: 3,
  re2: 3,
  re3: 2,
};

export default function VersionSelectPage() {
  const { game } = useParams<{ game: string }>();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const gameId = (game as GameId) || "re1";
  const screens = versionScreens[gameId] || versionScreens.re1;
  const totalVersions = versionCounts[gameId] || screens.length;
  const [versionIndex, setVersionIndex] = useState(0);

  const handleNav = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        startTransition(() => setVersionIndex((i) => (i - 1 + totalVersions) % totalVersions));
      }
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        startTransition(() => setVersionIndex((i) => (i + 1) % totalVersions));
      }
      if (e.key === "Enter") {
        navigate(`/${gameId}/play`);
      }
      if (e.key === "Escape") {
        navigate("/");
      }
    },
    [totalVersions, navigate, gameId]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleNav);
    return () => window.removeEventListener("keydown", handleNav);
  }, [handleNav]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      let el: HTMLElement | null = target;
      while (el && el !== containerRef.current) {
        if (el.getAttribute("data-name") === "btn/menu") {
          const menuParent = el.parentElement;
          if (menuParent) {
            const buttons = Array.from(
              menuParent.querySelectorAll('[data-name="btn/menu"]')
            );
            const idx = buttons.indexOf(el);
            if (idx >= 0) {
              startTransition(() => setVersionIndex(idx));
            }
          }
          return;
        }
        el = el.parentElement;
      }
    },
    []
  );

  const screenIdx = Math.min(versionIndex, screens.length - 1);
  const CurrentScreen = screens[screenIdx];

  return (
    <div
      ref={containerRef}
      className="size-full relative"
      onClick={handleClick}
    >
      <CurrentScreen />
    </div>
  );
}
