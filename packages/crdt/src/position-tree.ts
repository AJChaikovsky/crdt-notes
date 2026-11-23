import type { Id } from "./id.js";

/**
 * A character in `FastFugue`: its place in the Fugue tree (`left` and `right` children,
 * each sorted by ID, smallest first) and the leaf of the position tree that holds it.
 */
export interface FugueNode {
  readonly id: Id;
  readonly char: string;
  deleted: boolean;
  readonly left: FugueNode[];
  readonly right: FugueNode[];
  /** Set by `PositionTree` when the node is inserted, and kept up to date on splits. */
  leaf: Leaf;
}

/** A leaf holds a stretch of the document, tombstones included, in order. */
export interface Leaf {
  readonly kind: "leaf";
  readonly items: FugueNode[];
  /** How many of `items` are not deleted. */
  visible: number;
  parent: Inner | null;
  /** The next leaf in document order, so the document can be read without the tree. */
  next: Leaf | null;
}

interface Inner {
  readonly kind: "inner";
  readonly children: (Leaf | Inner)[];
  /** Visible characters in this whole subtree. */
  visible: number;
  parent: Inner | null;
}

/** Most items in a leaf, and children in an inner node, before it splits in two. */
const DEFAULT_MAX = 64;

/**
 * The document in order, tombstones included, as a B-tree (a balanced tree whose nodes
 * hold many entries, ADR-0006). Every tree node knows how many visible characters sit
 * under it, so the character at a visible index is found in log n steps, and every
 * character knows its leaf, so its position is found by walking up from there.
 *
 * It only stores order. Where a character goes is decided by the Fugue tree in
 * `FastFugue`, which then tells this tree "before X" or "after X".
 */
export class PositionTree {
  #root: Leaf | Inner;
  #first: Leaf;
  #last: Leaf;
  readonly #max: number;

  /** `max` is the split size. Tests use a tiny one so small documents split often. */
  constructor(max = DEFAULT_MAX) {
    this.#max = max;
    this.#first = { kind: "leaf", items: [], visible: 0, parent: null, next: null };
    this.#root = this.#first;
    this.#last = this.#first;
  }

  /** How many characters are visible. */
  get visible(): number {
    return this.#root.visible;
  }

  /** A leaf to give a new node before it is inserted. Any leaf works; it is replaced. */
  get placeholder(): Leaf {
    return this.#first;
  }

  /** The first character in the document, tombstones included. */
  first(): FugueNode | undefined {
    for (let leaf: Leaf | null = this.#first; leaf !== null; leaf = leaf.next) {
      const item = leaf.items[0];
      if (item !== undefined) return item;
    }
    return undefined;
  }

  /** The character after `node`, tombstones included. */
  next(node: FugueNode): FugueNode | undefined {
    const items = node.leaf.items;
    const after = items[items.indexOf(node) + 1];
    if (after !== undefined) return after;
    for (let leaf = node.leaf.next; leaf !== null; leaf = leaf.next) {
      const item = leaf.items[0];
      if (item !== undefined) return item;
    }
    return undefined;
  }

  /** The visible character at `index`. Throws a `RangeError` if there is none. */
  atVisible(index: number): FugueNode {
    if (index < 0 || index >= this.#root.visible)
      throw new RangeError(`no character at ${index}`);
    let tree: Leaf | Inner = this.#root;
    let left = index;
    while (tree.kind === "inner") {
      let child: Leaf | Inner | undefined;
      for (const candidate of tree.children) {
        if (left < candidate.visible) {
          child = candidate;
          break;
        }
        left -= candidate.visible;
      }
      if (child === undefined) throw new Error("visible counts out of step");
      tree = child;
    }
    for (const item of tree.items) {
      if (item.deleted) continue;
      if (left === 0) return item;
      left -= 1;
    }
    throw new Error("visible counts out of step");
  }

  /** Inserts `node` straight after `anchor`, or at the very start if `anchor` is null. */
  insertAfter(anchor: FugueNode | null, node: FugueNode): void {
    if (anchor === null) this.#insert(this.#first, 0, node);
    else this.#insert(anchor.leaf, anchor.leaf.items.indexOf(anchor) + 1, node);
  }

  /** Inserts `node` straight before `anchor`, or at the very end if `anchor` is null. */
  insertBefore(anchor: FugueNode | null, node: FugueNode): void {
    if (anchor !== null) {
      this.#insert(anchor.leaf, anchor.leaf.items.indexOf(anchor), node);
      return;
    }
    this.#insert(this.#last, this.#last.items.length, node);
  }

  /** Marks `node` deleted and updates the visible counts. Deleting twice does nothing. */
  setDeleted(node: FugueNode): void {
    if (node.deleted) return;
    node.deleted = true;
    this.#addVisible(node.leaf, -1);
  }

  /** Every character in document order, tombstones included. */
  *[Symbol.iterator](): IterableIterator<FugueNode> {
    for (let leaf: Leaf | null = this.#first; leaf !== null; leaf = leaf.next)
      yield* leaf.items;
  }

  #insert(leaf: Leaf, offset: number, node: FugueNode): void {
    leaf.items.splice(offset, 0, node);
    node.leaf = leaf;
    if (!node.deleted) this.#addVisible(leaf, 1);
    if (leaf.items.length > this.#max) this.#splitLeaf(leaf);
  }

  #addVisible(leaf: Leaf, delta: number): void {
    leaf.visible += delta;
    for (let up = leaf.parent; up !== null; up = up.parent) up.visible += delta;
  }

  #splitLeaf(leaf: Leaf): void {
    const moved = leaf.items.splice(leaf.items.length >> 1);
    const sibling: Leaf = {
      kind: "leaf",
      items: moved,
      visible: moved.filter((item) => !item.deleted).length,
      parent: leaf.parent,
      next: leaf.next,
    };
    for (const item of moved) item.leaf = sibling;
    leaf.visible -= sibling.visible;
    leaf.next = sibling;
    if (this.#last === leaf) this.#last = sibling;
    this.#addChild(leaf, sibling);
  }

  /** Puts `added` into the tree just after `existing`, its left half. */
  #addChild(existing: Leaf | Inner, added: Leaf | Inner): void {
    const parent = existing.parent;
    if (parent === null) {
      // The root split: grow the tree by one level.
      const root: Inner = {
        kind: "inner",
        children: [existing, added],
        visible: existing.visible + added.visible,
        parent: null,
      };
      existing.parent = root;
      added.parent = root;
      this.#root = root;
      return;
    }
    // Splitting a child moves characters between siblings, so the parent's count holds.
    parent.children.splice(parent.children.indexOf(existing) + 1, 0, added);
    added.parent = parent;
    if (parent.children.length > this.#max) this.#splitInner(parent);
  }

  #splitInner(inner: Inner): void {
    const moved = inner.children.splice(inner.children.length >> 1);
    const sibling: Inner = {
      kind: "inner",
      children: moved,
      visible: moved.reduce((sum, child) => sum + child.visible, 0),
      parent: inner.parent,
    };
    for (const child of moved) child.parent = sibling;
    inner.visible -= sibling.visible;
    this.#addChild(inner, sibling);
  }
}
