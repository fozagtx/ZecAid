import { ZecAidService } from "../service";
import { FileStore } from "../store/file-store";
import { DevtoolWallet } from "../wallet/devtool";

const globalForApp = globalThis as typeof globalThis & {
  __zecaid?: ZecAidService;
};

export function getService(): ZecAidService {
  if (!globalForApp.__zecaid) {
    globalForApp.__zecaid = new ZecAidService(
      new FileStore(),
      new DevtoolWallet(),
    );
  }
  return globalForApp.__zecaid;
}
