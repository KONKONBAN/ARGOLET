// Web Crypto random source for @noble/hashes on Hermes (iOS / Android).
import { getRandomValues } from 'expo-crypto';

const g = globalThis as unknown as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
if (!g.crypto) g.crypto = {};
if (!g.crypto.getRandomValues) {
  g.crypto.getRandomValues = (arr: Uint8Array) => getRandomValues(arr) as Uint8Array;
}
