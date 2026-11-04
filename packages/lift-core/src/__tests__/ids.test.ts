import { describe, expect, it } from "vitest";
import { customExerciseId, nameKey, sha256Hex } from "../ids";

describe("sha256Hex", () => {
  it.each([
    ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
    // 56 bytes: padding spills into a second block
    ["abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"],
    ["a".repeat(1000), "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3"],
    ["💪🏋️‍♀️", "0167ff7b4b5fa53e86a2307911ed4d8f373a6fe897afef6db62548bb57ed83ad"],
    ["Жим лёжа", "07873c02a20bf4ef9416486a738b252f87ebf8209897904b90ae05d31cf60603"],
    // lone surrogate encodes as U+FFFD
    ["\ud800x", "a87ce46793cc659b79bd187e998f8488635f707d5be0957e1d565981efd2b04b"],
  ])("%j", (input, hex) => {
    expect(sha256Hex(input)).toBe(hex);
  });

  it("is lowercase 64-char hex", () => {
    expect(sha256Hex("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("nameKey", () => {
  it("uses normalizeName for latin names", () => {
    expect(nameKey("  Bench Press (Barbell) ")).toBe("bench press barbell");
    expect(nameKey("Farmer's Walk")).toBe("farmers walk");
    expect(nameKey("Café Row")).toBe("cafe row");
  });

  it("falls back to the nfkc-lowercased raw name for non-latin names", () => {
    expect(nameKey("Жим Лёжа ")).toBe("жим лёжа");
    expect(nameKey("深蹲")).toBe("深蹲");
  });

  it("is empty for blank input", () => {
    expect(nameKey("   ")).toBe("");
  });
});

describe("customExerciseId", () => {
  it("is custom- plus 12 hex of the name key hash", () => {
    expect(customExerciseId("My Weird Curl")).toBe("custom-62c0a1a29d9c");
    expect(customExerciseId("my  weird curl!")).toBe("custom-62c0a1a29d9c");
    expect(customExerciseId("Жим лёжа")).toBe("custom-bca82a171ce9");
    expect(customExerciseId("深蹲")).toBe("custom-14906fe65951");
  });

  it("differs for different names", () => {
    expect(customExerciseId("Curl A")).not.toBe(customExerciseId("Curl B"));
  });
});
