import { describe, expect, it } from "vitest";
import { installInsecureContextCrypto, sha256, uuid4 } from "./insecureContext";

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

describe("crypto on a page the browser calls insecure", () => {
  it("hashes like the browser's SHA-256, across block boundaries", async () => {
    expect(hex(sha256(new Uint8Array()))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(hex(sha256(new TextEncoder().encode("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    for (const length of [55, 56, 63, 64, 65, 119, 120, 1000]) {
      const data = Uint8Array.from({ length }, (_, i) => (i * 31 + 7) & 0xff);
      expect(hex(sha256(data))).toBe(hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data))));
    }
  });

  it("makes version 4 UUIDs", () => {
    expect(uuid4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuid4()).not.toBe(uuid4());
  });

  it("supplies only what the browser withheld", async () => {
    const bare = { getRandomValues: crypto.getRandomValues.bind(crypto) } as unknown as Crypto;
    installInsecureContextCrypto(bare);
    expect(bare.randomUUID()).toMatch(/^[0-9a-f-]{36}$/);
    const digest = await bare.subtle.digest("SHA-256", new TextEncoder().encode("abc"));
    expect(hex(new Uint8Array(digest))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    await expect(bare.subtle.digest("SHA-1", new Uint8Array())).rejects.toThrow();
    const real = crypto.randomUUID;
    installInsecureContextCrypto();
    expect(crypto.randomUUID).toBe(real);
  });
});
