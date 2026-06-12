import React from "react";
import GameAtmosphere from "@/components/GameAtmosphere";

export default function TriviaRoyaleLayout({ children }: { children: React.ReactNode }) {
  return <GameAtmosphere game="trivia-royale">{children}</GameAtmosphere>;
}
