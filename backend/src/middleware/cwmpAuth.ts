import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { Device } from '../models/Device.js';
import { Tenant } from '../models/Tenant.js';
import { RedisService } from '../services/redisService.js';

interface ParsedDigestAuth {
  username: string;
  realm: string;
  nonce: string;
  uri: string;
  response: string;
  qop?: string;
  nc?: string;
  cnonce?: string;
  opaque?: string;
  algorithm?: string;
}

function parseAuthorizationHeader(header?: string): ParsedDigestAuth | null {
  if (!header || !header.toLowerCase().startsWith('digest ')) {
    return null;
  }

  const parseParam = (key: string): string | undefined => {
    const match = header.match(new RegExp(`${key}=(?:"([^"]+)"|([a-zA-Z0-9_-]+))`, 'i'));
    return match ? (match[1] || match[2]) : undefined;
  };

  const username = parseParam('username');
  const realm = parseParam('realm');
  const nonce = parseParam('nonce');
  const uri = parseParam('uri');
  const response = parseParam('response');

  if (!username || !realm || !nonce || !response) {
    return null;
  }

  return {
    username,
    realm,
    nonce,
    uri: uri || '',
    response,
    qop: parseParam('qop'),
    nc: parseParam('nc'),
    cnonce: parseParam('cnonce'),
    opaque: parseParam('opaque'),
    algorithm: parseParam('algorithm') || 'MD5',
  };
}

function md5(str: string): string {
  return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Generate a cryptographically secure nonce with 300s expiration
 */
async function generateNonce(): Promise<string> {
  const nonce = crypto.randomBytes(16).toString('hex');
  await RedisService.set(`cwmp:nonce:${nonce}`, '1', 300);
  return nonce;
}

/**
 * Verify if the nonce was issued by this ACS and is not expired
 */
async function isValidNonce(nonce: string): Promise<boolean> {
  const val = await RedisService.get<string>(`cwmp:nonce:${nonce}`);
  return val !== null;
}

/**
 * TR-069 Inbound HTTP Digest Authentication Middleware
 * Enforces RFC 2617 authentication when enabled or when credentials are provided.
 */
export async function cwmpDigestAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void | Response> {
  // Pass through GET probes, non-POST requests, and all REST API / health routes without challenge
  const url = req.originalUrl || req.url || '';
  if (req.method !== 'POST' || url.startsWith('/api') || url.startsWith('/health')) {
    return next();
  }

  const authHeader = req.headers['authorization'];

  // If Authorization header is a Bearer token (JWT REST API authentication), pass through immediately
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return next();
  }

  // If global CWMP auth requirement is toggled via ENV or tenant config
  const isAuthRequired = process.env.CWMP_REQUIRE_AUTH === 'true';

  // If no auth required globally and CPE sent no credentials, allow through (e.g. initial ZTP discovery)
  if (!isAuthRequired && !authHeader) {
    return next();
  }

  // 1. Challenge CPE if no Authorization header is present
  if (!authHeader) {
    const nonce = await generateNonce();
    res.setHeader(
      'WWW-Authenticate',
      `Digest realm="ACS", nonce="${nonce}", qop="auth", algorithm="MD5", opaque="${crypto.randomBytes(8).toString('hex')}"`
    );
    return res.status(401).send();
  }

  // 2. Validate Digest Credentials
  const digest = parseAuthorizationHeader(authHeader);
  if (!digest) {
    const nonce = await generateNonce();
    res.setHeader(
      'WWW-Authenticate',
      `Digest realm="ACS", nonce="${nonce}", qop="auth", algorithm="MD5"`
    );
    return res.status(401).send();
  }

  // Check nonce validity
  const validNonce = await isValidNonce(digest.nonce);
  if (!validNonce && isAuthRequired) {
    const freshNonce = await generateNonce();
    res.setHeader(
      'WWW-Authenticate',
      `Digest realm="ACS", nonce="${freshNonce}", stale=TRUE, qop="auth", algorithm="MD5"`
    );
    return res.status(401).send();
  }

  // 3. Resolve password for username
  // Look for device by cwmpUsername, serialNumber, or tenant credentials
  let expectedPassword = process.env.CWMP_DEFAULT_PASSWORD || 'cpe_cwmp_pass_2026';

  try {
    const dev = await Device.findOne({
      $or: [
        { cwmpUsername: digest.username },
        { serialNumber: digest.username },
        { macAddress: digest.username.toLowerCase() },
      ],
    }).select('+cwmpPassword');

    if (dev && dev.cwmpPassword) {
      expectedPassword = dev.cwmpPassword;
    } else {
      // Check tenant secret
      const tenant = req.params.tenantSlug ? await Tenant.findOne({ slug: req.params.tenantSlug.toLowerCase() }) : null;
      if (tenant && (tenant as any).cwmpPassword) {
        expectedPassword = (tenant as any).cwmpPassword;
      }
    }
  } catch (err: any) {
    console.warn('[CWMP Auth] Database credential lookup error:', err.message);
  }

  // 4. Compute Expected Response Hash
  let ha1 = md5(`${digest.username}:${digest.realm}:${expectedPassword}`);
  if (digest.algorithm?.toUpperCase() === 'MD5-SESS' && digest.cnonce) {
    ha1 = md5(`${ha1}:${digest.nonce}:${digest.cnonce}`);
  }

  const uri = digest.uri || req.originalUrl || req.url;
  const ha2 = md5(`${req.method}:${uri}`);

  let expectedHash: string;
  if (digest.qop && digest.qop.toLowerCase().includes('auth') && digest.nc && digest.cnonce) {
    expectedHash = md5(`${ha1}:${digest.nonce}:${digest.nc}:${digest.cnonce}:auth:${ha2}`);
  } else {
    expectedHash = md5(`${ha1}:${digest.nonce}:${ha2}`);
  }

  if (digest.response === expectedHash) {
    (req as any).cwmpUser = digest.username;
    (req as any).cwmpAuthenticated = true;
    return next();
  }

  // Auth failed - challenge again
  console.warn(`[CWMP Auth] Digest challenge failed for user ${digest.username} from ${req.ip}`);
  const nonce = await generateNonce();
  res.setHeader(
    'WWW-Authenticate',
    `Digest realm="ACS", nonce="${nonce}", qop="auth", algorithm="MD5"`
  );
  return res.status(401).send();
}
