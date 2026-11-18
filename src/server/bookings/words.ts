import acme from '../../../tenants/acme.json';
import beacon from '../../../tenants/beacon.json';

export function bookingWords() {
  switch (process.env.BOOKIT_TENANT?.trim()) {
    case 'acme':
      return acme.branding;
    case 'beacon':
      return beacon.branding;
    default:
      return { visitLabel: 'appointment', practitionerLabel: 'practitioner' };
  }
}
