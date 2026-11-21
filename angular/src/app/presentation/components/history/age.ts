// How long ago something was saved, in words: "9 hours", or "1 day 4 hours" once it is a day old.
// Under an hour reads as "less than an hour" rather than counting minutes. `now` is a parameter so a test needs no clock.
export function age(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';

  const minutes = Math.floor(Math.max(0, now - then) / 60000);
  if (minutes < 60) return 'less than an hour';

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour' : `${hours} hours`;

  const days = Math.floor(hours / 24);
  const left = hours % 24;
  const dayPart = days === 1 ? '1 day' : `${days} days`;
  if (left === 0) return dayPart;
  return `${dayPart} ${left === 1 ? '1 hour' : `${left} hours`}`;
}
