import { SUPPORTED_LANGUAGE_CODES } from '../languages';
import { EMAIL_I18N, EVENT_TEXTS } from './index';

import { describe, expect, it } from 'vitest';

describe('notification locales', () => {
  it('cover every language the app ships, so no user gets English mail by omission', () => {
    expect(Object.keys(EMAIL_I18N).sort()).toEqual([...SUPPORTED_LANGUAGE_CODES].sort());
    expect(Object.keys(EVENT_TEXTS).sort()).toEqual([...SUPPORTED_LANGUAGE_CODES].sort());
    expect(EMAIL_I18N.ca?.manage).toBe('Gestiona les preferències');
  });
});
