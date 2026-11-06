/**
 * Installs the slice of Obsidian's DOM helpers that plugin code calls onto the
 * jsdom prototypes. Obsidian adds these at runtime in its renderer; jsdom has
 * plain DOM nodes. Only install what the code under test uses.
 */
export interface CreateElOptions {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean>;
}

export type ElementOptions = string | CreateElOptions | undefined;

function applyOptions(el: HTMLElement, options: ElementOptions): void {
  if (!options) return;
  if (typeof options === 'string') {
    el.className = options;
    return;
  }
  if (options.cls) {
    el.className = Array.isArray(options.cls) ? options.cls.join(' ') : options.cls;
  }
  if (options.text !== undefined) {
    el.textContent = options.text;
  }
  for (const [name, value] of Object.entries(options.attr ?? {})) {
    el.setAttribute(name, String(value));
  }
}

function appendEl(parent: Node, tag: string, options?: ElementOptions): HTMLElement {
  const el = document.createElement(tag);
  applyOptions(el, options);
  parent.appendChild(el);
  return el;
}

const nodeHelpers = {
  instanceOf(this: Node, type: new () => unknown): boolean {
    return this instanceof type;
  },
  empty(this: Node): void {
    while (this.firstChild) this.removeChild(this.firstChild);
  },
  appendText(this: Node, value: string): void {
    this.appendChild(document.createTextNode(value));
  },
};

const elementHelpers = {
  createEl(this: Element, tag: string, options?: ElementOptions): HTMLElement {
    return appendEl(this, tag, options);
  },
  createDiv(this: Element, options?: ElementOptions): HTMLElement {
    return appendEl(this, 'div', options);
  },
  createSpan(this: Element, options?: ElementOptions): HTMLElement {
    return appendEl(this, 'span', options);
  },
  addClass(this: Element, ...classes: string[]): void {
    this.classList.add(...classes);
  },
  removeClass(this: Element, ...classes: string[]): void {
    this.classList.remove(...classes);
  },
  hasClass(this: Element, cls: string): boolean {
    return this.classList.contains(cls);
  },
  setText(this: Element, value: string | DocumentFragment): void {
    nodeHelpers.empty.call(this);
    this.append(value);
  },
  getText(this: Element): string {
    return this.textContent ?? '';
  },
  setAttr(this: Element, name: string, value: string | number | boolean): void {
    this.setAttribute(name, String(value));
  },
};

const fragmentHelpers = {
  createEl(this: DocumentFragment, tag: string, options?: ElementOptions): HTMLElement {
    return appendEl(this, tag, options);
  },
};

/** Adds Obsidian's DOM helpers and the global `createFragment` to jsdom. */
export function installObsidianDom(): void {
  Object.assign(Node.prototype, nodeHelpers);
  Object.assign(Element.prototype, elementHelpers);
  Object.assign(DocumentFragment.prototype, fragmentHelpers);
  Object.assign(globalThis, {
    createFragment(callback?: (el: DocumentFragment) => void): DocumentFragment {
      const fragment = document.createDocumentFragment();
      callback?.(fragment);
      return fragment;
    },
  });
}
