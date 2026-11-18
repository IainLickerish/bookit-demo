import acme from '../../../tenants/acme.json';
import beacon from '../../../tenants/beacon.json';

export function bookingWords() {
  switch (process.env.BOOKIT_TENANT?.trim()) {
    case 'acme':
      return { visitLabel: 'session', practitionerLabel: acme.branding.practitionerLabel };
    case 'beacon':
      return { visitLabel: 'appointment', practitionerLabel: beacon.branding.practitionerLabel };
    default:
      return { visitLabel: 'appointment', practitionerLabel: 'practitioner' };
  }
}
