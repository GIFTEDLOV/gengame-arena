import React from "react";
import GameAtmosphere from "@/components/GameAtmosphere";

export default function PredictionsLayout({ children }: { children: React.ReactNode }) {
  return <GameAtmosphere game="predictions">{children}</GameAtmosphere>;
}
