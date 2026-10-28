import { spawn } from "node:child_process";
import { access, chmod, mkdir } from "node:fs/promises";
import path from "node:path";

import { ZCASH_TESTNET } from "../config";
import { ZecAidError } from "../errors";
import { zecToZatoshis } from "../money";
import type { WalletBalance } from "../types";

export const TESTNET_SERVER = ZCASH_TESTNET.lightwalletdServer;
export const TESTNET_NAME = ZCASH_TESTNET.cliNetwork;

export type DevtoolAccount = {
  uuid: string;
  name: string;
  ufvk: string | null;
};

export type DevtoolTransaction = {
  txid: string;
  minedHeight: number | null;
};

export type WalletStatus = {
  adapter: "zcash-devtool";
  network: "testnet";
  server: string;
  binaryPath: string;
  vaultDir: string;
  opened: boolean;
  ready: boolean;
  message: string | null;
};

export function parseBalanceOutput(output: string): WalletBalance {
  const parsed = JSON.parse(output.trim()) as Record<string, unknown>;
  const total = Number(parsed.total);
  const spendable = [
    parsed.sapling_spendable,
    parsed.orchard_spendable,
    parsed.ironwood_spendable,
    parsed.transparent_spendable,
  ].reduce<number>((sum, value) => sum + (Number(value) || 0), 0);
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(spendable)) {
    throw new Error("zcash-devtool returned an invalid balance.");
  }
  return {
    totalZatoshis: total,
    spendableZatoshis: spendable,
    chainHeight: Number(parsed.chain_tip_height) || null,
  };
}

export function parseAccountsOutput(output: string): DevtoolAccount[] {
  return output
    .split(/(?=^Account [0-9a-f-]+\b)/im)
    .map((block) => {
      const uuid = block.match(/^Account ([0-9a-f-]+)/im)?.[1];
      if (!uuid) return null;
      return {
        uuid,
        name: block.match(/^\s*Name: (.*)$/im)?.[1]?.trim() ?? "",
        ufvk: block.match(/^\s*UFVK: (\S+)$/im)?.[1] ?? null,
      };
    })
    .filter((account): account is DevtoolAccount => account !== null);
}

export function parseAddressOutput(output: string): string {
  const address = output.match(/^\s*Default Address: (\S+)\s*$/im)?.[1];
  if (!address) throw new Error("zcash-devtool did not return a unified address.");
  return address;
}

export function parseTransactionsOutput(output: string): DevtoolTransaction[] {
  const parsed = JSON.parse(output.trim()) as unknown;
  if (!Array.isArray(parsed)) throw new Error("zcash-devtool returned invalid transactions.");
  return parsed.map((entry) => {
    const item = entry as { txid?: unknown; mined_height?: unknown };
    if (typeof item.txid !== "string") {
      throw new Error("zcash-devtool returned a transaction without a txid.");
    }
    return {
      txid: item.txid,
      minedHeight: typeof item.mined_height === "number" ? item.mined_height : null,
    };
  });
}

export function parseFeeOutput(output: string): number {
  const fees = [...output.matchAll(/^\s*Fee:\s*(\d+(?:\.\d+)?)(?:\s+[A-Z]+)?\s*$/gim)];
  if (fees.length === 0) throw new Error("Could not read the fee from the transaction proposal.");
  return fees.reduce((sum, fee) => sum + zecToZatoshis(fee[1]), 0);
}

export function parseSendTxid(output: string): string {
  const txids = output.match(/[a-f0-9]{64}/gi);
  const txid = txids?.at(-1);
  if (!txid) throw new Error("zcash-devtool did not return a transaction ID.");
  return txid.toLowerCase();
}

export class DevtoolWallet {
  readonly id = "zcash-devtool";
  readonly network = "testnet" as const;
  readonly binaryPath: string;
  readonly vaultDir: string;
  readonly identityPath: string;
  private queue: Promise<unknown> = Promise.resolve();
  private syncInFlight: Promise<void> | null = null;
  private lastSyncAt = 0;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {
    this.binaryPath = env.ZECAID_DEVTOOL_BIN?.trim() || "zcash-devtool";
    this.vaultDir = path.resolve(
      env.ZECAID_VAULT_DIR?.trim() || path.join(process.cwd(), "data", "vault"),
    );
    this.identityPath = path.join(this.vaultDir, "identity.txt");
  }

  async status(): Promise<WalletStatus> {
    const opened = await this.pathExists(path.join(this.vaultDir, "keys.toml"));
    const binaryAvailable = await this.binaryAvailable();
    const message = !binaryAvailable
      ? "binary not found"
      : !opened
        ? "vault not opened"
        : null;
    return {
      adapter: this.id,
      network: "testnet",
      server: this.env.ZECAID_LIGHTWALLETD_SERVER?.trim() || TESTNET_SERVER,
      binaryPath: this.binaryPath,
      vaultDir: this.vaultDir,
      opened,
      ready: binaryAvailable && opened,
      message,
    };
  }

  async openProgram(): Promise<DevtoolAccount> {
    await mkdir(this.vaultDir, { recursive: true });
    if (!(await this.pathExists(path.join(this.vaultDir, "keys.toml")))) {
      await this.runWallet([
        "init",
        "--name",
        "Treasury",
        "--identity",
        this.identityPath,
        "--network",
        TESTNET_NAME,
        "--server",
        this.server,
      ], "\n");
    }
    if (await this.pathExists(this.identityPath)) {
      await chmod(this.identityPath, 0o600);
    }
    const accounts = await this.listAccounts();
    const treasury = accounts.find((account) => account.name === "Treasury") ?? accounts[0];
    if (!treasury) throw new ZecAidError("The opened program has no Treasury account.", 500);
    return treasury;
  }

  async generateAccount(name: string): Promise<DevtoolAccount> {
    await this.runWallet([
      "generate-account",
      "--name",
      name,
      "--identity",
      this.identityPath,
      "--server",
      this.server,
    ]);
    const account = (await this.listAccounts()).find((item) => item.name === name);
    if (!account) throw new ZecAidError("zcash-devtool created an account but did not list it.", 500);
    return account;
  }

  async listAccounts(): Promise<DevtoolAccount[]> {
    return parseAccountsOutput(await this.runWallet(["list-accounts"]));
  }

  async getAddress(accountUuid: string): Promise<string> {
    return parseAddressOutput(await this.runWallet(["list-addresses", accountUuid]));
  }

  async getBalance(accountUuid: string): Promise<WalletBalance> {
    return parseBalanceOutput(
      await this.runWallet(["balance", accountUuid, "--json"]),
    );
  }

  async getTransactions(accountUuid: string): Promise<DevtoolTransaction[]> {
    return parseTransactionsOutput(
      await this.runWallet(["list-tx", accountUuid, "--json"]),
    );
  }

  async estimateFee(
    accountUuid: string,
    to: string,
    amountZatoshis: number,
  ): Promise<number> {
    const output = await this.runWallet([
      "propose",
      accountUuid,
      "--address",
      to,
      "--value",
      String(amountZatoshis),
    ]);
    return parseFeeOutput(output);
  }

  async getViewingKey(accountUuid: string): Promise<string> {
    const account = (await this.listAccounts()).find((item) => item.uuid === accountUuid);
    if (!account?.ufvk || account.ufvk === "None") {
      throw new ZecAidError("No unified full viewing key is available for this account.", 404);
    }
    return account.ufvk;
  }

  async getChainHeight(): Promise<number | null> {
    const output = await this.runWallet(["get-info", "--server", this.server]);
    const parsed = JSON.parse(output.trim()) as { chain_tip_height?: unknown };
    return typeof parsed.chain_tip_height === "number" ? parsed.chain_tip_height : null;
  }

  async sync(force = false): Promise<void> {
    if (this.syncInFlight) return this.syncInFlight;
    if (!force && Date.now() - this.lastSyncAt < 30_000) return;
    this.syncInFlight = (async () => {
      await this.runWallet(["sync", "--server", this.server]);
      this.lastSyncAt = Date.now();
    })();
    try {
      await this.syncInFlight;
    } finally {
      this.syncInFlight = null;
    }
  }

  async send(
    accountUuid: string,
    to: string,
    amountZatoshis: number,
    memo: string,
  ): Promise<string> {
    await this.sync(true);
    try {
      return await this.sendOnce(accountUuid, to, amountZatoshis, memo);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/Insufficient balance \(have 0/i.test(message)) throw error;
      await this.sync(true);
      return this.sendOnce(accountUuid, to, amountZatoshis, memo);
    }
  }

  private async sendOnce(
    accountUuid: string,
    to: string,
    amountZatoshis: number,
    memo: string,
  ): Promise<string> {
    const output = await this.runWallet([
      "send",
      accountUuid,
      "--identity",
      this.identityPath,
      "--address",
      to,
      "--value",
      String(amountZatoshis),
      "--memo",
      memo.slice(0, 500),
      "--server",
      this.server,
    ]);
    return parseSendTxid(output);
  }

  private get server(): string {
    return this.env.ZECAID_LIGHTWALLETD_SERVER?.trim() || TESTNET_SERVER;
  }

  private async runWallet(args: string[], stdin = ""): Promise<string> {
    return this.serial(() => this.execute(["wallet", "--wallet-dir", this.vaultDir, ...args], stdin));
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action, action);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async execute(args: string[], stdin: string): Promise<string> {
    if (!(await this.binaryAvailable())) {
      throw new ZecAidError(`binary not found: ${this.binaryPath}`, 503);
    }
    return new Promise((resolve, reject) => {
      const child = spawn(this.binaryPath, args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill("SIGTERM"), 180_000);
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new ZecAidError(`Could not start zcash-devtool: ${error.message}`, 503));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else {
          const detail = (stderr || stdout).replace(/\u001b\[[0-9;]*m/g, "").trim();
          const message = /insufficient|spendable|not enough/i.test(detail)
            ? `insufficient spendable — notes need confirmations. ${detail}`
            : detail || `zcash-devtool exited with code ${code}`;
          reject(new ZecAidError(message, 502));
        }
      });
      child.stdin.end(stdin);
    });
  }

  private async binaryAvailable(): Promise<boolean> {
    if (this.binaryPath.includes(path.sep)) return this.pathExists(path.resolve(this.binaryPath));
    for (const directory of (this.env.PATH ?? "").split(path.delimiter)) {
      if (directory && (await this.pathExists(path.join(directory, this.binaryPath)))) return true;
    }
    return false;
  }

  private async pathExists(target: string): Promise<boolean> {
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
  }
}
