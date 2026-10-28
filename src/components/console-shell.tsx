"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore, type ReactNode } from "react";
import {
  BadgeDollarSign,
  ChevronLeft,
  CreditCard,
  LayoutDashboard,
  ReceiptText,
  ScrollText,
  Settings,
  Store,
} from "lucide-react";

import { ConnectWalletButton, WalletProvider } from "./noir-wallet";

const links = [
  { href: "/console", label: "Overview", icon: LayoutDashboard },
  { href: "/console/cards", label: "Cards", icon: CreditCard },
  { href: "/console/vendors", label: "Vendors", icon: Store },
  { href: "/console/settlements", label: "Settlements", icon: ReceiptText },
  { href: "/console/audit", label: "Audit", icon: ScrollText },
  { href: "/console/settings", label: "Settings", icon: Settings },
];

function subscribeSidebar(callback: () => void) {
  window.addEventListener("zecaid-sidebar", callback);
  return () => window.removeEventListener("zecaid-sidebar", callback);
}

export function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(
    subscribeSidebar,
    () => localStorage.getItem("zecaid-console-collapsed") === "true",
    () => false,
  );

  function toggleSidebar() {
    localStorage.setItem("zecaid-console-collapsed", String(!collapsed));
    window.dispatchEvent(new Event("zecaid-sidebar"));
  }

  if (pathname.endsWith("/print")) {
    return <div className="za-print-layout">{children}</div>;
  }

  return (
    <WalletProvider>
    <div className={`za-console ${collapsed ? "is-collapsed" : ""}`}>
      <aside className="za-sidebar">
        <Link className="za-console-brand" href="/console" aria-label="ZecAid console">
          <span className="za-mark">z</span><span className="za-brand-name">ZecAid</span>
        </Link>
        <button className="za-sidebar-toggle" onClick={toggleSidebar} aria-label="Collapse sidebar">
          <ChevronLeft size={16} />
        </button>
        <p className="za-sidebar-label">PROGRAM</p>
        <nav>
          {links.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== "/console" && pathname.startsWith(`${href}/`));
            return (
              <Link className={active ? "active" : ""} href={href} key={href} title={label}>
                <Icon size={17} strokeWidth={1.7} /><span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="za-sidebar-bottom">
          <div className="za-program-mark"><BadgeDollarSign size={17} /><span>Shielded aid<br />on Zcash testnet</span></div>
          <Link href="/pos" className="za-pos-link">OPEN VENDOR POS ↗</Link>
        </div>
      </aside>
      <div className="za-console-main">
        <header className="za-console-topbar">
          <span>NGO CONSOLE <i>·</i> ZCASH TESTNET</span>
          <div className="za-console-tools">
            <ConnectWalletButton />
            <Link href="/pos">VENDOR APP <b>↗</b></Link>
          </div>
        </header>
        <div className="za-console-content">{children}</div>
      </div>
    </div>
    </WalletProvider>
  );
}
