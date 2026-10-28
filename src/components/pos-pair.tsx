"use client";

import { set } from "idb-keyval";
import Link from "next/link";
import { useEffect, useState } from "react";

import { createEd25519KeyPair } from "@/lib/crypto";

import { ConnectWalletButton, useNoirWallet, WalletProvider } from "./noir-wallet";

const PAIRING_KEY = "zecaid-pos-pairing";
type Pairing = {
  vendorId: string;
  vendorName: string;
  ngoPubKey: string;
  programName: string;
  payoutAddress: string;
  privateKey: string;
};

type PairingWindow = Window & {
  __zecaidPairingAttempts?: Map<string, Promise<Pairing>>;
};

async function pairDevice(pairingCode: string, payoutAddress?: string): Promise<Pairing> {
  const browserWindow = window as PairingWindow;
  const pairingAttempts = browserWindow.__zecaidPairingAttempts ??= new Map();
  const existing = pairingAttempts.get(pairingCode);
  if (existing) return existing;
  const attempt = (async () => {
    const keyPair = await createEd25519KeyPair();
    const response = await fetch("/api/pos/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: pairingCode,
        vendorPubKey: keyPair.publicKey,
        ...(payoutAddress ? { payoutAddress } : {}),
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Pairing failed.");
    const result: Pairing = { ...body, privateKey: keyPair.privateKey };
    await set(PAIRING_KEY, result);
    return result;
  })();
  pairingAttempts.set(pairingCode, attempt);
  try {
    return await attempt;
  } catch (error) {
    if (pairingAttempts.get(pairingCode) === attempt) pairingAttempts.delete(pairingCode);
    throw error;
  }
}

function PosPairContent() {
  const { state: walletState, connection } = useNoirWallet();
  const [message, setMessage] = useState("Keep this page open while the vendor device is online.");
  const [error, setError] = useState("");
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [pairingCode, setPairingCode] = useState("");
  const [walletPayoutOpen, setWalletPayoutOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      const code = new URLSearchParams(window.location.search).get("code");
      if (!code) {
        setError("This pairing link is missing its one-time code.");
        return;
      }
      if (!navigator.onLine) {
        setError("Pairing needs an internet connection. Reopen this link when online.");
        return;
      }
      setPairingCode(code);
    });
    return () => {
      active = false;
    };
  }, []);

  async function pair(payoutAddress?: string) {
    setBusy(true);
    setError("");
    try {
      const result = await pairDevice(pairingCode, payoutAddress);
      setPairing(result);
      setMessage("This device is paired.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Pairing failed.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="za-pos za-pair-page">
    <header className="za-pos-header"><Link className="za-wordmark" href="/"><span className="za-mark">z</span> zecaid</Link><span className="za-network-indicator is-online">ONLINE</span></header>
    <section className="za-pos-empty">
      <p className="za-page-eyebrow">VENDOR DEVICE PAIRING</p>
      {error ? <><h1>Couldn’t pair.</h1><p>{error}</p></> : pairing ? <>
        <h1>You’re connected.</h1>
        <p>{pairing.vendorName} · {pairing.programName}. This device keeps its signing key in local storage.</p>
        <p className="za-pair-payout"><b>SETTLEMENTS GO TO</b><code>{pairing.payoutAddress}</code></p>
        <Link className="za-button za-button--green" href="/pos">OPEN VENDOR POS →</Link>
      </> : <>
        <h1>Set up your POS.</h1>
        <p>{message}</p>
        <button className="za-button za-button--green" disabled={!pairingCode || busy} onClick={() => void pair()}>
          {busy ? "PAIRING…" : "PAIR THIS POS"}
        </button>
        <button className="za-link-button za-pair-wallet-toggle" type="button" onClick={() => setWalletPayoutOpen((open) => !open)}>
          {walletPayoutOpen ? "CLOSE WALLET PAYOUT" : "GET PAID TO MY WALLET"}
        </button>
        {walletPayoutOpen && <div className="za-pair-wallet">
          <p>Connect Noir Wallet to receive vendor settlements at its shielded address.</p>
          <ConnectWalletButton />
          {walletState === "connected" && connection && <>
            <code className="za-address">{connection.shielded}</code>
            <button className="za-button za-button--green" disabled={!pairingCode || busy} onClick={() => void pair(connection.shielded)}>
              {busy ? "PAIRING…" : "PAIR & GET PAID TO MY WALLET →"}
            </button>
          </>}
        </div>}
      </>}
    </section>
  </main>;
}

export function PosPair() {
  return <WalletProvider><PosPairContent /></WalletProvider>;
}
