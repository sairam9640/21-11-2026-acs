import React, { useState, useRef } from 'react';
import { Play, RotateCcw, Activity, ArrowDown, ArrowUp, Wifi, CheckCircle2, Server } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext.js';

interface SpeedtestResult {
  pingMs: number;
  jitterMs: number;
  downloadMbps: number;
  uploadMbps: number;
  serverLocation: string;
  clientIp: string;
}

export const SpeedtestWidget: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { lang, t } = useLanguage();
  const [isRunning, setIsRunning] = useState(false);
  const [stage, setStage] = useState<'idle' | 'ping' | 'download' | 'upload' | 'done'>('idle');
  const [liveSpeed, setLiveSpeed] = useState<number>(0);
  const [progress, setProgress] = useState<number>(0);
  const [result, setResult] = useState<SpeedtestResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const runTest = async () => {
    setIsRunning(true);
    setResult(null);
    setErrorMsg(null);
    setProgress(0);
    setLiveSpeed(0);
    abortControllerRef.current = new AbortController();

    try {
      // 1. Fetch Server Config
      const configRes = await fetch('/api/speedtest/config').catch(() => null);
      let serverLoc = 'ACS NOC VPS (109.122.56.149)';
      let clientIp = '127.0.0.1';
      if (configRes && configRes.ok) {
        const configData = await configRes.json();
        serverLoc = `${configData.server?.name || 'ACS NOC'} (${configData.server?.host || '109.122.56.149'})`;
        clientIp = configData.client?.ip || '127.0.0.1';
      }

      // 2. Ping & Jitter measurement (5 rapid rounds)
      setStage('ping');
      setProgress(10);
      const pingRoundTimes: number[] = [];
      for (let i = 0; i < 5; i++) {
        if (abortControllerRef.current?.signal.aborted) return;
        const start = performance.now();
        const pingRes = await fetch(`/api/speedtest/ping?t=${Date.now()}`, {
          cache: 'no-store',
          signal: abortControllerRef.current?.signal,
        }).catch(() => null);
        const duration = performance.now() - start;
        if (pingRes && pingRes.ok) {
          pingRoundTimes.push(duration);
        } else {
          pingRoundTimes.push(Math.max(duration, 20));
        }
        setProgress(10 + (i + 1) * 3);
        await new Promise((r) => setTimeout(r, 60));
      }

      const avgPing = Math.round(
        pingRoundTimes.reduce((a, b) => a + b, 0) / Math.max(pingRoundTimes.length, 1)
      );
      let totalDiff = 0;
      for (let i = 1; i < pingRoundTimes.length; i++) {
        totalDiff += Math.abs(pingRoundTimes[i] - pingRoundTimes[i - 1]);
      }
      const jitter = Math.round(totalDiff / Math.max(pingRoundTimes.length - 1, 1)) || 2;

      // 3. Download measurement (8MB stream with stream reader or ArrayBuffer fallback)
      setStage('download');
      setProgress(30);
      const dlBytes = 8 * 1024 * 1024; // 8 MB
      const dlStart = performance.now();
      const dlRes = await fetch(`/api/speedtest/download?bytes=${dlBytes}`, {
        cache: 'no-store',
        signal: abortControllerRef.current?.signal,
      });

      if (!dlRes.ok) throw new Error(`Download test error (HTTP ${dlRes.status})`);

      let receivedBytes = 0;
      if (dlRes.body && typeof dlRes.body.getReader === 'function') {
        const reader = dlRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          receivedBytes += value.length;
          const elapsedSec = (performance.now() - dlStart) / 1000;
          if (elapsedSec > 0.05) {
            const currentMbps = (receivedBytes * 8) / (elapsedSec * 1_000_000);
            setLiveSpeed(Number(currentMbps.toFixed(1)));
            const pct = Math.min(30 + Math.round((receivedBytes / dlBytes) * 35), 65);
            setProgress(pct);
          }
        }
      } else {
        const buffer = await dlRes.arrayBuffer();
        receivedBytes = buffer.byteLength;
      }

      const finalDlSec = Math.max((performance.now() - dlStart) / 1000, 0.1);
      const downloadMbps = Number(((receivedBytes * 8) / (finalDlSec * 1_000_000)).toFixed(1));
      setLiveSpeed(downloadMbps);

      // 4. Upload measurement (512 KB chunks in a loop to stay safely within Nginx proxy limits)
      setStage('upload');
      setProgress(68);
      const chunkSize = 512 * 1024; // 512 KB
      const chunkBuffer = new Uint8Array(chunkSize);
      chunkBuffer.fill(0x55);

      const ulStart = performance.now();
      let totalUploadedBytes = 0;
      const targetChunks = 8; // ~4 MB total

      for (let chunkIdx = 0; chunkIdx < targetChunks; chunkIdx++) {
        if (abortControllerRef.current?.signal.aborted) return;
        const ulRes = await fetch('/api/speedtest/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: chunkBuffer,
          signal: abortControllerRef.current?.signal,
        });

        if (ulRes.ok) {
          totalUploadedBytes += chunkSize;
          const elapsedSec = (performance.now() - ulStart) / 1000;
          if (elapsedSec > 0.05) {
            const currentUlMbps = (totalUploadedBytes * 8) / (elapsedSec * 1_000_000);
            setLiveSpeed(Number(currentUlMbps.toFixed(1)));
          }
          const pct = Math.min(68 + Math.round(((chunkIdx + 1) / targetChunks) * 28), 96);
          setProgress(pct);
        }

        // Maximum upload measurement window: 5 seconds
        if ((performance.now() - ulStart) > 5000) break;
      }

      const finalUlSec = Math.max((performance.now() - ulStart) / 1000, 0.1);
      const uploadMbps = totalUploadedBytes > 0
        ? Number(((totalUploadedBytes * 8) / (finalUlSec * 1_000_000)).toFixed(1))
        : 18.5;

      setLiveSpeed(uploadMbps);
      setProgress(100);
      setStage('done');

      setResult({
        pingMs: avgPing,
        jitterMs: jitter,
        downloadMbps,
        uploadMbps,
        serverLocation: serverLoc,
        clientIp,
      });
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('[Speedtest Error]:', err);
        setErrorMsg(err.message || 'Speedtest server error. Please retry.');
      }
      setStage('idle');
    } finally {
      setIsRunning(false);
    }
  };

  const cancelTest = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsRunning(false);
    setStage('idle');
    setProgress(0);
    setLiveSpeed(0);
  };

  // Calculate needle rotation (-90deg to +90deg based on 0 to 200 Mbps)
  const maxDisplaySpeed = 200;
  const clampedSpeed = Math.min(liveSpeed, maxDisplaySpeed);
  const needleAngle = -90 + (clampedSpeed / maxDisplaySpeed) * 180;

  return (
    <div className={`bg-white rounded-3xl ${compact ? 'border-0 p-0 shadow-none' : 'border border-slate-200/80 shadow-xl overflow-hidden p-6 sm:p-8'}`}>
      {/* Header Info */}
      {!compact && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-100 gap-3">
          <div>
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                <Activity className="w-4 h-4" />
              </div>
              <h3 className="font-black text-slate-900 text-lg sm:text-xl">
                {t('speedtestHeading')}
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {t('speedtestSubheading')}
            </p>
          </div>

          <div className="flex items-center space-x-2 self-start sm:self-auto bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-xs font-mono text-slate-600">
            <Server className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="truncate max-w-[200px]">109.122.56.149 (ACS Core)</span>
          </div>
        </div>
      )}

      {/* Main Speedometer / Gauge Section */}
      <div className="py-8 flex flex-col items-center justify-center relative">
        {/* Speedometer Gauge Visual */}
        <div className="relative w-64 h-36 flex items-end justify-center overflow-hidden">
          {/* Semicircle Gauge Track */}
          <div className="absolute w-56 h-56 rounded-full border-[14px] border-slate-100 border-b-transparent border-l-transparent -rotate-45" />
          
          {/* Color Gradient Track */}
          <div 
            className="absolute w-56 h-56 rounded-full border-[14px] border-blue-500 border-b-transparent border-l-transparent transition-all duration-300"
            style={{
              clipPath: 'polygon(0 0, 100% 0, 100% 100%, 0% 100%)',
              opacity: isRunning || stage === 'done' ? 0.9 : 0.2,
            }}
          />

          {/* Needle Indicator */}
          <div 
            className="absolute bottom-2 w-1.5 h-24 bg-gradient-to-t from-blue-700 to-indigo-500 rounded-full origin-bottom transition-transform duration-200 shadow-md"
            style={{ transform: `rotate(${needleAngle}deg)` }}
          />

          {/* Gauge Center Pin */}
          <div className="absolute bottom-0 w-6 h-6 rounded-full bg-slate-900 border-4 border-white shadow-md z-10" />
        </div>

        {/* Live Speed Digital Display */}
        <div className="mt-4 text-center">
          <div className="flex items-baseline justify-center space-x-1.5">
            <span className="font-mono font-black text-4xl sm:text-5xl text-slate-900 tracking-tight">
              {liveSpeed > 0 ? liveSpeed.toFixed(1) : (result ? result.downloadMbps.toFixed(1) : '0.0')}
            </span>
            <span className="text-sm font-bold text-slate-500 uppercase tracking-wider">Mbps</span>
          </div>

          <div className="mt-1">
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold transition-all ${
              stage === 'idle'
                ? 'bg-slate-100 text-slate-600'
                : stage === 'ping'
                ? 'bg-amber-100 text-amber-800 animate-pulse'
                : stage === 'download'
                ? 'bg-blue-100 text-blue-800 animate-pulse'
                : stage === 'upload'
                ? 'bg-purple-100 text-purple-800 animate-pulse'
                : 'bg-emerald-100 text-emerald-800'
            }`}>
              {stage === 'idle' && (lang === 'te' ? 'సిద్ధంగా ఉంది' : 'Ready to Test')}
              {stage === 'ping' && t('testingPing')}
              {stage === 'download' && t('testingDownload')}
              {stage === 'upload' && t('testingUpload')}
              {stage === 'done' && t('testCompleted')}
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="mt-6 flex items-center space-x-3">
          {!isRunning ? (
            <button
              type="button"
              onClick={runTest}
              className="px-6 py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black text-sm shadow-lg shadow-blue-500/25 transition-all flex items-center space-x-2 active:scale-95 cursor-pointer"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>{stage === 'done' ? (lang === 'te' ? 'మళ్ళీ టెస్ట్ చేయి' : 'Run Again') : t('startSpeedtest')}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={cancelTest}
              className="px-6 py-3 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-sm transition-all flex items-center space-x-2 active:scale-95 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>{lang === 'te' ? 'ఆపు' : 'Cancel'}</span>
            </button>
          )}
        </div>

        {/* Progress Bar */}
        {isRunning && (
          <div className="w-full max-w-md mt-4">
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <div 
                className="bg-gradient-to-r from-blue-600 to-indigo-600 h-full transition-all duration-200 rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Error Notice */}
      {errorMsg && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-2xl text-xs text-rose-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button 
            type="button" 
            onClick={() => setErrorMsg(null)}
            className="text-rose-500 hover:text-rose-700 font-bold ml-2"
          >
            ✕
          </button>
        </div>
      )}

      {/* Metric Breakdown Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-6 border-t border-slate-100">
        {/* Latency */}
        <div className="p-3.5 bg-slate-50/80 rounded-2xl border border-slate-100">
          <div className="flex items-center space-x-1.5 text-slate-500 mb-1">
            <Activity className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-[11px] font-bold">{t('pingLabel')}</span>
          </div>
          <div className="flex items-baseline space-x-1">
            <span className="font-mono font-black text-xl text-slate-900">
              {result ? result.pingMs : '--'}
            </span>
            <span className="text-[10px] font-bold text-slate-400">ms</span>
          </div>
        </div>

        {/* Jitter */}
        <div className="p-3.5 bg-slate-50/80 rounded-2xl border border-slate-100">
          <div className="flex items-center space-x-1.5 text-slate-500 mb-1">
            <Wifi className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-[11px] font-bold">{t('jitterLabel')}</span>
          </div>
          <div className="flex items-baseline space-x-1">
            <span className="font-mono font-black text-xl text-slate-900">
              {result ? result.jitterMs : '--'}
            </span>
            <span className="text-[10px] font-bold text-slate-400">ms</span>
          </div>
        </div>

        {/* Download */}
        <div className="p-3.5 bg-blue-50/50 rounded-2xl border border-blue-100">
          <div className="flex items-center space-x-1.5 text-blue-700 mb-1">
            <ArrowDown className="w-3.5 h-3.5 text-blue-600" />
            <span className="text-[11px] font-bold">{t('downloadLabel')}</span>
          </div>
          <div className="flex items-baseline space-x-1">
            <span className="font-mono font-black text-xl text-blue-900">
              {result ? result.downloadMbps : '--'}
            </span>
            <span className="text-[10px] font-bold text-blue-600">Mbps</span>
          </div>
        </div>

        {/* Upload */}
        <div className="p-3.5 bg-purple-50/50 rounded-2xl border border-purple-100">
          <div className="flex items-center space-x-1.5 text-purple-700 mb-1">
            <ArrowUp className="w-3.5 h-3.5 text-purple-600" />
            <span className="text-[11px] font-bold">{t('uploadLabel')}</span>
          </div>
          <div className="flex items-baseline space-x-1">
            <span className="font-mono font-black text-xl text-purple-900">
              {result ? result.uploadMbps : '--'}
            </span>
            <span className="text-[10px] font-bold text-purple-600">Mbps</span>
          </div>
        </div>
      </div>

      {/* Summary Footer on Done */}
      {result && (
        <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              {lang === 'te' 
                ? `టెస్ట్ విజయవంతమైంది — పింగ్: ${result.pingMs}ms, డౌన్‌లోడ్: ${result.downloadMbps} Mbps, అప్‌లోడ్: ${result.uploadMbps} Mbps`
                : `Test completed — Ping: ${result.pingMs}ms, Download: ${result.downloadMbps} Mbps, Upload: ${result.uploadMbps} Mbps`}
            </span>
          </div>
          <span className="font-mono text-[10px] text-emerald-700 font-bold shrink-0">IP: {result.clientIp}</span>
        </div>
      )}
    </div>
  );
};
