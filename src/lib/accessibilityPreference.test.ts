// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyAccessibilityPreference, getAccessibilityPreference, setAccessibilityPreference } from "./accessibilityPreference";

describe("accessibilityPreference", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-a11y");
  });

  it("vaut faux par défaut, et pour toute valeur autre que « true »", () => {
    expect(getAccessibilityPreference()).toBe(false);
    for (const raw of ["false", "1", "on", ""]) {
      localStorage.setItem("omq:a11y", raw);
      expect(getAccessibilityPreference()).toBe(false);
    }
  });

  it("lit « true »", () => {
    localStorage.setItem("omq:a11y", "true");
    expect(getAccessibilityPreference()).toBe(true);
  });

  it("vaut faux si localStorage lève", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(getAccessibilityPreference()).toBe(false);
    spy.mockRestore();
  });

  it("apply pose ou retire l'attribut data-a11y", () => {
    applyAccessibilityPreference(true);
    expect(document.documentElement.hasAttribute("data-a11y")).toBe(true);
    applyAccessibilityPreference(false);
    expect(document.documentElement.hasAttribute("data-a11y")).toBe(false);
  });

  it("set persiste (« true » / « false ») et applique", () => {
    setAccessibilityPreference(true);
    expect(localStorage.getItem("omq:a11y")).toBe("true");
    expect(document.documentElement.hasAttribute("data-a11y")).toBe(true);
    setAccessibilityPreference(false);
    expect(localStorage.getItem("omq:a11y")).toBe("false");
    expect(document.documentElement.hasAttribute("data-a11y")).toBe(false);
  });

  it("set applique quand même si localStorage lève", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => setAccessibilityPreference(true)).not.toThrow();
    expect(document.documentElement.hasAttribute("data-a11y")).toBe(true);
    spy.mockRestore();
  });
});
