export function BlueskyMark({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 10.8C10.1 7.3 5.8 3.7 3.6 3.7 1.5 3.7 2 6.5 2.3 8.1c.4 2.5 1.7 4 4.7 4.4-3.2.4-4.2 2-2.5 4.3 2.1 2.8 4.9 1.1 7.5-2.2 2.6 3.3 5.4 5 7.5 2.2 1.7-2.3.7-3.9-2.5-4.3 3-.4 4.3-1.9 4.7-4.4.3-1.6.8-4.4-1.3-4.4-2.2 0-6.5 3.6-8.4 7.1Z" />
  </svg>;
}
