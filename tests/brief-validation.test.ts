import { describe, expect, it } from 'vitest';
import { hasMeaningfulBrief, isStartOnlyInstruction } from '../shared/brief-validation';

describe('initial design brief validation', () => {
  it.each(['', '  Awaiting your spoken project brief.  ', 'START BUILDING', 'Please start building now!', 'Go ahead.', 'yes, proceed', "Let's start"])('rejects missing requirements: %s', request => {
    expect(hasMeaningfulBrief(request)).toBe(false);
  });
  it.each(['Build a cozy HDB flat for two people with warm timber and a gaming room.', 'Start building a four-bedroom courtyard home.', 'Awaiting your spoken project brief.\nInclude two floors and four bedrooms.'])('keeps actual requirements: %s', request => {
    expect(hasMeaningfulBrief(request)).toBe(true);
    expect(isStartOnlyInstruction(request)).toBe(false);
  });
});
