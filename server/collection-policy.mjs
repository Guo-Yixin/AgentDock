export const defaults = { durationMinutes: 60, intervalSeconds: 60, paused: false };
export function validateCollection(input = {}) {
  const value = { ...defaults, ...input };
  if (!Number.isInteger(value.durationMinutes) || value.durationMinutes < 1 || value.durationMinutes > 240 ||
      !Number.isInteger(value.intervalSeconds) || value.intervalSeconds < 15 || value.intervalSeconds > 300 || typeof value.paused !== 'boolean') {
    throw new Error('采集时长须为 1–240 分钟，检查间隔须为 15–300 秒');
  }
  return { durationMinutes: value.durationMinutes, intervalSeconds: value.intervalSeconds, paused: value.paused };
}
// Deadline belongs to the run, not the Collector: reconnects and path edits cannot extend it.
export class CollectionRun {
  constructor(settings, expire, now = Date.now) { this.settings = validateCollection(settings); this.expire = expire; this.now = now; this.paused = this.settings.paused; this.deadline = null; this.reason = this.paused ? '手动暂停' : ''; }
  start() { clearTimeout(this.timer); this.paused = false; this.reason = ''; this.deadline = this.now() + this.settings.durationMinutes * 60000; this.timer = setTimeout(() => { this.pause('已达到采集时间上限'); this.expire(); }, Math.max(0, this.deadline - this.now())); this.timer.unref?.(); }
  pause(reason = '手动暂停') { clearTimeout(this.timer); this.paused = true; this.reason = reason; this.deadline = null; }
  status() { return { ...this.settings, paused: this.paused, deadline: this.deadline, reason: this.reason }; }
  close() { clearTimeout(this.timer); }
}
