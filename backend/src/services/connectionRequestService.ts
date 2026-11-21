import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { Device } from '../models/Device.js';

interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
}

/**
 * Parse RFC 2617 WWW-Authenticate Digest header from CPE
 */
function parseDigestChallenge(authHeader?: string): DigestChallenge | null {
  if (!authHeader || !authHeader.toLowerCase().includes('digest')) {
    return null;
  }

  const parseParam = (key: string): string | undefined => {
    const match = authHeader.match(new RegExp(`${key}="?([^",\\s]+)"?`, 'i'));
    return match ? match[1] : undefined;
  };

  const realm = parseParam('realm');
  const nonce = parseParam('nonce');

  if (!realm || !nonce) return null;

  return {
    realm,
    nonce,
    qop: parseParam('qop'),
    opaque: parseParam('opaque'),
    algorithm: parseParam('algorithm') || 'MD5',
  };
}

function md5(str: string): string {
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Construct RFC 2617 Authorization: Digest header for CPE challenge response
 */
function buildDigestAuthorization(
  challenge: DigestChallenge,
  username: string,
  password: string,
  method: string,
  uri: string
): string {
  let ha1 = md5(`${username}:${challenge.realm}:${password}`);
  const cnonce = crypto.randomBytes(8).toString('hex');
  const nc = '00000001';

  if (challenge.algorithm?.toUpperCase() === 'MD5-SESS') {
    ha1 = md5(`${ha1}:${challenge.nonce}:${cnonce}`);
  }

  const ha2 = md5(`${method}:${uri}`);

  let response: string;
  if (challenge.qop && challenge.qop.toLowerCase().includes('auth')) {
    response = md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:auth:${ha2}`);
  } else {
    response = md5(`${ha1}:${challenge.nonce}:${ha2}`);
  }

  const parts = [
    `Digest username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];

  if (challenge.qop && challenge.qop.toLowerCase().includes('auth')) {
    parts.push(`qop="auth"`, `nc=${nc}`, `cnonce="${cnonce}"`);
  }
  if (challenge.opaque) {
    parts.push(`opaque="${challenge.opaque}"`);
  }
  if (challenge.algorithm) {
    parts.push(`algorithm="${challenge.algorithm}"`);
  }

  return parts.join(', ');
}

/**
 * Sends direct Connection Request to CPE with RFC 2617 HTTP Digest Challenge Handshake
 */
async function sendDirectConnectionRequest(
  crUrl: string,
  username: string,
  password: string
): Promise<boolean> {
  let urlObj: URL;
  try {
    urlObj = new URL(crUrl);
  } catch {
    console.warn(`[ConnectionRequest] Malformed ConnectionRequestURL: ${crUrl}`);
    return false;
  }

  const transport = urlObj.protocol === 'https:' ? https : http;
  const path = urlObj.pathname + (urlObj.search || '');
  const port = urlObj.port ? parseInt(urlObj.port, 10) : (urlObj.protocol === 'https:' ? 443 : 80);

  // Fallback to URL-embedded credentials if explicit credentials were empty
  const user = username || decodeURIComponent(urlObj.username) || 'admin';
  const pass = password || decodeURIComponent(urlObj.password) || 'admin';

  // Step 1: Initial unauthenticated probe (CPE usually replies 401 with WWW-Authenticate)
  const initialResult = await new Promise<{ statusCode?: number; authHeader?: string }>((resolve) => {
    const req = transport.request({
      hostname: urlObj.hostname,
      port,
      path,
      method: 'GET',
      headers: {
        'User-Agent': 'AI-ISP-ACS/2.0 (TR-069 CWMP Engine)',
        'Connection': 'close',
      },
      timeout: 3000,
    }, (res) => {
      resolve({
        statusCode: res.statusCode,
        authHeader: (res.headers['www-authenticate'] as string) || undefined,
      });
      res.resume();
    });
    req.on('error', (err) => {
      console.warn(`[ConnectionRequest] Initial GET failed to ${urlObj.hostname}:${port}: ${err.message}`);
      resolve({ statusCode: 500 });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ statusCode: 408 });
    });
    req.end();
  });

  // If CPE allows unauthenticated Connection Request (some low-end ONTs)
  if (initialResult.statusCode === 200 || initialResult.statusCode === 204) {
    console.log(`[ConnectionRequest] Direct CR accepted without challenge by ${urlObj.hostname}:${port}`);
    return true;
  }

  // Step 2: Handle HTTP 401 Digest Challenge
  if (initialResult.statusCode === 401 && initialResult.authHeader) {
    const challenge = parseDigestChallenge(initialResult.authHeader);
    if (!challenge) {
      console.warn(`[ConnectionRequest] Unparseable WWW-Authenticate header: ${initialResult.authHeader}`);
      return false;
    }

    const authHeaderValue = buildDigestAuthorization(challenge, user, pass, 'GET', path);

    return await new Promise<boolean>((resolve) => {
      const authedReq = transport.request({
        hostname: urlObj.hostname,
        port,
        path,
        method: 'GET',
        headers: {
          'Authorization': authHeaderValue,
          'User-Agent': 'AI-ISP-ACS/2.0 (TR-069 CWMP Engine)',
          'Connection': 'close',
        },
        timeout: 3000,
      }, (res) => {
        const ok = res.statusCode === 200 || res.statusCode === 204;
        if (ok) {
          console.log(`[ConnectionRequest] Digest handshake SUCCESS (HTTP ${res.statusCode}) for ${urlObj.hostname}:${port}`);
        } else {
          console.warn(`[ConnectionRequest] Digest handshake REJECTED (HTTP ${res.statusCode}) by ${urlObj.hostname}:${port}`);
        }
        resolve(ok);
        res.resume();
      });

      authedReq.on('error', (err) => {
        console.warn(`[ConnectionRequest] Digest response request failed: ${err.message}`);
        resolve(false);
      });
      authedReq.on('timeout', () => {
        authedReq.destroy();
        resolve(false);
      });
      authedReq.end();
    });
  }

  return false;
}

/**
 * Trigger on-demand TR-069 Connection Request via internal GenieACS NBI (port 7557)
 * or via direct RFC 2617 Digest Authenticated ConnectionRequestURL to force the ONT to check in immediately.
 */
export async function triggerGenieAcsConnectionRequest(serialNumber: string): Promise<boolean> {
  if (!serialNumber) return false;

  // 1. Try GenieACS NBI (port 7557) first if local cluster has GenieACS sidecar active
  const genieSuccess = await new Promise<boolean>((resolve) => {
    const queryPath = `/devices/?query={"_id":{"$regex":"${encodeURIComponent(serialNumber)}","$options":"i"}}&projection=_id`;
    const req = http.request({
      hostname: '127.0.0.1',
      port: 7557,
      path: queryPath,
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      timeout: 1500,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const devs = JSON.parse(data);
          if (Array.isArray(devs) && devs.length > 0) {
            const genieId = devs[0]._id;
            const taskReq = http.request({
              hostname: '127.0.0.1',
              port: 7557,
              path: `/devices/${encodeURIComponent(genieId)}/tasks?connection_request`,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              timeout: 2000,
            }, (taskRes) => {
              resolve(taskRes.statusCode === 200 || taskRes.statusCode === 202);
            });
            taskReq.on('error', () => resolve(false));
            taskReq.write(JSON.stringify({ name: 'refreshObject', objectName: '' }));
            taskReq.end();
          } else {
            resolve(false);
          }
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.end();
  });

  if (genieSuccess) return true;

  // 2. Direct RFC 2617 Digest Authenticated Connection Request to physical ONT
  try {
    const dev = await Device.findOne({
      $or: [
        { serialNumber },
        { serialNumber: serialNumber.toLowerCase() },
        { serialNumber: serialNumber.toUpperCase() },
      ],
    });

    const crUrl = (dev as any)?.connectionRequestUrl ||
      dev?.rawParameters?.['InternetGatewayDevice.ManagementServer.ConnectionRequestURL'] ||
      dev?.rawParameters?.['Device.ManagementServer.ConnectionRequestURL'];

    if (crUrl && typeof crUrl === 'string' && crUrl.startsWith('http')) {
      const username = (dev as any)?.connectionRequestUsername ||
        dev?.rawParameters?.['InternetGatewayDevice.ManagementServer.ConnectionRequestUsername'] ||
        dev?.rawParameters?.['Device.ManagementServer.ConnectionRequestUsername'] ||
        dev?.cwmpUsername ||
        'admin';

      const password = (dev as any)?.connectionRequestPassword ||
        dev?.rawParameters?.['InternetGatewayDevice.ManagementServer.ConnectionRequestPassword'] ||
        dev?.rawParameters?.['Device.ManagementServer.ConnectionRequestPassword'] ||
        dev?.cwmpPassword ||
        'admin';

      return await sendDirectConnectionRequest(crUrl, username, password);
    }
  } catch (err: any) {
    console.warn(`[ConnectionRequest] Direct ConnectionRequest exception for ${serialNumber}:`, err.message);
  }

  return false;
}
