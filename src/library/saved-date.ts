interface SavedDate {
  dateTime?: string;
  full: string;
  age: string;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function calendarDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MILLISECONDS_PER_DAY;
}

export function formatSavedDate(savedAt: number, now = Date.now()): SavedDate {
  const saved = new Date(savedAt);
  if (Number.isNaN(saved.getTime())) {
    const fallback = `Timestamp ${savedAt}`;
    return { full: fallback, age: fallback };
  }

  const full = saved.toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const days = calendarDay(new Date(now)) - calendarDay(saved);
  let age = full;
  
  if (days === 0) {
    age = "Today";
  } else if (days === 1) {
    age = "Yesterday";
  } else if (days > 1) {
    age = `${days} days ago`;
  }

  const dateTime = saved.toISOString().replace(/^\+/, "");
  return { dateTime, full, age };
}
