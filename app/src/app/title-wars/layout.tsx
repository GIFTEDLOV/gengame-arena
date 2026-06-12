import React from "react";
import GameAtmosphere from "@/components/GameAtmosphere";

export default function TitleWarsLayout({ children }: { children: React.ReactNode }) {
  return <GameAtmosphere game="title-wars">{children}</GameAtmosphere>;
}
