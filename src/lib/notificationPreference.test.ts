// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNotificationPreference, setNotificationPreference } from "./notificationPreference";

describe("notificationPreference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("vaut faux par défaut, et pour toute valeur autre que « true »", () => {
    expect(getNotificationPreference()).toBe(false);
    for (const raw of ["false", "1", "on", ""]) {
      localStorage.setItem("omq:notifications", raw);
      expect(getNotificationPreference()).toBe(false);
    }
  });

  it("lit « true »", () => {
    localStorage.setItem("omq:notifications", "true");
    expect(getNotificationPreference()).toBe(true);
  });

  it("vaut faux si localStorage lève", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(getNotificationPreference()).toBe(false);
    spy.mockRestore();
  });

  it("persiste « true » / « false »", () => {
    setNotificationPreference(true);
    expect(localStorage.getItem("omq:notifications")).toBe("true");
    setNotificationPreference(false);
    expect(localStorage.getItem("omq:notifications")).toBe("false");
  });

  it("ne lève pas si localStorage.setItem lève", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => setNotificationPreference(true)).not.toThrow();
    spy.mockRestore();
  });
});
