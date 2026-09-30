import { Clock } from "./clock.js";
import { compareIds, type Id, type ReplicaId } from "./id.js";
import type { DeleteOp, ItemView } from "./rga.js";

/**
 * Insert one character into the Fugue tree as a child of `parent` (`null` is the start
 * of the document) on the given `side`. The author decides both when typing, so a
 * receiver just attaches the node (ADR-0004).
 */
export interface FugueInsertOp {
  readonly kind: "insert";
  readonly id: Id;
  readonly char: string;
  readonly parent: Id | null;
  readonly side: "left" | "right";
}

/** Any operation a Fugue replica can send to its peers. Deletes are the same as RGA's. */
export type FugueOp = FugueInsertOp | DeleteOp;

interface Node {
  readonly id: Id;
  readonly char: string;
  deleted: boolean;
  /** Left and right children, each kept sorted by `compareIds`, smallest first. */
  readonly left: Id[];
  readonly right: Id[];
}

function key(id: Id): string {
  return `${id.counter}:${id.replica}`;
}

/**
 * One replica of a text document, using Fugue (Weidner and Kleppmann, "The Art of the
 * Fugue", 2023), with plain Fugue's sibling order (ADR-0004).
 *
 * Each character is a node in a tree with left and right children. The document is an
 * in-order walk: a node's left children, then the node, then its right children. A run
 * typed backward becomes a chain of left children, so it stays in one piece whatever is
 * typed concurrently beside it (P7).
 *
 * @example Alice types "ab" backward and Bob types "xy" backward, both at the start and
 * at the same time. Each run stays whole:
 * ```ts
 * const alice = new Fugue("A");
 * const b = alice.insert(null, "b");   // right child of the start
 * const a = alice.insert(null, "a");   // start has a right child, so left child of "b"
 * const bob = new Fugue("B");
 * const y = bob.insert(null, "y");
 * const x = bob.insert(null, "x");
 * for (const op of [y, x]) alice.apply(op);
 * for (const op of [b, a]) bob.apply(op);
 * alice.text(); // "abxy", and bob.text() is the same. Never "axby".
 * ```
 */
export class Fugue {
  readonly #clock: Clock;
  readonly #nodes = new Map<string, Node>();
  /** The start of the document. It only ever has right children. */
  readonly #root: Id[] = [];
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
    const leftKids = origin === null ? this.#root : this.#node(origin).right;
    const first = leftKids[0];
    let parent: Id | null = origin;
    let side: "left" | "right" = "right";
    if (first !== undefined) {
      // The origin already has right children, so the character just after it is the
      // leftmost node of its first right child's subtree. Become that node's left child.
      parent = this.#leftmost(first);
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

  /** Creates a local delete of `target`, applies it, and returns it to send to peers. */
  delete(target: Id): DeleteOp {
    const op: DeleteOp = { kind: "delete", id: this.#clock.tick(), target };
    this.#applyReady(op);
    return op;
  }

  /**
   * Applies an op from another replica, in any order. An op whose parent (for an insert)
   * or target (for a delete) hasn't arrived yet is held back and applied as soon as it
   * has (ADR-0003, with parent in place of origin).
   */
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
    return this.#walk()
      .filter((node) => !node.deleted)
      .map((node) => node.char)
      .join("");
  }

  /** The IDs of the visible characters, in document order. */
  visibleIds(): Id[] {
    return this.#walk()
      .filter((node) => !node.deleted)
      .map((node) => node.id);
  }

  /** Every item in document order, tombstones included, as copies. */
  items(): ItemView[] {
    return this.#walk().map(({ id, char, deleted }) => ({ id, char, deleted }));
  }

  #ready(op: FugueOp): boolean {
    if (op.kind === "delete") return this.#nodes.has(key(op.target));
    return op.parent === null || this.#nodes.has(key(op.parent));
  }

  #applyReady(op: FugueOp): void {
    // A delete keeps the node as a tombstone: it may still be a parent, and the walk
    // still passes through it. Deleting twice changes nothing.
    if (op.kind === "delete") this.#node(op.target).deleted = true;
    else this.#integrate(op);
  }

  #integrate(op: FugueInsertOp): void {
    // An insert delivered twice is a no-op (P2).
    if (this.#nodes.has(key(op.id))) return;
    let siblings = this.#root;
    if (op.parent !== null) {
      const parent = this.#node(op.parent);
      siblings = op.side === "left" ? parent.left : parent.right;
    }
    const at = siblings.findIndex((sibling) => compareIds(op.id, sibling) < 0);
    siblings.splice(at === -1 ? siblings.length : at, 0, op.id);
    this.#nodes.set(key(op.id), {
      id: op.id,
      char: op.char,
      deleted: false,
      left: [],
      right: [],
    });
  }

  /** The first node of `id`'s subtree in document order: follow first left children. */
  #leftmost(id: Id): Id {
    let current = id;
    for (let next = this.#node(current).left[0]; next !== undefined;) {
      current = next;
      next = this.#node(current).left[0];
    }
    return current;
  }

  /**
   * In-order walk of the whole tree. Iterative, because typing forward builds a chain
   * of right children as deep as the document is long, which would overflow the call
   * stack if walked recursively.
   */
  #walk(): Node[] {
    const out: Node[] = [];
    // Each frame is either a subtree still to expand or a node ready to visit.
    const stack: { id: Id; expand: boolean }[] = [...this.#root]
      .reverse()
      .map((id) => ({ id, expand: true }));
    for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
      const node = this.#node(frame.id);
      if (!frame.expand) {
        out.push(node);
        continue;
      }
      // Pushed in reverse so they pop as: left children, the node, right children.
      for (let i = node.right.length - 1; i >= 0; i -= 1) {
        const id = node.right[i];
        if (id !== undefined) stack.push({ id, expand: true });
      }
      stack.push({ id: node.id, expand: false });
      for (let i = node.left.length - 1; i >= 0; i -= 1) {
        const id = node.left[i];
        if (id !== undefined) stack.push({ id, expand: true });
      }
    }
    return out;
  }

  #node(id: Id): Node {
    const node = this.#nodes.get(key(id));
    if (node === undefined)
      throw new Error(`(${id.counter}, ${id.replica}) has not been applied yet`);
    return node;
  }
}
