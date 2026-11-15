// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { escapeHtml, onActivate, trapFocus } from "./dom";

describe("escapeHtml", () => {
  it("échappe & < > \" ' et rien d'autre, toutes les occurrences", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(escapeHtml("a & b & c <b>")).toBe("a &amp; b &amp; c &lt;b&gt;");
    expect(escapeHtml("Pâtes 12 — ok")).toBe("Pâtes 12 — ok");
  });
});

describe("onActivate", () => {
  let el: HTMLElement;
  beforeEach(() => {
    el = document.createElement("div");
    document.body.appendChild(el);
  });

  it("déclenche au clic", () => {
    const handler = vi.fn();
    onActivate(el, handler);
    el.click();
    expect(handler).toHaveBeenCalledOnce();
  });

  it.each([["Enter"], [" "]])("déclenche au clavier (%j) en bloquant l'action par défaut", (key) => {
    const handler = vi.fn();
    onActivate(el, handler);
    const event = new KeyboardEvent("keydown", { key, cancelable: true });
    el.dispatchEvent(event);
    expect(handler).toHaveBeenCalledWith(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignore les autres touches", () => {
    const handler = vi.fn();
    onActivate(el, handler);
    const event = new KeyboardEvent("keydown", { key: "a", cancelable: true });
    el.dispatchEvent(event);
    expect(handler).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("trapFocus", () => {
  let container: HTMLElement;
  let outside: HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    outside = document.createElement("button");
    document.body.appendChild(outside);
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  const add = (count: number) => {
    const buttons = Array.from({ length: count }, () => document.createElement("button"));
    container.append(...buttons);
    return buttons;
  };
  const tab = (shiftKey = false) => new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });

  it("Tab depuis le dernier élément revient au premier", () => {
    const [first, , last] = add(3);
    trapFocus(container, outside);
    last.focus();
    const event = tab();
    container.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it("Maj+Tab depuis le premier élément passe au dernier", () => {
    const [first, , last] = add(3);
    trapFocus(container, outside);
    first.focus();
    const event = tab(true);
    container.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it("ne bloque pas Tab au milieu, ni Tab sur le premier, ni Maj+Tab sur le dernier", () => {
    const [first, middle, last] = add(3);
    trapFocus(container, outside);
    for (const [target, shift] of [[middle, false], [middle, true], [first, false], [last, true]] as const) {
      target.focus();
      const event = tab(shift);
      container.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(target);
    }
  });

  it("ignore les autres touches ; sans élément focalisable, ne fait rien", () => {
    const [first] = add(1);
    trapFocus(container, outside);
    first.focus();
    const other = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    container.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
    container.replaceChildren();
    const event = tab();
    expect(() => container.dispatchEvent(event)).not.toThrow();
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignore les éléments désactivés et le tabindex -1, accepte liens, champs et tabindex", () => {
    container.innerHTML = `
      <button id="a">a</button>
      <button disabled>x</button>
      <a href="#" id="link">l</a>
      <input disabled />
      <span tabindex="-1">s</span>
      <textarea id="t"></textarea>
      <select disabled></select>
      <div tabindex="0" id="last">d</div>
    `;
    trapFocus(container, outside);
    (container.querySelector("#last") as HTMLElement).focus();
    container.dispatchEvent(tab());
    expect(document.activeElement).toBe(container.querySelector("#a"));
    container.dispatchEvent(tab(true));
    expect(document.activeElement).toBe(container.querySelector("#last"));
  });

  it("le nettoyage retire l'écouteur et rend le focus à l'élément précédent (s'il y en a un)", () => {
    const [first, , last] = add(3);
    const release = trapFocus(container, outside);
    release();
    expect(document.activeElement).toBe(outside);
    last.focus();
    const event = tab();
    container.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(last);
    void first;

    const releaseNull = trapFocus(container, null);
    expect(() => releaseNull()).not.toThrow();
    const releaseText = trapFocus(container, document.createTextNode("x") as unknown as Element);
    expect(() => releaseText()).not.toThrow();
  });
});
