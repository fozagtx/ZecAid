/** 1 ZEC = 10^8 zatoshis. Amounts stay integers so the policy math does not drift. */
export const ZATOSHIS_PER_ZEC = 100_000_000;

const ZEC_SUPPLY_ZATOSHIS = 21_000_000 * ZATOSHIS_PER_ZEC;

export function zecToZatoshis(zec: string | number): number {
  const raw = typeof zec === "number" ? String(zec) : zec.trim();
  if (!/^\d+(\.\d{1,8})?$/.test(raw)) {
    throw new Error(
      `Invalid ZEC amount "${raw}". Use up to 8 decimal places, for example 0.25.`,
    );
  }
  const [whole, frac = ""] = raw.split(".");
  const padded = (frac + "00000000").slice(0, 8);
  const zatoshis = Number(whole) * ZATOSHIS_PER_ZEC + Number(padded);
  if (!Number.isSafeInteger(zatoshis) || zatoshis > ZEC_SUPPLY_ZATOSHIS) {
    throw new Error("ZEC amount is out of range.");
  }
  return zatoshis;
}

export function formatZec(zatoshis: number): string {
  const sign = zatoshis < 0 ? "-" : "";
  const abs = Math.abs(zatoshis);
  const whole = Math.floor(abs / ZATOSHIS_PER_ZEC);
  const frac = String(abs % ZATOSHIS_PER_ZEC)
    .padStart(8, "0")
    .replace(/0+$/, "");
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}
