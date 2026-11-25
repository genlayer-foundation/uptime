// Keeps the every-minute appeal watch (/api/cron/appeals) off the database
// when it has nothing to do. Each call used to run one SELECT, 1,440 a day,
// which alone kept the Postgres compute from ever suspending.
//
// An appeal-due probe only starts waiting when a tick is submitted, and the
// Heartbeat ticks at the top of the hour. So once a watch has found nothing
// waiting AFTER the tick window, nothing can start waiting before the next
// hour: this server instance skips the store until then. Inside the window
// nothing is remembered, so a watch that runs just before the tick lands
// cannot silence the ones after it.
//
// Per instance and in memory only: a cold instance asks the store once. A tick
// submitted later than the window (dispatch catching up after an outage) is
// not watched by instances that already stood down; the 10-minute reconcile
// still files its appeal if the window is open when it runs.
export const TICK_WINDOW_MIN = 15;

let idleUntilMs = 0;

export function appealWatchIdle(nowMs: number): boolean {
  return nowMs < idleUntilMs;
}

export function noteAppealWatch(waiting: number, nowMs: number): void {
  if (waiting > 0) {
    idleUntilMs = 0;
    return;
  }
  const d = new Date(nowMs);
  if (d.getUTCMinutes() < TICK_WINDOW_MIN) return;
  idleUntilMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours() + 1);
}

// Test hook.
export function resetAppealGate(): void {
  idleUntilMs = 0;
}
