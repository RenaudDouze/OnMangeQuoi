import { describe, expect, it } from "vitest";
import { uid } from "./id";

describe("id", () => {
  it("uid renvoie un UUID différent à chaque appel", () => {
    expect(uid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uid()).not.toBe(uid());
  });
});
