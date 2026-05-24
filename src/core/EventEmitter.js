/**
 * AnimaForge – EventEmitter.js
 * Simple EventEmitter base class
 */

export class EventEmitter {
  constructor() {
    this._events = {};
  }

  on(event, listener) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(listener);
    return this;
  }

  off(event, listener) {
    if (!this._events[event]) return this;
    this._events[event] = this._events[event].filter(l => l !== listener);
    return this;
  }

  once(event, listener) {
    const wrapper = (...args) => {
      listener(...args);
      this.off(event, wrapper);
    };
    return this.on(event, wrapper);
  }

  emit(event, ...args) {
    if (!this._events[event]) return false;
    this._events[event].forEach(listener => {
      try { listener(...args); } catch (err) { console.error(`EventEmitter error on "${event}":`, err); }
    });
    return true;
  }

  removeAllListeners(event) {
    if (event) delete this._events[event];
    else this._events = {};
    return this;
  }
}
