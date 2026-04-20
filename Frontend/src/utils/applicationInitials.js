/**
 * Derive initials for an application name (e.g. "Jetty Planning System" → "JPS").
 * Single word: up to 3 alphanumeric characters.
 */
export function applicationInitials(name) {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) {
    const w = words[0].replace(/[^a-zA-Z0-9]/g, '');
    return (w.slice(0, 3) || '?').toUpperCase();
  }
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}
