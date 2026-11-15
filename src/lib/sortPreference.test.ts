// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSortByStatus, setSortByStatus } from "./sortPreference";

describe("sortPreference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("vaut faux par défaut, et pour toute valeur autre que « true »", () => {
    expect(getSortByStatus()).toBe(false);
    for (const raw of ["false", "1", "on", ""]) {
      localStorage.setItem("omq:sort-by-status", raw);
      expect(getSortByStatus()).toBe(false);
    }
  });

  it("lit « true »", () => {
    localStorage.setItem("omq:sort-by-status", "true");
    expect(getSortByStatus()).toBe(true);
  });

  it("vaut faux si localStorage lève", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(getSortByStatus()).toBe(false);
    spy.mockRestore();
  });

  it("persiste « true » / « false »", () => {
    setSortByStatus(true);
    expect(localStorage.getItem("omq:sort-by-status")).toBe("true");
    setSortByStatus(false);
    expect(localStorage.getItem("omq:sort-by-status")).toBe("false");
  });

  it("ne lève pas si localStorage.setItem lève", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => setSortByStatus(true)).not.toThrow();
    spy.mockRestore();
  });
});
