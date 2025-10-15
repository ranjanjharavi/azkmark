import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { createRefreshScheduler } from "../dist/library/refresh.js";

function useTestClock(t) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const timers = new Map();
  let now = 0;
  let nextId = 0;

  const window = {
    setTimeout(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, deadline: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: window,
  });
  t.after(() => {
    timers.clear();
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
      return;
    }
    delete globalThis.window;
  });

  return {
    advance(milliseconds) {
      now += milliseconds;
      for (const [id, timer] of timers) {
        if (timer.deadline > now) {
          continue;
        }
        timers.delete(id);
        timer.callback();
      }
    },
    get pendingCount() {
      return timers.size;
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function createReader() {
  const reads = [];
  return {
    reads,
    readAndRender() {
      const read = deferred();
      reads.push(read);
      return read.promise;
    },
  };
}

test("storage bursts share a fixed 100ms window instead of resetting it", async (t) => {
  const clock = useTestClock(t);
  const reader = createReader();
  const scheduler = createRefreshScheduler(reader.readAndRender);

  scheduler.schedule();
  clock.advance(40);
  scheduler.schedule();
  scheduler.schedule();
  assert.equal(clock.pendingCount, 1);
  clock.advance(59);
  assert.equal(reader.reads.length, 0);
  clock.advance(1);
  assert.equal(reader.reads.length, 1);

  reader.reads[0].resolve();
  await setImmediate();
  assert.equal(clock.pendingCount, 0);
});

test("explicit refresh cancels the passive delay and waits for the read", async (t) => {
  const clock = useTestClock(t);
  const reader = createReader();
  const scheduler = createRefreshScheduler(reader.readAndRender);
  let completed = false;

  scheduler.schedule();
  const refresh = scheduler.refresh().then(() => {
    completed = true;
  });
  assert.equal(clock.pendingCount, 0);
  assert.equal(reader.reads.length, 1);
  await setImmediate();
  assert.equal(completed, false);

  reader.reads[0].resolve();
  await refresh;
  assert.equal(completed, true);
  clock.advance(100);
  assert.equal(reader.reads.length, 1);
});

test("requests during a held read share a fresh follow-up and its completion", async (t) => {
  useTestClock(t);
  const reader = createReader();
  const scheduler = createRefreshScheduler(reader.readAndRender);
  let secondCompleted = false;
  let thirdCompleted = false;

  const first = scheduler.refresh();
  const second = scheduler.refresh().then(() => {
    secondCompleted = true;
  });
  const third = scheduler.refresh().then(() => {
    thirdCompleted = true;
  });
  assert.equal(reader.reads.length, 1);

  reader.reads[0].resolve();
  await first;
  assert.equal(reader.reads.length, 2);
  assert.equal(secondCompleted, false);
  assert.equal(thirdCompleted, false);

  reader.reads[1].resolve();
  await Promise.all([second, third]);
  assert.equal(secondCompleted, true);
  assert.equal(thirdCompleted, true);
});

test("an unexpired passive window keeps its remaining delay after a read", async (t) => {
  const clock = useTestClock(t);
  const reader = createReader();
  const scheduler = createRefreshScheduler(reader.readAndRender);

  const first = scheduler.refresh();
  scheduler.schedule();
  clock.advance(50);
  reader.reads[0].resolve();
  await first;
  assert.equal(reader.reads.length, 1);
  clock.advance(49);
  assert.equal(reader.reads.length, 1);
  clock.advance(1);
  assert.equal(reader.reads.length, 2);

  reader.reads[1].resolve();
  await setImmediate();
});

test("an expired passive window cannot overlap a held read", async (t) => {
  const clock = useTestClock(t);
  const reader = createReader();
  const scheduler = createRefreshScheduler(reader.readAndRender);

  const first = scheduler.refresh();
  scheduler.schedule();
  clock.advance(100);
  assert.equal(reader.reads.length, 1);
  reader.reads[0].resolve();
  await first;
  assert.equal(reader.reads.length, 2);

  reader.reads[1].resolve();
  await setImmediate();
});

test("explicit failure rejects its callers but still runs queued recovery", async (t) => {
  useTestClock(t);
  const reader = createReader();
  const scheduler = createRefreshScheduler(reader.readAndRender);
  const cause = new Error("Read failed");

  const first = scheduler.refresh();
  const rejection = assert.rejects(first, cause);
  const recovery = scheduler.refresh();
  reader.reads[0].reject(cause);
  await rejection;
  assert.equal(reader.reads.length, 2);

  reader.reads[1].resolve();
  await recovery;
});

test("passive failure is logged and leaves explicit retry usable", async (t) => {
  const clock = useTestClock(t);
  const reader = createReader();
  const scheduler = createRefreshScheduler(reader.readAndRender);
  const cause = new Error("Passive read failed");
  const errorLog = t.mock.method(console, "error", () => {});

  scheduler.schedule();
  clock.advance(100);
  reader.reads[0].reject(cause);
  await setImmediate();
  assert.equal(errorLog.mock.callCount(), 1);
  assert.equal(errorLog.mock.calls[0].arguments[1], cause);

  const retry = scheduler.refresh();
  assert.equal(reader.reads.length, 2);
  reader.reads[1].resolve();
  await retry;
});

test("a synchronous reader exception does not leave the scheduler running", async (t) => {
  useTestClock(t);
  const cause = new Error("Synchronous failure");
  let calls = 0;
  const scheduler = createRefreshScheduler(() => {
    calls++;
    if (calls === 1) {
      throw cause;
    }
    return Promise.resolve();
  });

  await assert.rejects(scheduler.refresh(), cause);
  await scheduler.refresh();
  assert.equal(calls, 2);
});

test("synchronous refresh reentry queues a read instead of overlapping", async (t) => {
  useTestClock(t);
  const firstRead = deferred();
  const secondRead = deferred();
  let reentrant;
  let calls = 0;
  const scheduler = createRefreshScheduler(() => {
    calls++;
    if (calls === 1) {
      reentrant = scheduler.refresh();
      return firstRead.promise;
    }
    return secondRead.promise;
  });

  const first = scheduler.refresh();
  assert.equal(calls, 1);
  firstRead.resolve();
  await first;
  assert.equal(calls, 2);
  secondRead.resolve();
  await reentrant;
});
