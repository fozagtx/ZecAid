"use client";

import { set } from "idb-keyval";
import Link from "next/link";
import { useEffect, useState } from "react";

import { createEd25519KeyPair } from "@/lib/crypto";

const PAIRING_KEY = "zecaid-pos-pairing";
type Pairing = {
  vendorId: string;
  vendorName: string;
  ngoPubKey: string;
  programName: string;
  privateKey: string;
};

type PairingWindow = Window & {
  __zecaidPairingAttempts?: Map<string, Promise<Pairing>>;
};

async function pairDevice(pairingCode: string): Promise<Pairing> {
  const browserWindow = window as PairingWindow;
  const pairingAttempts = browserWindow.__zecaidPairingAttempts ??= new Map();
  const existing = pairingAttempts.get(pairingCode);
  if (existing) return existing;
  const attempt = (async () => {
    const keyPair = await createEd25519KeyPair();
    const response = await fetch("/api/pos/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: pairingCode, vendorPubKey: keyPair.publicKey }),
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

export function PosPair() {
  const [message, setMessage] = useState("Connecting this device…");
  const [error, setError] = useState("");
  const [paired, setPaired] = useState<Pairing | null>(null);

  useEffect(() => {
    void Promise.resolve().then(async () => {
      const params = new URLSearchParams(window.location.search);
      const pairingCode = params.get("code");
      if (!pairingCode) {
        setError("This pairing link is missing its one-time code.");
        return;
      }
      if (!navigator.onLine) {
        setError("Pairing needs an internet connection. Reopen this link when online.");
        return;
      }
      try {
        const result = await pairDevice(pairingCode);
        setPaired(result);
        setMessage("This device is paired.");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Pairing failed.");
      }
    });
  }, []);

  return <main className="za-pos za-pair-page">
    <header className="za-pos-header"><Link className="za-wordmark" href="/"><span className="za-mark">z</span> zecaid</Link><span className="za-network-indicator is-online">ONLINE</span></header>
    <section className="za-pos-empty">
      <p className="za-page-eyebrow">VENDOR DEVICE PAIRING</p>
    {error ? <><h1>Couldn’t pair.</h1><p>{error}</p></> : paired ? <><h1>You’re connected.</h1><p>{paired.vendorName} · {paired.programName}. This device keeps its signing key in local storage.</p><Link className="za-button za-button--green" href="/pos">OPEN VENDOR POS →</Link></> : <><h1>Setting up your POS.</h1><p>{message} Keep this page open while the vendor device is online.</p><div className="za-loader" /></>}
    </section>
  </main>;
}
