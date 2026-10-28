"use client";

import { getNoirWallet } from "@noir-wallet/sdk";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type NoirWallet = NonNullable<ReturnType<typeof getNoirWallet>>;
type ZcashApi = NoirWallet["zcash"];
type WalletConnection = Awaited<ReturnType<ZcashApi["connect"]>>;
type WalletBalance = Awaited<ReturnType<ZcashApi["getBalance"]>>;
type WalletState = "checking" | "not-installed" | "disconnected" | "connecting" | "connected";

type WalletContextValue = {
  state: WalletState;
  connection: WalletConnection | null;
  balance: WalletBalance | null;
  error: string;
  connect: () => Promise<WalletConnection | null>;
  disconnect: () => Promise<void>;
  sendTransaction: (params: Parameters<ZcashApi["sendTransaction"]>[0]) => Promise<string>;
};

const WalletContext = createContext<WalletContextValue | null>(null);
const TESTNET_RELEASES = "https://github.com/NoirWallet/noir-wallet-sdk/releases";

function errorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/reject|denied|cancel/i.test(message)) return "The wallet connection was rejected.";
  if (/locked|unlock/i.test(message)) return "Noir Wallet is locked. Unlock it and try again.";
  return message || "Noir Wallet could not complete the request.";
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<NoirWallet | null>(null);
  const [state, setState] = useState<WalletState>("checking");
  const [connection, setConnection] = useState<WalletConnection | null>(null);
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async (provider: NoirWallet) => {
    try {
      const accounts = await provider.zcash.getAccounts();
      if (!accounts) {
        setConnection(null);
        setBalance(null);
        setState("disconnected");
        return;
      }
      setConnection(accounts);
      setState("connected");
      try {
        setBalance(await provider.zcash.getBalance());
        setError("");
      } catch (cause) {
        setBalance(null);
        setError(errorMessage(cause));
      }
    } catch (cause) {
      setConnection(null);
      setBalance(null);
      setState("disconnected");
      setError(errorMessage(cause));
    }
  }, []);

  useEffect(() => {
    let active = true;
    const detected = getNoirWallet();
    void Promise.resolve().then(() => {
      if (!active) return;
      setWallet(detected);
      if (!detected) {
        setState("not-installed");
        return;
      }
      void refresh(detected);
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!wallet) return;
    const handleAccountsChanged = (addresses: unknown) => {
      if (!addresses) {
        setConnection(null);
        setBalance(null);
        setState("disconnected");
        setError("Noir Wallet is locked or disconnected.");
      } else {
        void refresh(wallet);
      }
    };
    wallet.zcash.on("accountsChanged", handleAccountsChanged);
    return () => wallet.zcash.removeListener("accountsChanged", handleAccountsChanged);
  }, [refresh, wallet]);

  const connect = useCallback(async () => {
    const provider = wallet ?? getNoirWallet();
    if (!provider) {
      setState("not-installed");
      setError("Install Noir Wallet for testnet to connect.");
      return null;
    }
    setWallet(provider);
    setState("connecting");
    setError("");
    try {
      const accounts = await provider.zcash.connect();
      setConnection(accounts);
      setState("connected");
      try {
        setBalance(await provider.zcash.getBalance());
      } catch (cause) {
        setBalance(null);
        setError(errorMessage(cause));
      }
      return accounts;
    } catch (cause) {
      setConnection(null);
      setBalance(null);
      setState("disconnected");
      setError(errorMessage(cause));
      return null;
    }
  }, [wallet]);

  const disconnect = useCallback(async () => {
    if (!wallet) return;
    await wallet.zcash.disconnect();
    setConnection(null);
    setBalance(null);
    setState("disconnected");
    setError("");
  }, [wallet]);

  const sendTransaction = useCallback<WalletContextValue["sendTransaction"]>(async (params) => {
    const provider = wallet ?? getNoirWallet();
    if (!provider || !connection) throw new Error("Connect Noir Wallet before sending.");
    return provider.zcash.sendTransaction(params);
  }, [connection, wallet]);

  return (
    <WalletContext.Provider value={{ state, connection, balance, error, connect, disconnect, sendTransaction }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useNoirWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useNoirWallet must be used within WalletProvider.");
  return context;
}

export function ConnectWalletButton() {
  const { state, connection, balance, error, connect, disconnect } = useNoirWallet();
  const balanceText = balance?.available ?? balance?.shielded;
  return (
    <div className="za-wallet-connect">
      {state === "not-installed" ? (
        <a className="za-wallet-action" href={TESTNET_RELEASES} target="_blank" rel="noreferrer">
          Install Noir Wallet (testnet)
        </a>
      ) : state === "connected" && connection ? (
        <>
          <span className="za-wallet-summary" title={connection.shielded}>
            {connection.shielded.slice(0, 12)}…{connection.shielded.slice(-6)}
            {balanceText ? ` · ${balanceText} ZEC` : ""}
          </span>
          <button className="za-wallet-action" type="button" onClick={() => void disconnect()}>Disconnect</button>
        </>
      ) : (
        <button
          className="za-wallet-action"
          type="button"
          disabled={state === "checking" || state === "connecting"}
          onClick={() => void connect()}
        >
          {state === "checking" ? "Checking Noir Wallet…" : state === "connecting" ? "Connecting…" : "Connect wallet"}
        </button>
      )}
      {error && <span className="za-wallet-error" role="status">{error}</span>}
    </div>
  );
}
