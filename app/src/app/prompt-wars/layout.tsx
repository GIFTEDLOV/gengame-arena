import React from "react";
import GameAtmosphere from "@/components/GameAtmosphere";

export default function PromptWarsLayout({ children }: { children: React.ReactNode }) {
  return <GameAtmosphere game="prompt-wars">{children}</GameAtmosphere>;
}
