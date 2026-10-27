import { describe, expect, it } from "vitest";

import {
  parseAccountsOutput,
  parseBalanceOutput,
  parseFeeOutput,
  parseSendTxid,
  parseTransactionsOutput,
} from "./devtool";

const accountOutput = `Account 8796dcfb-10e8-4143-a7e9-f98a6488448b (birthday height 4548626)
     Name: Treasury
     UIVK: [REDACTED]
     UFVK: [REDACTED]
     Source: derived
       Seed fingerprint: [REDACTED]
       Account index: 0`;

describe("zcash-devtool output parsers", () => {
  it("parses a real testnet balance JSON response after faucet funding", () => {
    const balance = parseBalanceOutput(
      '{"chain_tip_height":4548736,"ironwood_spendable":0,"orchard_spendable":0,"sapling_spendable":0,"total":100000000,"transparent_spendable":0}',
    );
    expect(balance).toEqual({
      totalZatoshis: 100_000_000,
      spendableZatoshis: 0,
      chainHeight: 4548736,
    });
  });

  it("parses account identity while keeping key material redacted", () => {
    expect(parseAccountsOutput(accountOutput)).toEqual([{
      uuid: "8796dcfb-10e8-4143-a7e9-f98a6488448b",
      name: "Treasury",
      ufvk: "[REDACTED]",
    }]);
  });

  it("parses a real faucet transaction from list-tx JSON", () => {
    expect(parseTransactionsOutput(
      '[{"mined_height":4548731,"txid":"af99f7e8ab76d9a02e0d5330ec2a9ae18d7bafc74010e40bb673ede6fb5f0a8d"}]',
    )).toEqual([{
      txid: "af99f7e8ab76d9a02e0d5330ec2a9ae18d7bafc74010e40bb673ede6fb5f0a8d",
      minedHeight: 4548731,
    }]);
  });

  it("parses the fee from a real transaction proposal", () => {
    expect(parseFeeOutput("Proposal:\n  Fee:   0.00025000 TAZ\n")).toBe(25_000);
  });

  it("extracts the final transaction ID line printed by send", () => {
    expect(parseSendTxid(
      "Sending transaction...\naf99f7e8ab76d9a02e0d5330ec2a9ae18d7bafc74010e40bb673ede6fb5f0a8d\n",
    )).toBe("af99f7e8ab76d9a02e0d5330ec2a9ae18d7bafc74010e40bb673ede6fb5f0a8d");
  });
});
