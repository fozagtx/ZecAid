# ZecAid — offline aid allowance cards on Zcash

ZecAid is a ZECATHON Shielded Payments project for delivering private aid allowances through cards that vendors can accept without a network connection. The NGO funds each card account with real Zcash testnet funds; vendors store signed receipts offline and settle them as shielded payments when they reconnect.

There are no preloaded recipients, balances, vendors, or transactions. Until the testnet wallet is opened and funded, the console shows honest empty states.

## Trust model

- The NGO operates the self-hosted server and holds the Treasury and allowance-account keys in its local `data/vault`. Card accounts are individually created and funded by the NGO. Recipients do not hold wallet keys.
- The NGO server signs each card’s allowance, expiry, and PIN verifier. A vendor POS checks that signature, the testnet network, expiry, local revocation snapshot, remaining allowance, and the six-digit PIN before saving a vendor-signed receipt.
- Offline acceptance cannot coordinate across vendors. The same card could be presented to two disconnected POS devices. At settlement, the server processes receipts in creation order, enforces the card’s cumulative allowance, rejects an overdraft, and freezes that card for later POS syncs. A freeze cannot undo a transaction already broadcast.
- The six-digit PIN is derived with scrypt (`N=2^14`, `r=8`, `p=1`). The verifier is part of the printed QR payload, so someone holding a copy of that QR can try all PINs offline. The PIN is not a strong cryptographic secret; recipients should keep the printed card private and never write the PIN on it.
- Vendor signing keys are created in the browser and stored in that POS device’s IndexedDB. They are not encrypted with a separate passphrase. A compromised vendor device can sign receipts as that vendor.
- Donors can inspect on-chain statements with an explicitly revealed unified full viewing key. Share a viewing key only with a trusted accountant or auditor; it reveals the account’s transaction history to its recipient.
- The NGO console is intended to run on a trusted, self-hosted network. This prototype does not add user login or role-based access, so do not expose its console or API to an untrusted public network.
- This is a testnet prototype. Testnet ZEC has no monetary value, and the file-backed program store is designed for one self-hosted instance, not high-availability production use.

## Setup

1. Build `zcash-devtool` from its source repository with Rust installed:

   ```sh
   cargo build --release
   ```

2. From the ZecAid repository, install dependencies and start the app:

   ```sh
   pnpm install
   ZECAID_DEVTOOL_BIN=/absolute/path/to/zcash-devtool pnpm dev
   ```

   The app listens at [http://127.0.0.1:43124](http://127.0.0.1:43124). `ZECAID_DEVTOOL_BIN` is optional if `zcash-devtool` is on `PATH`.

3. Open [http://127.0.0.1:43124/console](http://127.0.0.1:43124/console) and choose **Open program**. This initializes the testnet Treasury and the NGO card-signing key. The default network is Zcash testnet (`zecrocks`, `testnet.zec.rocks`).

4. Fund the Treasury’s displayed unified address with testnet ZEC. The console links to [Fauzec](https://fauzec.com/). Refresh from chain and wait for confirmations before issuing allowance cards.

5. In **Cards**, issue an allowance with a recipient label, amount, and expiry. The app creates a separate account, sends the allowance plus a 0.001 ZEC fee reserve from Treasury, and displays a random six-digit PIN once. Keep the PIN separate from the printed card.

6. In **Vendors**, register the vendor’s testnet unified address. Open the one-time pairing link on the vendor’s device while online; the POS creates and stores its signing key locally. Load `/pos` once while online so the shell and a fresh revocation/spending snapshot are cached.

7. On `/pos`, enter an amount, scan the card QR or paste its payload, and enter the recipient’s PIN. The POS checks the signature, expiry, revocation snapshot, PIN, and remaining local allowance. Offline charges remain on that device until **Sync** or the next connection.

8. In **Settlements**, follow each real transaction ID and wait for testnet confirmation. A card whose funds are not yet spendable remains `awaiting_funds` and is retried on the next refresh or vendor sync. **Audit** shows real account transactions and offers an explicit viewing-key reveal action.

To use another wallet binary, vault directory, or lightwalletd endpoint, set `ZECAID_DEVTOOL_BIN`, `ZECAID_VAULT_DIR`, or `ZECAID_LIGHTWALLETD_SERVER`. Defaults and setup values are also listed in `.env.example`. Wallet files, the NGO signing key, and program data stay under the ignored `data/` directory.

## Limitations

- `/pos` must be loaded online once to cache its shell and obtain its first signed vendor snapshot. The first load or pairing cannot happen offline.
- A revocation that happens after a POS last synced is not visible to that offline device. Settlement is authoritative and may reject its receipt.
- The PIN verifier in the QR can be brute-forced offline; scrypt makes guesses more expensive but cannot make a six-digit PIN strong.
- Settlement needs the card account’s real spendable notes and transaction fees. If funds are unconfirmed or not spendable, receipts wait rather than receiving a simulated txid.
- This prototype has not been audited for production custody, privacy, or financial use.
- The NGO console and its APIs do not have user authentication; protect the host with an appropriate network boundary.

Landing photography: Alina Degli via Unsplash, used under the Unsplash License.
