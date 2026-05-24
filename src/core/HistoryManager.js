/**
 * AnimaForge - HistoryManager
 * Undo/redo system using the Command Pattern.
 * Maintains a history stack with a maximum of 100 entries.
 */

export class HistoryManager {
  constructor(maxEntries = 100) {
    this._maxEntries = maxEntries;
    this._history = [];   // stack of executed actions
    this._future = [];    // stack of undone actions (for redo)
    this._listeners = {};
  }

  // ─── EventEmitter ──────────────────────────────────────────────────────────

  on(event, listener) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(listener);
    return () => this.off(event, listener);
  }

  off(event, listener) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(l => l !== listener);
  }

  emit(event, ...args) {
    (this._listeners[event] || []).forEach(fn => fn(...args));
  }

  // ─── Core API ──────────────────────────────────────────────────────────────

  /**
   * Execute an action and push it onto the history stack.
   * @param {Object} action - Must expose execute() and undo() methods.
   *                          Optionally a `description` string for debugging.
   */
  push(action) {
    if (typeof action.execute !== 'function' || typeof action.undo !== 'function') {
      throw new Error('HistoryManager: action must implement execute() and undo()');
    }

    // Execute the action
    action.execute();

    // Clear the redo stack – new action invalidates future
    this._future = [];

    // Enforce max-size by evicting oldest entry
    if (this._history.length >= this._maxEntries) {
      this._history.shift();
    }

    this._history.push(action);
    this.emit('change', this._snapshot());
  }

  /**
   * Undo the last action.
   * @returns {boolean} true if an action was undone
   */
  undo() {
    if (!this.canUndo) return false;

    const action = this._history.pop();
    action.undo();
    this._future.push(action);
    this.emit('undo', action);
    this.emit('change', this._snapshot());
    return true;
  }

  /**
   * Redo the last undone action.
   * @returns {boolean} true if an action was redone
   */
  redo() {
    if (!this.canRedo) return false;

    const action = this._future.pop();
    action.execute();
    this._history.push(action);
    this.emit('redo', action);
    this.emit('change', this._snapshot());
    return true;
  }

  /**
   * Clear all history and future stacks.
   */
  clear() {
    this._history = [];
    this._future = [];
    this.emit('change', this._snapshot());
  }

  // ─── State Queries ─────────────────────────────────────────────────────────

  get canUndo() {
    return this._history.length > 0;
  }

  get canRedo() {
    return this._future.length > 0;
  }

  get historyLength() {
    return this._history.length;
  }

  get futureLength() {
    return this._future.length;
  }

  /**
   * Returns an array of action descriptions for the history stack (oldest first).
   */
  getHistoryDescriptions() {
    return this._history.map(a => a.description || 'Unnamed Action');
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  _snapshot() {
    return {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      historyLength: this.historyLength,
      futureLength: this.futureLength,
    };
  }
}

// ─── Built-in Action Factories ─────────────────────────────────────────────

/**
 * Creates a simple action from two callbacks.
 * @param {Function} executeFn  - Called on do/redo
 * @param {Function} undoFn     - Called on undo
 * @param {string}   description
 */
export function createAction(executeFn, undoFn, description = 'Action') {
  return { execute: executeFn, undo: undoFn, description };
}

/**
 * Creates a batch action that groups multiple actions into one undoable step.
 * @param {Object[]} actions
 * @param {string}   description
 */
export function createBatchAction(actions, description = 'Batch Action') {
  return {
    description,
    execute() {
      actions.forEach(a => a.execute());
    },
    undo() {
      // Undo in reverse order
      [...actions].reverse().forEach(a => a.undo());
    },
  };
}

/**
 * Creates a property-change action that restores a previous value.
 * @param {Object} target    - The object whose property changes
 * @param {string} prop      - Property name (dot-notation NOT supported here; use setters)
 * @param {*}      oldValue
 * @param {*}      newValue
 * @param {string} description
 */
export function createPropertyAction(target, prop, oldValue, newValue, description = `Set ${prop}`) {
  return {
    description,
    execute() { target[prop] = newValue; },
    undo()    { target[prop] = oldValue; },
  };
}

export default HistoryManager;
