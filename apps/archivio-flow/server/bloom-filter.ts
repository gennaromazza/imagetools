import { createHash } from "node:crypto";

export interface SerializedBloomFilter {
  algorithm: "sha256-double-hash-v1";
  bitCount: number;
  hashCount: number;
  itemCount: number;
  bitsBase64: string;
}

function positions(value: string, bitCount: number, hashCount: number): number[] {
  const digest = createHash("sha256").update(value).digest();
  const first = digest.readUInt32BE(0);
  const second = digest.readUInt32BE(4) || 0x9e3779b9;
  return Array.from({ length: hashCount }, (_, index) => (first + index * second + index * index) % bitCount);
}

export function createBloomFilter(values: string[], requestedBits = 8192, hashCount = 5): SerializedBloomFilter {
  const bitCount = Math.max(256, Math.ceil(requestedBits / 8) * 8);
  const bits = Buffer.alloc(bitCount / 8);
  for (const value of values) {
    for (const position of positions(value, bitCount, hashCount)) bits[Math.floor(position / 8)]! |= 1 << (position % 8);
  }
  return { algorithm:"sha256-double-hash-v1", bitCount, hashCount, itemCount:values.length, bitsBase64:bits.toString("base64") };
}

export function bloomMayContain(filter: SerializedBloomFilter, value: string): boolean {
  const bits = Buffer.from(filter.bitsBase64, "base64");
  return positions(value, filter.bitCount, filter.hashCount).every((position) => (bits[Math.floor(position / 8)]! & (1 << (position % 8))) !== 0);
}
