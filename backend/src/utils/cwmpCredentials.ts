export interface TenantCwmpCredentials {
  tenantSlug: string;
  acsUsername: string;
  acsPassword: string;
  connectionRequestUsername: string;
  connectionRequestPassword: string;
  periodicInformIntervalSeconds: number;
}

export interface CwmpUrlSet {
  primaryUrl: string;
  cwmpPathUrl: string;
  port80Url: string;
  subdomainUrl: string;
}

/**
 * Normalizes a tenant slug for deterministic TR-069 credential generation.
 */
export function normalizeTenantSlug(tenantSlug?: string): string {
  const clean = (tenantSlug || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!clean || clean === 'default' || clean === 'global' || clean === 'quarantine_pending') {
    return '';
  }
  return clean;
}

/**
 * Resolves consistent ACS & CPE Connection Request credentials for a tenant.
 * Uses the tenant slug as both ACS Username & ACS Password per operator convention,
 * and derives alphanumeric tenant-scoped Connection Request credentials pushed by ACS.
 */
export function resolveTenantCwmpCredentials(tenantSlug?: string, tenantCwmpPassword?: string): TenantCwmpCredentials {
  const cleanSlug = normalizeTenantSlug(tenantSlug);
  const acsUsername = cleanSlug || 'acs';
  const acsPassword = (tenantCwmpPassword && tenantCwmpPassword.trim()) || cleanSlug || process.env.CWMP_DEFAULT_PASSWORD || 'cpe_cwmp_pass_2026';
  const connectionRequestUsername = process.env.CWMP_CONN_REQ_USER || (cleanSlug ? `cpe_${cleanSlug}` : 'cpe');
  const connectionRequestPassword = process.env.CWMP_CONN_REQ_PASS || (cleanSlug ? `${cleanSlug}_cpe` : 'cpe_password');
  const envInterval = parseInt(process.env.CWMP_RECOMMENDED_INFORM_INTERVAL || '300', 10);
  const periodicInformIntervalSeconds = Number.isFinite(envInterval) ? Math.max(60, envInterval) : 300;

  return {
    tenantSlug: cleanSlug,
    acsUsername,
    acsPassword,
    connectionRequestUsername,
    connectionRequestPassword,
    periodicInformIntervalSeconds,
  };
}

/**
 * Builds unified TR-069 CWMP ACS URLs, avoiding invalid subdomain URLs on bare IP hosts.
 */
export function buildPrimaryCwmpUrls(rawHost?: string, tenantSlug?: string): CwmpUrlSet {
  const host = (rawHost || process.env.ACS_HOST || 'localhost').split(':')[0].trim() || 'localhost';
  const cleanSlug = normalizeTenantSlug(tenantSlug);
  const pathSuffix = cleanSlug ? `/tr069/${cleanSlug}` : '/tr069';

  const cwmpPathUrl = `http://${host}:7547${pathSuffix}`;
  const port80Url = `http://${host}${pathSuffix}`;
  const isIpOrLocalhost =
    /^(\d{1,3}\.){3}\d{1,3}$/.test(host) ||
    host === 'localhost' ||
    host.includes(':');

  const subdomainUrl = (!isIpOrLocalhost && cleanSlug)
    ? `http://${cleanSlug}.${host}:7547`
    : cwmpPathUrl;

  return {
    primaryUrl: cwmpPathUrl,
    cwmpPathUrl,
    port80Url,
    subdomainUrl,
  };
}
