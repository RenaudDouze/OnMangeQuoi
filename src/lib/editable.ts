export interface EditableOptions {
  value: string;
  placeholder?: string;
  maxLength?: number;
  onCommit: (value: string) => void;
}

/** Turns a static element into an inline text editor on click. Used for the
 * list title and meal titles. */
export function startEdit(el: HTMLElement, opts: EditableOptions): void {
  if (el.querySelector("input")) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "inline-edit";
  input.value = opts.value;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  if (opts.maxLength) input.maxLength = opts.maxLength;
  el.replaceChildren(input);
  input.focus();
  input.select();

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    opts.onCommit(input.value.trim());
  };

  input.addEventListener("keydown", (ke) => {
    if (ke.key === "Enter") {
      ke.preventDefault();
      input.blur();
    } else if (ke.key === "Escape") {
      ke.preventDefault();
      committed = true;
      opts.onCommit(opts.value);
    }
  });
  input.addEventListener("blur", commit);
  input.addEventListener("click", (e) => e.stopPropagation());
}
