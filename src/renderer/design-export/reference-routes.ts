import { createBrowserRouter } from "react-router";
import MainMenuPage from "./components/MainMenuPage";
import VersionSelectPage from "./components/VersionSelectPage";
import GameplayPage from "./components/GameplayPage";

export const router = createBrowserRouter([
  { path: "/", Component: MainMenuPage },
  { path: "/:game", Component: VersionSelectPage },
  { path: "/:game/play", Component: GameplayPage },
]);
