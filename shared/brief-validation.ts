function normalized(value: string) {
  return value.trim().toLowerCase().replace(/[.!?,]+/g, '').replace(/\s+/g, ' ');
}

/** Start approval supplies no architectural requirements of its own. */
export function isStartOnlyInstruction(value: string) {
  const text = normalized(value).replace(/^(?:(?:please|yes|ok|okay)\s+)+/, '').replace(/\s+(?:please|now)$/, '');
  return /^(?:start(?: (?:building|designing|design|work|the build|the design))?|begin(?: (?:building|designing|work))?|proceed|go ahead|let'?s (?:start|begin)|build it)$/.test(text);
}

export function hasMeaningfulBrief(request: unknown) {
  if (typeof request !== 'string') return false;
  const text = normalized(request);
  return text.length > 0 && text !== 'awaiting your spoken project brief' && !isStartOnlyInstruction(request);
}
