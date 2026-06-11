"use client";
import { createContext, useContext, useState, useCallback } from "react";

interface SettlingTx {
  id: string;
  description: string;
}

interface SettlingCtx {
  txs: SettlingTx[];
  addTx: (id: string, description: string) => void;
  removeTx: (id: string) => void;
}

const Ctx = createContext<SettlingCtx>({
  txs: [],
  addTx: () => {},
  removeTx: () => {},
});

export function SettlingProvider({ children }: { children: React.ReactNode }) {
  const [txs, setTxs] = useState<SettlingTx[]>([]);

  const addTx = useCallback((id: string, description: string) => {
    setTxs((p) => [...p, { id, description }]);
  }, []);

  const removeTx = useCallback((id: string) => {
    setTxs((p) => p.filter((t) => t.id !== id));
  }, []);

  return <Ctx.Provider value={{ txs, addTx, removeTx }}>{children}</Ctx.Provider>;
}

export function useSettling() {
  return useContext(Ctx);
}
