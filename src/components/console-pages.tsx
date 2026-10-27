"use client";

import Link from "next/link";
import Image from "next/image";
import QRCode from "qrcode";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

import { formatZec } from "@/lib/money";

type Card = {
  id: string;
  label: string;
  allowanceZatoshis: number;
  expiresAt: string;
  payload: { v: number; c: string; n: string; a: number; x: string; ph: string; s: string };
  fundingTxid: string;
  fundingHeight: number | null;
  status: string;
  balance: { totalZatoshis: number; spendableZatoshis: number } | null;
  settledSpentZatoshis: number;
  createdAt: string;
};
type Vendor = { id: string; name: string; unifiedAddress: string; publicKey: string | null; pairedAt: string | null };
type Program = {
  opened: boolean;
  treasuryAddress: string | null;
  treasuryBalance: { totalZatoshis: number; spendableZatoshis: number } | null;
  cards: Card[];
  vendors: Vendor[];
  cardCount: number;
  totalAllowanceZatoshis: number;
  settledZatoshis: number;
  pendingReceipts: number;
  chainHeight: number | null;
  lastSyncAt: string | null;
  walletReady: boolean;
};
type WalletSettings = {
  server: string;
  binaryPath: string;
  vaultDir: string;
  ready: boolean;
  message: string | null;
};
type Settlement = {
  id: string;
  cardId: string;
  vendorId: string;
  amountZatoshis: number;
  createdAt: string;
  status: string;
  txid: string | null;
  reason: string | null;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Request failed.");
  return body as T;
}

function useProgram() {
  const [program, setProgram] = useState<Program | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProgram(await api<Program>("/api/program"));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load program.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    void api<Program>("/api/program").then(
      (value) => { if (mounted) setProgram(value); },
      (cause: unknown) => { if (mounted) setError(cause instanceof Error ? cause.message : "Could not load program."); },
    ).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);
  return { program, error, setError, loading, load };
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="za-page-eyebrow">{children}</p>;
}

function PageHeader({ eyebrow, title, description, action }: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="za-page-header">
      <div><Eyebrow>{eyebrow}</Eyebrow><h1>{title}</h1><p>{description}</p></div>
      {action}
    </div>
  );
}

function QrImage({ value, size = 220 }: { value: string; size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    void QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: "M" }).then(setSrc);
  }, [value, size]);
  return src ? <Image className="za-qr" src={src} width={size} height={size} alt="QR code" unoptimized /> : <div className="za-qr-placeholder" />;
}

function Status({ value }: { value: string }) {
  return <span className={`za-status za-status--${value.replaceAll("_", "-")}`}>{value.replaceAll("_", " ")}</span>;
}

function CopyButton({ value, label = "COPY" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="za-button za-button--small" onClick={async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }}>{copied ? "COPIED" : label}</button>;
}

export function OverviewPage() {
  const { program, error, setError, loading, load } = useProgram();
  const [busy, setBusy] = useState(false);
  const [qrOpen, setQrOpen] = useState(true);
  async function openProgram() {
    setBusy(true);
    setError("");
    try { await api("/api/program/open", { method: "POST" }); await load(); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(/binary|devtool|vault/i.test(message) ? "The program could not be opened. Check Settings for connection details." : message || "Could not open program.");
    }
    finally { setBusy(false); }
  }
  async function refresh() {
    setBusy(true);
    setError("");
    try { await api("/api/program/refresh", { method: "POST" }); await load(); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(/binary|devtool|vault/i.test(message) ? "Program refresh failed. Check Settings for connection details." : message || "Could not refresh program.");
    }
    finally { setBusy(false); }
  }
  if (loading) return <div className="za-loading">Loading program status…</div>;
  if (!program) return <div className="za-alert">{error}</div>;
  return (
    <>
      <PageHeader eyebrow="PROGRAM OVERVIEW" title="Aid, accounted for." description="Treasury, allowance cards and payments on Zcash testnet." action={
        program.opened
          ? <button className="za-button za-button--green" disabled={busy} onClick={refresh}>{busy ? "SYNCING…" : "REFRESH FROM CHAIN ↻"}</button>
          : null
      } />
      {error && <div className="za-alert">{error}</div>}
      {!program.opened ? (
        <section className="za-open-card">
          <div className="za-open-icon">ZA</div>
          <Eyebrow>FIRST STEP</Eyebrow>
          <h2>Open your aid program.</h2>
          <p>Create the program Treasury on Zcash testnet. Its address is yours to fund; all card and vendor payments are real shielded transactions.</p>
          <button className="za-button za-button--green" onClick={openProgram} disabled={busy}>{busy ? "OPENING…" : "OPEN PROGRAM →"}</button>
          {!program.walletReady && <p className="za-muted">The program service needs attention. Check Settings for connection details.</p>}
        </section>
      ) : (
        <>
          <div className="za-metrics">
            <article className="za-metric za-metric--primary"><span>TREASURY BALANCE</span><strong>{formatZec(program.treasuryBalance?.totalZatoshis ?? 0)} <small>ZEC</small></strong><em>Testnet funds</em></article>
            <article className="za-metric"><span>CARDS ISSUED</span><strong>{program.cardCount}</strong><em>Active and awaiting funds</em></article>
            <article className="za-metric"><span>ALLOWANCE ISSUED</span><strong>{formatZec(program.totalAllowanceZatoshis)} <small>ZEC</small></strong><em>Across all cards</em></article>
            <article className="za-metric"><span>SETTLED</span><strong>{formatZec(program.settledZatoshis)} <small>ZEC</small></strong><em>{program.pendingReceipts} pending receipts</em></article>
          </div>
          <div className="za-overview-grid">
            <section className="za-panel za-treasury-panel">
              <div className="za-panel-heading"><div><Eyebrow>PROGRAM TREASURY</Eyebrow><h2>Fund your program</h2></div><button className="za-link-button" onClick={() => setQrOpen((value) => !value)}>{qrOpen ? "HIDE QR" : "SHOW QR"}</button></div>
              {qrOpen && program.treasuryAddress && <QrImage value={program.treasuryAddress} size={168} />}
              <code className="za-address">{program.treasuryAddress}</code>
              <div className="za-inline-actions"><CopyButton value={program.treasuryAddress ?? ""} /><a className="za-text-link" href="https://fauzec.com/" target="_blank" rel="noreferrer">OPEN FAUZEC ↗</a></div>
              <p className="za-muted">Chain height {program.chainHeight ?? "—"} · Last sync {program.lastSyncAt ? new Date(program.lastSyncAt).toLocaleString() : "not synced yet"}</p>
            </section>
            <section className="za-panel">
              <div className="za-panel-heading"><div><Eyebrow>RECENT CARDS</Eyebrow><h2>Allowance cards</h2></div><Link href="/console/cards" className="za-text-link">VIEW ALL ↗</Link></div>
              {program.cards.length === 0 ? <div className="za-empty">No cards issued yet. Create the first allowance when the Treasury is funded.</div> : (
                <div className="za-simple-list">{program.cards.slice(0, 5).map((card) => <Link href={`/console/cards/${card.id}`} key={card.id} className="za-list-row"><span><b>{card.label}</b><small>{card.id.slice(0, 8)}</small></span><span>{formatZec(card.allowanceZatoshis)} ZEC</span><Status value={card.status} /></Link>)}</div>
              )}
            </section>
          </div>
          <div className="za-home-actions"><Link href="/console/cards" className="za-button za-button--green">ISSUE AN ALLOWANCE CARD →</Link><Link href="/console/vendors" className="za-button">REGISTER A VENDOR</Link></div>
        </>
      )}
    </>
  );
}

export function CardsPage() {
  const { program, error: loadError, loading, load } = useProgram();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ card: Card; pin: string } | null>(null);
  const [label, setLabel] = useState("");
  const [allowance, setAllowance] = useState("0.05");
  const [expiresAt, setExpiresAt] = useState(() => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setIssued(null);
    try {
      const result = await api<{ card: Card; pin: string }>("/api/cards", {
        method: "POST",
        body: JSON.stringify({ label, allowanceZec: allowance, expiresAt: new Date(`${expiresAt}T23:59:59.000Z`).toISOString() }),
      });
      setIssued(result);
      setLabel("");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Card could not be issued."); }
    finally { setBusy(false); }
  }
  if (loading) return <div className="za-loading">Loading cards…</div>;
  return (
    <>
      <PageHeader eyebrow="ALLOWANCE CARDS" title="Give aid a clear limit." description="Each card is backed by a separate Zcash account. The PIN is shown only once when you issue it." />
      {(error || loadError) && <div className="za-alert">{error || loadError}</div>}
      {!program?.opened ? <div className="za-alert">Open the program before issuing cards.</div> : (
        <div className="za-two-column">
          <form className="za-panel za-form" onSubmit={issue}>
            <Eyebrow>ISSUE A CARD</Eyebrow><h2>New allowance</h2>
            <label>Recipient label<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Family or case reference" required maxLength={120} /></label>
            <label>Allowance in ZEC<input value={allowance} onChange={(event) => setAllowance(event.target.value)} inputMode="decimal" pattern="^\d+(\.\d{1,8})?$" required /></label>
            <label>Expiry date<input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} required /></label>
            <button className="za-button za-button--green" disabled={busy}>{busy ? "FUNDING CARD…" : "ISSUE & FUND CARD →"}</button>
            <p className="za-muted">Allowance and a 0.001 ZEC fee reserve are sent from the Treasury. Funding is real and may need confirmations.</p>
          </form>
          <div className="za-panel">
            {issued ? (
              <div className="za-issued-card">
                <Eyebrow>PIN — SHOWN ONCE</Eyebrow>
                <h2>{issued.card.label}</h2>
                <strong className="za-pin">{issued.pin}</strong>
                <p>Write this six-digit PIN on the recipient’s card separately. It will not appear again or on the printable card.</p>
                <p><Status value={issued.card.status} /> <span>{formatZec(issued.card.allowanceZatoshis)} ZEC allowance</span></p>
                <Link className="za-text-link" href={`/console/cards/${issued.card.id}`}>OPEN CARD DETAILS ↗</Link>
              </div>
            ) : (
              <div className="za-empty-promo"><span className="za-promo-icon">01</span><Eyebrow>PRIVATE BY DESIGN</Eyebrow><h2>One card, one allowance.</h2><p>Recipients use the printed QR and keep the six-digit PIN in hand. Vendors can verify offline; settlements happen when they reconnect.</p></div>
            )}
          </div>
        </div>
      )}
      <section className="za-panel za-table-panel"><div className="za-panel-heading"><div><Eyebrow>PROGRAM CARDS</Eyebrow><h2>Issued allowances</h2></div><span>{program?.cards.length ?? 0} cards</span></div>
        {!program?.cards.length ? <div className="za-empty">No allowance cards have been issued.</div> : <div className="za-simple-list">{program.cards.map((card) => <Link href={`/console/cards/${card.id}`} key={card.id} className="za-list-row"><span><b>{card.label}</b><small>{card.id}</small></span><span>{formatZec(card.allowanceZatoshis)} ZEC</span><Status value={card.status} /><span>→</span></Link>)}</div>}
      </section>
    </>
  );
}

export function CardDetailPage({ id, print = false }: { id: string; print?: boolean }) {
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void api<Card>(`/api/cards/${id}`).then(setCard).catch((cause) => setError(cause instanceof Error ? cause.message : "Card not found."));
  }, [id]);
  if (error) return <div className="za-alert">{error}</div>;
  if (!card) return <div className="za-loading">Loading card…</div>;
  const payload = btoa(JSON.stringify(card.payload)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  if (print) return <main className="za-print-card">
    <div className="za-print-brand"><span className="za-mark">z</span> ZecAid</div>
    <p className="za-page-eyebrow">PRIVATE AID ALLOWANCE</p>
    <h1>{card.label}</h1>
    <div className="za-print-body"><QrImage value={payload} size={280} /><div><span>ALLOWANCE</span><strong>{formatZec(card.allowanceZatoshis)} ZEC</strong><span>EXPIRES</span><strong>{new Date(card.expiresAt).toLocaleDateString()}</strong><span>CARD ID</span><code>{card.id}</code><Status value={card.status} /></div></div>
    <p className="za-print-note">Show this card to a participating vendor. Keep your six-digit PIN private and enter it only on the vendor’s device.</p>
    <button className="za-button za-print-action" onClick={() => window.print()}>PRINT CARD</button>
  </main>;
  return <>
    <PageHeader eyebrow="CARD DETAIL" title={card.label} description={`Allowance card · ${card.id}`} action={<Link href={`/console/cards/${id}/print`} className="za-button za-button--green">PRINT CARD ↗</Link>} />
    <div className="za-card-detail-grid">
      <section className="za-panel"><Eyebrow>ALLOWANCE</Eyebrow><strong className="za-big-number">{formatZec(card.allowanceZatoshis)} <small>ZEC</small></strong><div className="za-detail-line"><span>Status</span><Status value={card.status} /></div><div className="za-detail-line"><span>Expires</span><b>{new Date(card.expiresAt).toLocaleDateString()}</b></div><div className="za-detail-line"><span>Settled</span><b>{formatZec(card.settledSpentZatoshis)} ZEC</b></div><div className="za-detail-line"><span>Card account balance</span><b>{card.balance ? `${formatZec(card.balance.totalZatoshis)} ZEC` : "Unavailable"}</b></div></section>
      <section className="za-panel za-card-qr-panel"><Eyebrow>PRINTED CARD QR</Eyebrow><QrImage value={payload} size={210} /><p>PIN is not stored on this card or included in the printed page.</p><Link href={`/console/cards/${id}/print`} className="za-text-link">OPEN PRINT VIEW ↗</Link></section>
      <section className="za-panel"><Eyebrow>FUNDING</Eyebrow><h2>Real testnet transaction</h2><Status value={card.status} /><p className="za-muted">Allowance account funding transaction</p><code className="za-address">{card.fundingTxid}</code><div className="za-detail-line"><span>Funding height</span><b>{card.fundingHeight ?? "Awaiting confirmation"}</b></div></section>
    </div>
  </>;
}

export function VendorsPage() {
  const { program, loading, load } = useProgram();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [pairing, setPairing] = useState<{ vendor: Vendor; pairingPath: string } | null>(null);
async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPairing(null);
    try {
      const result = await api<{ vendor: Vendor; pairingPath: string }>("/api/vendors", { method: "POST", body: JSON.stringify({ name, unifiedAddress: address }) });
      setPairing(result);
      setName("");
      setAddress("");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Vendor could not be registered."); }
  }
  if (loading) return <div className="za-loading">Loading vendors…</div>;
  return <>
    <PageHeader eyebrow="VENDOR NETWORK" title="Bring local vendors in." description="Register a vendor’s own testnet address, then pair their point-of-sale device with a one-time link." />
    {error && <div className="za-alert">{error}</div>}
    <div className="za-two-column">
      <form className="za-panel za-form" onSubmit={register}><Eyebrow>REGISTER VENDOR</Eyebrow><h2>Vendor details</h2><label>Vendor name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Market stall" required /></label><label>Testnet unified address<input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="utest1…" required /></label><button className="za-button za-button--green">CREATE PAIRING LINK →</button><p className="za-muted">Payments settle to this address from each card’s Zcash account.</p></form>
      <section className="za-panel">{pairing ? <><Eyebrow>ONE-TIME PAIRING LINK</Eyebrow><h2>{pairing.vendor.name}</h2><p>Open this link on the vendor’s device while online. It can only be used once.</p><code className="za-address">{typeof window === "undefined" ? "" : window.location.origin}{pairing.pairingPath}</code><div className="za-inline-actions"><CopyButton value={`${typeof window === "undefined" ? "" : window.location.origin}${pairing.pairingPath}`} /><Link className="za-text-link" href={pairing.pairingPath}>OPEN PAIRING ↗</Link></div></> : <div className="za-empty-promo"><span className="za-promo-icon">02</span><Eyebrow>PAIR ONCE</Eyebrow><h2>Keep a vendor’s key on their device.</h2><p>The POS creates its own signing key. Vendor receipts cannot be forged by another device.</p></div>}</section>
    </div>
    <section className="za-panel za-table-panel"><div className="za-panel-heading"><div><Eyebrow>REGISTERED VENDORS</Eyebrow><h2>Vendors</h2></div><span>{program?.vendors.length ?? 0} vendors</span></div>{!program?.vendors.length ? <div className="za-empty">No vendors registered yet.</div> : <div className="za-simple-list">{program.vendors.map((vendor) => <div className="za-list-row" key={vendor.id}><span><b>{vendor.name}</b><small>{vendor.unifiedAddress}</small></span><Status value={vendor.publicKey ? "paired" : "unpaired"} /><span>{vendor.pairedAt ? "POS paired" : "Waiting for pairing"}</span></div>)}</div>}</section>
  </>;
}

export function SettlementsPage() {
  const [items, setItems] = useState<Settlement[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { void api<Settlement[]>("/api/settlements").then(setItems).catch((cause) => setError(cause.message)); }, []);
  return <>
    <PageHeader eyebrow="PAYMENT SETTLEMENTS" title="Receipts, reconciled." description="Offline receipts are checked against each card’s allowance and settled from the card account when funds are spendable." />
    {error && <div className="za-alert">{error}</div>}
    <section className="za-panel za-table-panel"><div className="za-panel-heading"><div><Eyebrow>ALL RECEIPTS</Eyebrow><h2>{items.length} recorded</h2></div><span>Oldest receipts settle first per card</span></div>{!items.length ? <div className="za-empty">No vendor receipts have reached the program yet.</div> : <div className="za-simple-list">{items.map((item) => <article className="za-list-row za-settlement-row" key={item.id}><span><b>{formatZec(item.amountZatoshis)} ZEC</b><small>{new Date(item.createdAt).toLocaleString()} · Card {item.cardId.slice(0, 8)}</small></span><Status value={item.status} />{item.txid ? <a className="za-mono-link" href={`https://testnet.zcashexplorer.app/transactions/${item.txid}`} target="_blank" rel="noreferrer">{item.txid.slice(0, 16)}… ↗</a> : <span className="za-muted">{item.reason ?? "Awaiting sync"}</span>}</article>)}</div>}</section>
  </>;
}

export function AuditPage() {
  const { program, loading } = useProgram();
  const [audit, setAudit] = useState<Array<{ id: string; kind: string; timestamp: string; detail: string }>>([]);
  const [statements, setStatements] = useState<Record<string, { accountName: string; transactions: Array<{ txid: string; minedHeight: number | null }>; viewingKey?: string }>>({});
  const [error, setError] = useState("");
  useEffect(() => { void api<typeof audit>("/api/audit").then(setAudit).catch((cause) => setError(cause.message)); }, []);
  async function loadStatement(id: string, reveal = false) {
    try {
      const result = await api<(typeof statements)[string]>(`/api/statements?accountId=${encodeURIComponent(id)}${reveal ? "&reveal=1" : ""}`);
      setStatements((current) => ({ ...current, [id]: result }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load statement."); }
  }
  if (loading) return <div className="za-loading">Loading audit…</div>;
  const accounts = [{ id: "treasury", name: "Treasury" }, ...(program?.cards.map((card) => ({ id: card.id, name: card.label })) ?? [])];
  return <>
    <PageHeader eyebrow="DONOR AUDIT" title="Verify the trail." description="Transactions are read from Zcash. Reveal a viewing key only when you choose to share it with an accountant or auditor." />
    {error && <div className="za-alert">{error}</div>}
    <div className="za-statement-list">{accounts.map((account) => <section className="za-panel" key={account.id}><div className="za-panel-heading"><div><Eyebrow>ACCOUNT STATEMENT</Eyebrow><h2>{account.name}</h2></div><button className="za-button za-button--small" onClick={() => loadStatement(account.id)}>LOAD TRANSACTIONS</button></div>{statements[account.id] ? <><div className="za-simple-list">{statements[account.id].transactions.map((tx) => <div className="za-list-row" key={tx.txid}><span><b>{tx.txid.slice(0, 20)}…</b><small>{tx.minedHeight ? `Mined at height ${tx.minedHeight}` : "Awaiting mining"}</small></span><a className="za-text-link" href={`https://testnet.zcashexplorer.app/transactions/${tx.txid}`} target="_blank" rel="noreferrer">VIEW ↗</a></div>)}</div>{statements[account.id].viewingKey ? <div className="za-key-reveal"><Eyebrow>UNIFIED FULL VIEWING KEY</Eyebrow><code>{statements[account.id].viewingKey}</code><CopyButton value={statements[account.id].viewingKey!} /></div> : <div className="za-inline-actions"><span className="za-muted">Share only with a trusted accountant or auditor.</span><button className="za-link-button" onClick={() => loadStatement(account.id, true)}>REVEAL VIEWING KEY</button></div>}</> : <div className="za-inline-actions"><span className="za-muted">Statement data comes from the account’s testnet transactions.</span><button className="za-link-button" onClick={() => loadStatement(account.id, true)}>REVEAL VIEWING KEY</button></div>}</section>)}</div>
    <section className="za-panel za-table-panel"><div className="za-panel-heading"><div><Eyebrow>PROGRAM AUDIT LOG</Eyebrow><h2>Operational record</h2></div><span>{audit.length} events</span></div>{!audit.length ? <div className="za-empty">No program events recorded yet.</div> : <div className="za-simple-list">{audit.map((event) => <div className="za-list-row" key={event.id}><span><b>{event.kind}</b><small>{new Date(event.timestamp).toLocaleString()}</small></span><span>{event.detail}</span></div>)}</div>}</section>
  </>;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<WalletSettings | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void api<WalletSettings>("/api/settings").then(setSettings).catch((cause) => setError(cause.message)); }, []);
  return <>
    <PageHeader eyebrow="PROGRAM SETTINGS" title="Program status." description="Technical connection details for this self-hosted ZecAid instance." />
    {error && <div className="za-alert">{error}</div>}
    {settings && <section className="za-panel za-settings"><div className="za-panel-heading"><div><Eyebrow>WALLET CONNECTION</Eyebrow><h2>Testnet readiness</h2></div><Status value={settings.ready ? "ready" : "needs-attention"} /></div><div className="za-detail-line"><span>Wallet adapter</span><b>zcash-devtool</b></div><div className="za-detail-line"><span>Network</span><b>Zcash testnet</b></div><div className="za-detail-line"><span>Lightwallet server</span><b>{settings.server}</b></div><div className="za-detail-line"><span>Binary path</span><code>{settings.binaryPath}</code></div><div className="za-detail-line"><span>Vault directory</span><code>{settings.vaultDir}</code></div><div className="za-detail-line"><span>Status</span><b>{settings.message ?? "Ready"}</b></div></section>}
  </>;
}
