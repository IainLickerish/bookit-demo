/** Clinic language follows the tenant identity, including after a clinic name is changed. */
export function clinicWords(tenant = process.env.BOOKIT_TENANT) {
  return tenant === 'beacon'
    ? { appointment: 'appointment', practitioner: 'clinician' }
    : { appointment: 'session', practitioner: 'physiotherapist' };
}
