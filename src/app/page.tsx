import Link from "next/link";

export default function HomePage() {
  return (
    <main className="za-landing">
      <section className="za-hero">
        <div className="za-hero-photo" />
        <div className="za-hero-shade" />
        <header className="za-nav">
          <Link href="/" className="za-wordmark"><span className="za-mark">z</span> zecaid</Link>
          <nav aria-label="Main navigation">
            <a href="#how-it-works">HOW IT WORKS</a>
            <a href="#trust">TRUST & PRIVACY</a>
          </nav>
          <Link className="za-nav-cta" href="/console">OPEN THE CONSOLE <span>↗</span></Link>
        </header>
        <div className="za-hero-copy">
          <p className="za-eyebrow">PRIVATE AID · PUBLIC ACCOUNTABILITY</p>
          <h1>Aid that works<br />without a signal.</h1>
          <p>Give every family a private allowance card on Zcash. Vendors accept it offline. Payments settle shielded when they reconnect.</p>
          <div className="za-hero-actions">
            <Link className="za-button za-button--light" href="/console">OPEN THE CONSOLE <span>↗</span></Link>
            <Link className="za-button za-button--outline" href="/pos">VENDOR APP <span>↗</span></Link>
          </div>
        </div>
        <div className="za-hero-footer"><span>OFFLINE AT THE MARKET</span><span>SHIELDED ON THE CHAIN</span></div>
      </section>
      <section className="za-story" id="how-it-works">
        <div>
          <p className="za-eyebrow">A PRACTICAL WAY TO DELIVER AID</p>
          <h2>Private for families.<br /><em>Clear for donors.</em></h2>
          <p className="za-story-lead">One printed card gives a family a defined allowance. Local vendors can accept it without a live connection; real Zcash payments settle when they reconnect.</p>
        </div>
        <div className="za-steps">
          <article><span>01 / THE PROGRAM</span><h3>Set an allowance.</h3><p>The NGO funds each card account and sets its limit and expiry.</p></article>
          <article><span>02 / THE MARKET</span><h3>Accept offline.</h3><p>Vendors verify the signed card and PIN on a paired device, then queue a signed receipt.</p></article>
          <article><span>03 / SETTLEMENT</span><h3>Reconnect to settle.</h3><p>Receipts become shielded testnet payments to vendors, with a donor audit trail.</p></article>
        </div>
      </section>
      <section className="za-trust" id="trust">
        <span className="za-eyebrow">TRUST & PRIVACY</span>
        <p>Allowance limits are checked at settlement. Offline vendors can accept the same card before learning about one another; the program catches overspend and freezes that card when it reconnects.</p>
        <Link href="/console">OPEN THE CONSOLE <span>↗</span></Link>
      </section>
      <footer className="za-footer"><Link href="/" className="za-wordmark"><span className="za-mark">z</span> zecaid</Link><span>OFFLINE AID ALLOWANCE CARDS ON ZCASH</span><Link href="/pos">VENDOR APP ↗</Link></footer>
    </main>
  );
}
