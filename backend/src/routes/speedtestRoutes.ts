import { Router, Request, Response } from 'express';

export const speedtestRouter = Router();

// Reusable 64KB static buffer for high-throughput zero-copy streaming
const CHUNK_SIZE = 64 * 1024; // 64 KB
const staticChunk = Buffer.alloc(CHUNK_SIZE, 0xaa);

/**
 * GET /api/speedtest/config
 * Returns server location and metadata
 */
speedtestRouter.get('/config', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    server: {
      name: 'ACS High-Speed Core NOC',
      host: '109.122.56.149',
      location: 'Production VPS Datacenter',
      protocol: 'HTTP/1.1 & HTTP/2',
      maxDownloadMb: 50,
      maxUploadMb: 25,
      version: '2.4.0',
    },
    client: {
      ip: _req.headers['x-forwarded-for'] || _req.socket.remoteAddress || '127.0.0.1',
    },
    timestamp: Date.now(),
  });
});

/**
 * GET /api/speedtest/ping
 * Ultra-fast zero-overhead endpoint for Ping & Jitter measurement
 */
speedtestRouter.get('/ping', (req: Request, res: Response) => {
  const clientTime = req.query.t ? Number(req.query.t) : Date.now();
  const serverTime = Date.now();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return res.json({
    pong: true,
    clientTime,
    serverTime,
    diffMs: serverTime - clientTime,
  });
});

/**
 * GET /api/speedtest/download
 * High-speed byte stream generator for Download speed measurement
 * Query param: bytes (default: 10 MB = 10485760 bytes, max 50 MB)
 */
speedtestRouter.get('/download', (req: Request, res: Response) => {
  const requestedBytes = Math.min(
    Math.max(Number(req.query.bytes) || 10 * 1024 * 1024, 256 * 1024),
    50 * 1024 * 1024
  );

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', String(requestedBytes));
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  let sentBytes = 0;

  function sendNextChunk() {
    while (sentBytes < requestedBytes) {
      const remaining = requestedBytes - sentBytes;
      const chunkSize = Math.min(remaining, CHUNK_SIZE);
      const chunk = chunkSize === CHUNK_SIZE ? staticChunk : staticChunk.subarray(0, chunkSize);
      sentBytes += chunkSize;

      const canContinue = res.write(chunk);
      if (!canContinue) {
        res.once('drain', sendNextChunk);
        return;
      }
    }
    res.end();
  }

  sendNextChunk();
});

/**
 * POST /api/speedtest/upload
 * High-speed byte receiver for Upload speed measurement
 */
speedtestRouter.post('/upload', (req: Request, res: Response) => {
  const startTime = Date.now();
  let receivedBytes = 0;

  req.on('data', (chunk: Buffer) => {
    receivedBytes += chunk.length;
  });

  req.on('end', () => {
    const durationMs = Math.max(Date.now() - startTime, 1);
    const speedBps = (receivedBytes * 8) / (durationMs / 1000);
    const speedMbps = Number((speedBps / 1_000_000).toFixed(2));

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.json({
      success: true,
      receivedBytes,
      durationMs,
      speedMbps,
    });
  });

  req.on('error', (err) => {
    res.status(500).json({ success: false, error: err.message });
  });
});
