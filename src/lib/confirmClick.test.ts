// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireConfirmClick } from "./confirmClick";

describe("wireConfirmClick", () => {
  let button: HTMLButtonElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    button = document.createElement("button");
    button.setAttribute("aria-label", "Supprimer");
    document.body.appendChild(button);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("le premier clic arme le bouton sans confirmer", () => {
    const onConfirm = vi.fn();
    wireConfirmClick(button, { armedLabel: "Confirmer ?", onConfirm });
    button.click();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(button.classList.contains("confirm-armed")).toBe(true);
    expect(button.getAttribute("aria-label")).toBe("Confirmer ?");
  });

  it("le second clic confirme et désarme", () => {
    const onConfirm = vi.fn();
    wireConfirmClick(button, { armedLabel: "Confirmer ?", onConfirm });
    button.click();
    button.click();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(button.classList.contains("confirm-armed")).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("Supprimer");
  });

  it("se désarme au bout de 3 s par défaut, exactement, sans confirmer", () => {
    const onConfirm = vi.fn();
    wireConfirmClick(button, { armedLabel: "Confirmer ?", onConfirm });
    button.click();
    vi.advanceTimersByTime(2999);
    expect(button.classList.contains("confirm-armed")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(button.classList.contains("confirm-armed")).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("Supprimer");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("respecte un délai personnalisé", () => {
    wireConfirmClick(button, { onConfirm: vi.fn(), timeoutMs: 500 });
    button.click();
    vi.advanceTimersByTime(499);
    expect(button.classList.contains("confirm-armed")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(button.classList.contains("confirm-armed")).toBe(false);
  });

  it("un clic après expiration réarme au lieu de confirmer", () => {
    const onConfirm = vi.fn();
    wireConfirmClick(button, { onConfirm, timeoutMs: 3000 });
    button.click();
    vi.advanceTimersByTime(3000);
    button.click();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(button.classList.contains("confirm-armed")).toBe(true);
  });

  it("la confirmation annule le minuteur : un réarmement garde son propre délai", () => {
    wireConfirmClick(button, { onConfirm: vi.fn(), timeoutMs: 3000 });
    button.click();
    vi.advanceTimersByTime(1000);
    button.click();
    button.click();
    vi.advanceTimersByTime(2500);
    expect(button.classList.contains("confirm-armed")).toBe(true);
    vi.advanceTimersByTime(500);
    expect(button.classList.contains("confirm-armed")).toBe(false);
  });

  it("sans armedLabel ni aria-label d'origine, ne touche pas à l'aria-label", () => {
    button.removeAttribute("aria-label");
    wireConfirmClick(button, { onConfirm: vi.fn(), timeoutMs: 3000 });
    button.click();
    expect(button.hasAttribute("aria-label")).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(button.hasAttribute("aria-label")).toBe(false);
  });

  it("ne pose pas d'aria-label au désarmement si le bouton n'en avait pas au départ", () => {
    button.removeAttribute("aria-label");
    wireConfirmClick(button, { armedLabel: "Confirmer ?", onConfirm: vi.fn(), timeoutMs: 3000 });
    button.click();
    expect(button.getAttribute("aria-label")).toBe("Confirmer ?");
    vi.advanceTimersByTime(3000);
    expect(button.getAttribute("aria-label")).toBe("Confirmer ?");
  });

  it("le clic ne remonte pas au parent", () => {
    const parentClick = vi.fn();
    document.body.addEventListener("click", parentClick);
    wireConfirmClick(button, { onConfirm: vi.fn() });
    button.click();
    button.click();
    expect(parentClick).not.toHaveBeenCalled();
  });
});
