import { assistedDestinations } from "./assisted";
import { hasManualReminder, type AssistedPost } from "./workspace";

function calendarDate(value: string | Date): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid reminder time.");
  return `${date.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

/** RFC 5545 recommends folding content lines at 75 UTF-8 octets. */
function foldLine(line: string): string[] {
  const lines: string[] = [];
  const encoder = new TextEncoder();
  let current = "";
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      lines.push(current);
      current = " ";
      bytes = 1;
    }
    current += character;
    bytes += size;
  }
  lines.push(current);
  return lines;
}

export function upcomingManualReminders(items: readonly AssistedPost[], now: number): AssistedPost[] {
  return items.filter((item) => item.status === "queued" && hasManualReminder(item) && Date.parse(item.scheduledFor) > now)
    .sort((left, right) => Date.parse(left.scheduledFor) - Date.parse(right.scheduledFor) || left.id.localeCompare(right.id));
}

/** Calendar export contains destination and time only; post text and media stay in Plypost. */
export function buildManualReminderCalendar(items: readonly AssistedPost[], generatedAt = new Date()): string {
  const stamp = calendarDate(generatedAt);
  const upcoming = upcomingManualReminders(items, generatedAt.getTime());
  if (!upcoming.length) throw new Error("No future manual reminders to export.");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Plypost//Manual reminders//EN", "CALSCALE:GREGORIAN",
  ];
  for (const item of upcoming) {
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(item.id)) throw new Error("Invalid reminder ID.");
    const platform = assistedDestinations[item.destination]?.name;
    if (!platform) throw new Error("Unknown reminder destination.");
    const start = new Date(item.scheduledFor);
    lines.push(
      "BEGIN:VEVENT",
      `UID:plypost-assisted-${item.id}@plypost.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${calendarDate(start)}`,
      `DTEND:${calendarDate(new Date(start.getTime() + 15 * 60_000))}`,
      `SUMMARY:${escapeText(`Plypost: post to ${platform}`)}`,
      `DESCRIPTION:${escapeText(`Open Plypost to review the saved text and images. Publish manually on ${platform}.`)}`,
      "CLASS:PRIVATE", "TRANSP:TRANSPARENT",
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT5M",
      `DESCRIPTION:${escapeText(`Time to post on ${platform}`)}`,
      "END:VALARM", "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.flatMap(foldLine).join("\r\n")}\r\n`;
}
