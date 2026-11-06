/**
 * Minimal fake DOM element for the node test environment. It implements only
 * the Obsidian `Element` API the dialogs use, so a modal can be rendered and
 * inspected without jsdom.
 */
export interface FakeElementOptions {
  cls?: string;
  text?: string;
}

export class FakeEl {
  readonly children: FakeEl[] = [];
  readonly classes = new Set<string>();
  textContent = '';
  disabled = false;
  onclick: (() => void) | null = null;
  onkeydown: ((event: KeyboardEvent) => void) | null = null;
  private readonly attrs = new Map<string, string>();

  readonly classList = {
    add: (...names: string[]): void => {
      for (const name of names) this.classes.add(name);
    },
    remove: (...names: string[]): void => {
      for (const name of names) this.classes.delete(name);
    },
    contains: (name: string): boolean => this.classes.has(name),
    toggle: (name: string, force?: boolean): boolean => {
      const on = force ?? !this.classes.has(name);
      if (on) this.classes.add(name);
      else this.classes.delete(name);
      return on;
    },
  };

  constructor(readonly tag = 'div') {}

  createDiv(arg?: string | FakeElementOptions): FakeEl {
    return this.append('div', arg);
  }

  createSpan(arg?: string | FakeElementOptions): FakeEl {
    return this.append('span', arg);
  }

  createEl(tag: string, arg?: FakeElementOptions): FakeEl {
    return this.append(tag, arg);
  }

  empty(): void {
    this.children.length = 0;
    this.textContent = '';
  }

  addClass(...names: string[]): void {
    for (const name of names) this.classes.add(name);
  }

  removeClass(...names: string[]): void {
    for (const name of names) this.classes.delete(name);
  }

  setAttr(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttr(name: string): string | undefined {
    return this.attrs.get(name);
  }

  /** The real dialogs must never look elements up again after construction. */
  querySelector(): never {
    throw new Error('querySelector must not be used after construction');
  }

  private append(tag: string, arg?: string | FakeElementOptions): FakeEl {
    const element = new FakeEl(tag);
    if (typeof arg === 'string') {
      element.addClass(...arg.split(' '));
    } else if (arg) {
      if (arg.cls) element.addClass(...arg.cls.split(' '));
      if (arg.text !== undefined) element.textContent = arg.text;
    }
    this.children.push(element);
    return element;
  }
}

/** Every element in the tree, root first. */
export function allElements(root: FakeEl): FakeEl[] {
  return [root, ...root.children.flatMap((child) => allElements(child))];
}

export function findByClass(root: FakeEl, cls: string): FakeEl[] {
  return allElements(root).filter((element) => element.classList.contains(cls));
}

export function findByTagAndText(root: FakeEl, tag: string, text: string): FakeEl | undefined {
  return allElements(root).find((element) => element.tag === tag && element.textContent === text);
}

export function textOf(element: FakeEl): string {
  return [element.textContent, ...element.children.map((child) => textOf(child))].join(' ');
}
