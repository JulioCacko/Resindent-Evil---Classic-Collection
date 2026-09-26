import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";

import MainMenuRe1Gameplay from "../../imports/MainMenuRe1Gameplay";
import MainMenuRe2Gameplay from "../../imports/MainMenuRe2Gameplay";
import MainMenuRe3Gameplay from "../../imports/MainMenuRe3Gameplay";

type GameId = "re1" | "re2" | "re3";

const gameplayScreens: Record<GameId, React.ComponentType> = {
  re1: MainMenuRe1Gameplay,
  re2: MainMenuRe2Gameplay,
  re3: MainMenuRe3Gameplay,
};

export default function GameplayPage() {
  const { game } = useParams<{ game: string }>();
  const navigate = useNavigate();
  const gameId = (game as GameId) || "re1";
  const Screen = gameplayScreens[gameId] || gameplayScreens.re1;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate(`/${gameId}`);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, gameId]);

  return <Screen />;
}
