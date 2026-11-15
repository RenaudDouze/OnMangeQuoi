// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cacheListState, forgetRecentList, getCachedListState, getRecentLists, touchRecentList } from "./storage";
import type { ListState } from "../../shared/types";

const sampleState: ListState = { code: "ABCDEF", name: "Semaine", meals: [], archive: [], createdAt: 0, updatedAt: 0 };

describe("storage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  describe("listes récentes", () => {
    it("est vide au départ", () => {
      expect(getRecentLists()).toEqual([]);
    });

    it("mémorise sous « omq:recent », la plus récemment ouverte d'abord", () => {
      vi.useFakeTimers();
      vi.setSystemTime(1000);
      touchRecentList("AAAAAA", "Un");
      vi.setSystemTime(2000);
      touchRecentList("BBBBBB", "Deux");
      expect(getRecentLists()).toEqual([
        { code: "BBBBBB", name: "Deux", lastOpened: 2000 },
        { code: "AAAAAA", name: "Un", lastOpened: 1000 },
      ]);
      expect(JSON.parse(localStorage.getItem("omq:recent")!)).toHaveLength(2);
    });

    it("rouvrir une liste la remonte sans doublon et met à jour son nom", () => {
      vi.useFakeTimers();
      vi.setSystemTime(1000);
      touchRecentList("AAAAAA", "Un");
      vi.setSystemTime(2000);
      touchRecentList("BBBBBB", "Deux");
      vi.setSystemTime(3000);
      touchRecentList("AAAAAA", "Un bis");
      expect(getRecentLists()).toEqual([
        { code: "AAAAAA", name: "Un bis", lastOpened: 3000 },
        { code: "BBBBBB", name: "Deux", lastOpened: 2000 },
      ]);
    });

    it("trie à la lecture même si le stockage est désordonné", () => {
      localStorage.setItem("omq:recent", JSON.stringify([{ code: "A", name: "a", lastOpened: 1 }, { code: "B", name: "b", lastOpened: 5 }, { code: "C", name: "c", lastOpened: 3 }]));
      expect(getRecentLists().map((l) => l.code)).toEqual(["B", "C", "A"]);
    });

    it("garde au plus 20 listes (les plus récentes)", () => {
      vi.useFakeTimers();
      for (let i = 0; i < 22; i++) {
        vi.setSystemTime(1000 + i);
        touchRecentList(`C${i}`, `n${i}`);
      }
      const recents = getRecentLists();
      expect(recents).toHaveLength(20);
      expect(recents[0].code).toBe("C21");
      expect(recents[19].code).toBe("C2");
    });

    it("oublier une liste ne retire qu'elle", () => {
      touchRecentList("AAAAAA", "Un");
      touchRecentList("BBBBBB", "Deux");
      forgetRecentList("AAAAAA");
      expect(getRecentLists().map((l) => l.code)).toEqual(["BBBBBB"]);
    });

    it.each([["pas du json"], ["null"], [""]])("tolère un stockage corrompu (%j)", (raw) => {
      localStorage.setItem("omq:recent", raw);
      expect(getRecentLists()).toEqual([]);
    });

    it("ne lève pas si localStorage.setItem lève", () => {
      const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota");
      });
      expect(() => touchRecentList("AAAAAA", "Un")).not.toThrow();
      expect(() => forgetRecentList("AAAAAA")).not.toThrow();
      set.mockRestore();
    });
  });

  describe("cache de liste", () => {
    it("relit exactement l'état mis en cache, sous « omq:cache:CODE »", () => {
      cacheListState(sampleState);
      expect(getCachedListState("ABCDEF")).toEqual(sampleState);
      expect(localStorage.getItem("omq:cache:ABCDEF")).not.toBeNull();
    });

    it("renvoie null sans cache ou avec un cache corrompu", () => {
      expect(getCachedListState("ABCDEF")).toBeNull();
      localStorage.setItem("omq:cache:ABCDEF", "{ pas du json");
      expect(getCachedListState("ABCDEF")).toBeNull();
      localStorage.setItem("omq:cache:ABCDEF", "");
      expect(getCachedListState("ABCDEF")).toBeNull();
    });

    it("ne lève pas si localStorage.setItem lève", () => {
      const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota");
      });
      expect(() => cacheListState(sampleState)).not.toThrow();
      set.mockRestore();
    });
  });
});
