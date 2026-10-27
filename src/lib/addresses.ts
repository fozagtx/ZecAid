export const UNIFIED_ADDRESS_PATTERN = /^utest1[a-z0-9]+$/;

export function isUnifiedAddress(value: string): boolean {
  return UNIFIED_ADDRESS_PATTERN.test(value);
}
