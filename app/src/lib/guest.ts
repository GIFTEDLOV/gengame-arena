import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const STORAGE_KEY = "gengame_guest_key";

export function getOrCreateGuestWallet() {
  let privateKey = localStorage.getItem(STORAGE_KEY) as `0x${string}` | null;
  if (!privateKey) {
    privateKey = generatePrivateKey();
    localStorage.setItem(STORAGE_KEY, privateKey);
  }
  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address };
}

export function clearGuestWallet() {
  localStorage.removeItem(STORAGE_KEY);
}
