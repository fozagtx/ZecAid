"use client";

import { BrowserQRCodeReader } from "@zxing/browser";
import { get, set } from "idb-keyval";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";

import { verifyCardPayload, signReceipt, verifyPin } from "@/lib/crypto";
import { formatZec, zecToZatoshis } from "@/lib/money";
import { remainingAllowance } from "@/lib/settlement";
import type { CardPayload, ReceiptInput } from "@/lib/types";

const PAIRING_KEY = "zecaid-pos-pairing";
const RECEIPTS_KEY = "zecaid-pos-receipts";
const SNAPSHOT_KEY = "zecaid-pos-snapshot";

type Pairing = {
  vendorId: string;
  vendorName: string;
  ngoPubKey: string;
  programName: string;
  privateKey: string;
  payoutAddress?: string | null;
};
type LocalReceipt = ReceiptInput & { status: string; txid: string | null; reason: string | null };
type Snapshot = {
  revokedCardIds: string[];
  settledSpentByCard: Record<string, number>;
  receiptStatuses: Array<{ id: string; status: string; txid: string | null; reason: string | null }>;
  savedAt?: string;
};

const emptySnapshot: Snapshot = { revokedCardIds: [], settledSpentByCard: {}, receiptStatuses: [] };

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getOnlineSnapshot() {
  return navigator.onLine;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Request failed.");
  return body as T;
}

function parsePayload(raw: string): CardPayload {
  const normalized = raw.trim();
  const encoded = normalized.replaceAll("-", "+").replaceAll("_", "/");
  const json = normalized.startsWith("{")
    ? normalized
    : atob(encoded + "=".repeat((4 - (encoded.length % 4)) % 4));
  const value = JSON.parse(json) as CardPayload;
  if (value.v !== 1 || value.n !== "testnet" || typeof value.c !== "string") {
    throw new Error("This is not a ZecAid testnet card.");
  }
  return value;
}

export function PosApp() {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [snapshotLoaded, setSnapshotLoaded] = useState(false);
  const [receipts, setReceipts] = useState<LocalReceipt[]>([]);
  const online = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, () => false);
  const [payloadText, setPayloadText] = useState("");
  const [card, setCard] = useState<CardPayload | null>(null);
  const [amount, setAmount] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<{ stop: () => void } | null>(null);

  useEffect(() => {
    void Promise.all([
      get<Pairing | undefined>(PAIRING_KEY),
      get<LocalReceipt[] | undefined>(RECEIPTS_KEY),
      get<Snapshot | undefined>(SNAPSHOT_KEY),
    ]).then(([savedPairing, savedReceipts, savedSnapshot]) => {
      setPairing(savedPairing ?? null);
      setReceipts(savedReceipts ?? []);
      if (savedSnapshot) {
        setSnapshot(savedSnapshot);
        setSnapshotLoaded(true);
      }
    });
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js").then(async () => {
        await navigator.serviceWorker.ready;
        const cache = await caches.open("zecaid-pos-v3");
        await cache.add("/pos").catch(() => undefined);
        const assets = performance.getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((url) => url.startsWith(`${location.origin}/_next/static/`));
        await Promise.all(assets.map((url) => cache.add(url).catch(() => undefined)));
      });
    }
    return () => {
      scannerRef.current?.stop();
    };
  }, []);

  const refreshSnapshot = useCallback(async () => {
    if (!pairing || !navigator.onLine) return;
    const result = await request<Snapshot>(`/api/pos/snapshot?vendorId=${encodeURIComponent(pairing.vendorId)}`);
    const next = { ...result, savedAt: new Date().toISOString() };
    setSnapshot(next);
    setSnapshotLoaded(true);
    await set(SNAPSHOT_KEY, next);
  }, [pairing]);

  const sync = useCallback(async () => {
    if (!pairing || !navigator.onLine) return;
    setBusy(true);
    setError("");
    try {
      const currentReceipts = await get<LocalReceipt[]>(RECEIPTS_KEY) ?? [];
      const unsynced = currentReceipts.filter((receipt) => receipt.status === "offline" || receipt.status === "queued");
      const response = await request<{ snapshot: Snapshot; results: Snapshot["receiptStatuses"] }>("/api/pos/sync", {
        method: "POST",
        body: JSON.stringify({
          vendorId: pairing.vendorId,
          receipts: unsynced.map(({ id, cardId, vendorId, amountZatoshis, createdAt, signature }) => ({
            id, cardId, vendorId, amountZatoshis, createdAt, signature,
          })),
        }),
      });
      const statusById = new Map(response.results.map((item) => [item.id, item]));
      const nextReceipts = currentReceipts.map((receipt) => {
        const status = statusById.get(receipt.id);
        return status && (receipt.status !== status.status || receipt.txid !== status.txid || receipt.reason !== status.reason)
          ? { ...receipt, status: status.status, txid: status.txid, reason: status.reason }
          : receipt;
      });
      const nextSnapshot = { ...response.snapshot, savedAt: new Date().toISOString() };
      setReceipts(nextReceipts);
      setSnapshot(nextSnapshot);
      setSnapshotLoaded(true);
      await Promise.all([set(RECEIPTS_KEY, nextReceipts), set(SNAPSHOT_KEY, nextSnapshot)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Receipts could not sync.");
    } finally {
      setBusy(false);
    }
  }, [pairing]);

  useEffect(() => {
    if (!online || !pairing) return;
    const timer = window.setTimeout(() => {
      void refreshSnapshot().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not refresh vendor snapshot."));
      void sync();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [online, pairing, refreshSnapshot, sync]);

  const selectCard = useCallback(async (raw: string) => {
    setError("");
    setNotice("");
    setCard(null);
    try {
      if (!pairing) throw new Error("Pair this device with a vendor before accepting cards.");
      if (!snapshotLoaded) throw new Error("Connect once to sync this POS before accepting cards offline.");
      const payload = parsePayload(raw);
      if (!(await verifyCardPayload(payload, pairing.ngoPubKey))) throw new Error("Card signature is invalid.");
      if (Date.parse(payload.x) <= Date.now()) throw new Error("This card has expired.");
      if (snapshot.revokedCardIds.includes(payload.c)) throw new Error("This card is frozen or expired.");
      const attempts = await get<number>(`zecaid-pin-attempts-${payload.c}`) ?? 0;
      if (attempts >= 5) {
        setLocked(true);
        throw new Error("This card is locked on this device after five incorrect PIN attempts.");
      }
      setLocked(false);
      setCard(payload);
      setPayloadText(raw);
      setNotice(`Card verified · ${formatZec(payload.a)} ZEC allowance`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Card could not be verified.");
    }
  }, [pairing, snapshotLoaded, snapshot.revokedCardIds]);

  async function acceptCharge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!card || !pairing) return;
    if (locked) {
      setError("This card is locked on this device after five incorrect PIN attempts.");
      return;
    }
    let amountZatoshis: number;
    try { amountZatoshis = zecToZatoshis(amount); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Enter a valid ZEC amount."); return; }
    const reserved = remainingAllowance(
      card.a,
      snapshot.settledSpentByCard[card.c] ?? 0,
      receipts.filter((item) => ["offline", "queued", "awaiting_funds"].includes(item.status)),
      card.c,
    );
    if (amountZatoshis <= 0 || amountZatoshis > reserved) {
      setError(`Insufficient remaining allowance. ${formatZec(reserved)} ZEC remains.`);
      return;
    }
    if (!verifyPin(pin, card.c, card.ph)) {
      const attempts = (await get<number>(`zecaid-pin-attempts-${card.c}`) ?? 0) + 1;
      await set(`zecaid-pin-attempts-${card.c}`, attempts);
      setLocked(attempts >= 5);
      setError(attempts >= 5
        ? "Wrong PIN. This card is now locked on this device."
        : `Wrong PIN. ${5 - attempts} attempts remaining on this device.`);
      setPin("");
      return;
    }

    setBusy(true);
    try {
      const input = {
        id: crypto.randomUUID(),
        cardId: card.c,
        vendorId: pairing.vendorId,
        amountZatoshis,
        createdAt: new Date().toISOString(),
      };
      const signed = await signReceipt(input, pairing.privateKey);
      const receipt: LocalReceipt = {
        ...signed,
        status: online ? "queued" : "offline",
        txid: null,
        reason: null,
      };
      const next = [receipt, ...receipts];
      setReceipts(next);
      await set(RECEIPTS_KEY, next);
      setNotice(online ? "Charge accepted · queued for sync." : "Charge accepted offline · stored on this device.");
      setPin("");
      setAmount("");
      setPayloadText("");
      setCard(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Charge could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function startScanner() {
    setError("");
    setCameraOpen(true);
    if (!videoRef.current) return;
    try {
      const reader = new BrowserQRCodeReader();
      scannerRef.current = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (!result) return;
        scannerRef.current?.stop();
        setCameraOpen(false);
        void selectCard(result.getText());
      });
    } catch (cause) {
      setCameraOpen(false);
      setError(cause instanceof Error ? cause.message : "Camera is unavailable. Paste the card code instead.");
    }
  }

  const remaining = card
    ? remainingAllowance(
        card.a,
        snapshot.settledSpentByCard[card.c] ?? 0,
        receipts.filter((item) => ["offline", "queued", "awaiting_funds"].includes(item.status)),
        card.c,
      )
    : 0;

  if (!pairing) return <main className="za-pos"><header className="za-pos-header"><Link className="za-wordmark" href="/"><span className="za-mark">z</span> zecaid</Link><span className="za-network-indicator">{online ? "ONLINE" : "OFFLINE"}</span></header><section className="za-pos-empty"><Eyebrow>VENDOR POINT OF SALE</Eyebrow><h1>Pair this device.</h1><p>Open the one-time pairing link from your program manager on this device.</p><Link href="/console/vendors" className="za-button za-button--green">GO TO PROGRAM CONSOLE ↗</Link></section></main>;

  return (
    <main className="za-pos">
      <header className="za-pos-header"><Link className="za-wordmark" href="/"><span className="za-mark">z</span> zecaid</Link><span className="za-pos-payout" title={pairing.payoutAddress ?? "Payout address unavailable"}>PAID TO {pairing.payoutAddress ?? "not set"}</span><div className={`za-network-indicator ${online ? "is-online" : "is-offline"}`}><i />{online ? "ONLINE" : "OFFLINE"}</div></header>
      <div className="za-pos-body">
        <div className="za-pos-title"><div><Eyebrow>{pairing.vendorName} · VENDOR POS</Eyebrow><h1>Accept a card.</h1></div><button className="za-button za-button--small" disabled={!online || busy} onClick={() => void sync()}>{busy ? "SYNCING…" : "SYNC RECEIPTS ↻"}</button></div>
        {error && <div className="za-alert">{error}</div>}
        {notice && <div className="za-notice">{notice}</div>}
        <form className="za-pos-form" onSubmit={acceptCharge}>
          <label>AMOUNT (ZEC)<input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" pattern="^\d+(\.\d{1,8})?$" required /></label>
          <div className="za-pos-scan">
            <label>ALLOWANCE CARD QR<input value={payloadText} onChange={(event) => setPayloadText(event.target.value)} placeholder="Scan or paste card QR code" /></label>
            <button type="button" className="za-button" onClick={() => void startScanner()}>SCAN QR</button>
          </div>
          <div className={`za-camera ${cameraOpen ? "is-open" : ""}`} aria-hidden={!cameraOpen}><video ref={videoRef} /><button type="button" className="za-link-button" onClick={() => { scannerRef.current?.stop(); setCameraOpen(false); }}>CLOSE CAMERA</button></div>
          <button type="button" className="za-button za-button--green za-verify-button" disabled={!payloadText} onClick={() => void selectCard(payloadText)}>VERIFY CARD →</button>
          {card && <div className="za-card-verified"><span>CARD VERIFIED</span><strong>{formatZec(remaining)} <small>ZEC REMAINING</small></strong><small>Expires {new Date(card.x).toLocaleDateString()} · Signed by the aid program</small></div>}
          <label>RECIPIENT PIN<input value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} type="password" inputMode="numeric" autoComplete="off" placeholder="6 digits" maxLength={6} required /></label>
          <button className="za-button za-button--accent za-charge-button" disabled={!card || busy || pin.length !== 6}>{busy ? "SAVING…" : "ACCEPT CHARGE →"}</button>
          <p className="za-pos-footnote">The PIN stays on this device. Receipts settle as shielded Zcash payments when you reconnect.</p>
        </form>
        <section className="za-pos-receipts"><div className="za-panel-heading"><div><Eyebrow>LOCAL RECEIPTS</Eyebrow><h2>Charges on this device</h2></div><span>{receipts.length} receipts</span></div>{!receipts.length ? <div className="za-empty">No charges recorded on this device.</div> : receipts.map((receipt) => <article className="za-pos-receipt" key={receipt.id}><span><b>{formatZec(receipt.amountZatoshis)} ZEC</b><small>{new Date(receipt.createdAt).toLocaleTimeString()} · {receipt.id.slice(0, 8)}</small></span><span className={`za-receipt-state state-${receipt.status.replaceAll("_", "-")}`}>{receipt.status.replaceAll("_", " ")}</span>{receipt.txid && <a href={`https://testnet.zcashexplorer.app/transactions/${receipt.txid}`} target="_blank" rel="noreferrer">{receipt.txid.slice(0, 14)}… ↗</a>}{receipt.reason && <small>{receipt.reason}</small>}</article>)}</section>
      </div>
    </main>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="za-page-eyebrow">{children}</p>;
}
