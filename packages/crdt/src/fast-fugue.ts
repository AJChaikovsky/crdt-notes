import { Clock } from "./clock.js";
import type { FugueInsertOp, FugueOp } from "./fugue.js";
import { compareIds, type Id, type ReplicaId } from "./id.js";
import { PositionTree, type FugueNode } from "./position-tree.js";
import type { DeleteOp, ItemView } from "./rga.js";

function key(id: Id): string {
  return `${id.counter}:${id.replica}`;
}

/** The first node of `node`'s subtree in document order: follow first left children. */
function leftmost(node: FugueNode): FugueNode {
  let current = node;
  for (let next = current.left[0]; next !== undefined; next = current.left[0])
    current = next;
  return current;
}

/** The last node of `node`'s subtree in document order: follow last right children. */
function rightmost(node: FugueNode): FugueNode {
  let current = node;
  for (let next = current.right.at(-1); next !== undefined; next = current.right.at(-1))
    current = next;
  return current;
}

/**
 * The same CRDT (Conflict-free Replicated Data Type) as `Fugue`, with the same ops and
 * the same document for the same inputs, but fast enough for long documents (ADR-0006).
 *
 * `Fugue` finds a position by walking the whole tree. This class keeps the Fugue tree for
 * deciding where a character belongs, plus a `PositionTree` (a B-tree with visible counts)
 * holding the document in order. Finding the character at a cursor index, or placing a
 * new one, takes about log n steps instead of n.
 *
 * `Fugue` stays as the reference: P1–P7, and a property comparing the two replica by
 * replica, check that this class behaves identically.
 *
 * @example Alice and Bob start from "ac" and both type at index 1 at the same time. Both
 * replicas end with the same text:
 * ```ts
 * const b = alice.insertAt(1, "b"); // alice: "abc"
 * const x = bob.insertAt(1, "x");   // bob: "axc"
 * alice.apply(x);
 * bob.apply(b);
 * alice.text() === bob.text();      // "abxc" or "axbc", the same on both
 * ```
 */
export class FastFugue {
  readonly #clock: Clock;
  readonly #nodes = new Map<string, FugueNode>();
  /** The start of the document. It only ever has right children. */
  readonly #root: FugueNode[] = [];
  readonly #order = new PositionTree();
  /** Remote ops that arrived before their parent or target, in arrival order (P4). */
  readonly #pending: FugueOp[] = [];

  constructor(replica: ReplicaId) {
    this.#clock = new Clock(replica);
  }

  /**
   * Creates a local insert just after `origin` (the visible character left of the
   * cursor, or `null` at the start), applies it, and returns it to send to peers.
   */
  insert(origin: Id | null, char: string): FugueInsertOp {
    const originNode = origin === null ? null : this.#node(origin);
    const rightKids = originNode === null ? this.#root : originNode.right;
    let parent: Id | null = origin;
    let side: "left" | "right" = "right";
    if (rightKids.length > 0) {
      // The character just after the origin, tombstones included, is the leftmost node
      // of the origin's first right subtree (as in `Fugue`). The position tree knows it.
      const next =
        originNode === null ? this.#order.first() : this.#order.next(originNode);
      if (next === undefined) throw new Error("a right child must follow its parent");
      parent = next.id;
      side = "left";
    }
    const op: FugueInsertOp = {
      kind: "insert",
      id: this.#clock.tick(),
      char,
      parent,
      side,
    };
    this.#integrate(op);
    return op;
  }

  /** Inserts `char` so it becomes the visible character at `index`. See `Fugue.insertAt`. */
  insertAt(index: number, char: string): FugueInsertOp {
    if (index < 0 || index > this.#order.visible)
      throw new RangeError(`no position ${index}`);
    return this.insert(index === 0 ? null : this.#order.atVisible(index - 1).id, char);
  }

  /** Deletes the visible character at `index`. See `Fugue.deleteAt`. */
  deleteAt(index: number): DeleteOp {
    return this.delete(this.#order.atVisible(index).id);
  }

  /** Creates a local delete of `target`, applies it, and returns it to send to peers. */
  delete(target: Id): DeleteOp {
    const op: DeleteOp = { kind: "delete", id: this.#clock.tick(), target };
    this.#applyReady(op);
    return op;
  }

  /** Applies an op from another replica, in any order. See `Fugue.apply`. */
  apply(op: FugueOp): void {
    this.#clock.observe(op.id);
    if (!this.#ready(op)) {
      // A duplicate of an op that is already waiting changes nothing (P2).
      if (!this.#pending.some((p) => compareIds(p.id, op.id) === 0))
        this.#pending.push(op);
      return;
    }
    this.#applyReady(op);
    // Applying one op can make held ones ready, and those can unblock more.
    for (let i = this.#pending.findIndex((p) => this.#ready(p)); i !== -1;) {
      const [next] = this.#pending.splice(i, 1);
      if (next !== undefined) this.#applyReady(next);
      i = this.#pending.findIndex((p) => this.#ready(p));
    }
  }

  /** How many remote ops are held back waiting for their parent or target. */
  get pendingCount(): number {
    return this.#pending.length;
  }

  /** The visible document. */
  text(): string {
    let text = "";
    for (const node of this.#order) if (!node.deleted) text += node.char;
    return text;
  }

  /** The IDs of the visible characters, in document order. */
  visibleIds(): Id[] {
    const ids: Id[] = [];
    for (const node of this.#order) if (!node.deleted) ids.push(node.id);
    return ids;
  }

  /** Every item in document order, tombstones included, as copies. */
  items(): ItemView[] {
    return [...this.#order].map(({ id, char, deleted }) => ({ id, char, deleted }));
  }

  #ready(op: FugueOp): boolean {
    if (op.kind === "delete") return this.#nodes.has(key(op.target));
    return op.parent === null || this.#nodes.has(key(op.parent));
  }

  #applyReady(op: FugueOp): void {
    if (op.kind === "delete") this.#order.setDeleted(this.#node(op.target));
    else this.#integrate(op);
  }

  /**
   * Attaches the node to the Fugue tree, then puts it in the position tree at the same
   * place an in-order walk of the Fugue tree would visit it.
   */
  #integrate(op: FugueInsertOp): void {
    // An insert delivered twice is a no-op (P2).
    if (this.#nodes.has(key(op.id))) return;
    const parent = op.parent === null ? null : this.#node(op.parent);
    let siblings = this.#root;
    if (parent !== null) siblings = op.side === "left" ? parent.left : parent.right;
    const found = siblings.findIndex((sibling) => compareIds(op.id, sibling.id) < 0);
    const at = found === -1 ? siblings.length : found;
    const following = siblings[at];

    const node: FugueNode = {
      id: op.id,
      char: op.char,
      deleted: false,
      left: [],
      right: [],
      leaf: this.#order.placeholder,
    };
    if (following !== undefined) {
      // A bigger sibling follows: the new node goes just before that sibling's subtree.
      this.#order.insertBefore(leftmost(following), node);
    } else if (parent === null) {
      // The last child of the start: the very end of the document.
      this.#order.insertBefore(null, node);
    } else if (op.side === "left") {
      // The last left child comes straight before its parent.
      this.#order.insertBefore(parent, node);
    } else {
      // The last right child comes straight after the end of the parent's subtree.
      this.#order.insertAfter(rightmost(parent), node);
    }
    siblings.splice(at, 0, node);
    this.#nodes.set(key(op.id), node);
  }

  #node(id: Id): FugueNode {
    const node = this.#nodes.get(key(id));
    if (node === undefined)
      throw new Error(`(${id.counter}, ${id.replica}) has not been applied yet`);
    return node;
  }
}
