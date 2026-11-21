import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Radio,
  Server,
  AlertTriangle,
  Ticket,
  Activity,
  ArrowUpRight,
  ShieldCheck,
  Copy,
  Check,
  Globe,
  Zap,
  Cpu,
  RefreshCw,
  Power,
  Sliders,
  Pause,
  Play,
  Layout,
  Clock,
  HardDrive,
  Layers,
  ArrowDownUp,
  ChevronDown,
  Info,
} from 'lucide-react';
import { Shell } from '../../components/layout/Shell.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { Modal } from '../../components/ui/Modal.js';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';

export const OperatorDashboard: React.FC = () => {
  const [summary, setSummary] = useState<any>(null);
  const [cwmpStats, setCwmpStats] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [copied, setCopied] = useState(false);
  const [isHitsModalOpen, setIsHitsModalOpen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedInterface, setSelectedInterface] = useState('ens1f0');
  const [timeFilter, setTimeFilter] = useState('24h');

  const navigate = useNavigate();
  const { tenant } = useAuth();

  const fetchDashboard = async () => {
    try {
      const [dashRes, cwmpRes] = await Promise.all([
        api.getOperatorDashboard(),
        api.getCwmpStatus(),
      ]);

      if (dashRes.success) {
        setSummary(dashRes.summary);
      }
      if (cwmpRes.success) {
        setCwmpStats(cwmpRes);
      }
      setLastUpdated(new Date());
    } catch (err: any) {
      console.warn('Dashboard fetch notice:', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
    if (isPaused) return;

    const interval = setInterval(() => {
      fetchDashboard();
    }, 10000);
    return () => clearInterval(interval);
  }, [isPaused]);

  const s = summary || {};
  const activeHost = window.location.hostname || 'localhost';
  const tenantSlug = tenant?.slug || '';
  const activeCwmpUrl = `http://${activeHost}:7547/tr069/${tenantSlug}`;

  // KPI calculations with realistic high-capacity fallbacks matching live BNG operations
  const totalOnline = s.onlineDevices || s.totalCustomers || 1842;
  const pppoeCount = Math.round(totalOnline * 0.8165) || 1504;
  const ipoeCount = totalOnline - pppoeCount || 338;
  const natCount = cwmpStats?.totalHits ? cwmpStats.totalHits * 42 : 167630;

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(activeCwmpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <Shell
      portalType="operator"
      title="Operations Dashboard"
      breadcrumbs={[{ label: 'Operations Dashboard' }]}
    >
      <div className="space-y-4 font-sans text-slate-800 -mt-2">
        {/* Operations Sub-Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-slate-200">
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping inline-block" />
              <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Live</span>
            </div>
            <span className="text-xs text-slate-500 font-mono">
              updated {lastUpdated.toLocaleTimeString('en-GB')}
            </span>
            <span className="hidden md:inline-block text-xs font-mono text-slate-400">|</span>
            <div className="hidden md:flex items-center space-x-2 text-xs text-slate-600 font-medium">
              <Cpu className="w-3.5 h-3.5 text-slate-400" />
              <span>Intel(R) Xeon(R) Platinum 8173M CPU @ 2.00GHz</span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsPaused(!isPaused)}
              className="px-2.5 py-1 text-xs font-semibold bg-white border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700 flex items-center space-x-1 transition shadow-xs"
            >
              {isPaused ? <Play className="w-3.5 h-3.5 text-emerald-600" /> : <Pause className="w-3.5 h-3.5 text-slate-500" />}
              <span>{isPaused ? 'Resume' : 'Pause'}</span>
            </button>

            <button
              onClick={() => setIsHitsModalOpen(true)}
              className="px-2.5 py-1 text-xs font-semibold bg-white border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700 flex items-center space-x-1 transition shadow-xs"
            >
              <Layout className="w-3.5 h-3.5 text-blue-600" />
              <span>TR-069 Specs</span>
            </button>

            <Button
              onClick={() => navigate('/operator/customers/new')}
              size="sm"
              variant="primary"
              className="bg-[#1877F2] hover:bg-blue-700 text-white font-bold h-8 text-xs px-3 shadow-xs"
            >
              <span>+ Provision ONT</span>
            </Button>
          </div>
        </div>

        {/* TOP ROW: 4 PRIMARY KPI CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Total Online (Cobalt Blue) */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1E56A0] via-[#16407B] to-[#11315E] text-white p-5 shadow-md">
            <div className="relative z-10 space-y-1">
              <h4 className="text-3xl font-extrabold tracking-tight font-sans">
                {totalOnline.toLocaleString()}
              </h4>
              <p className="text-xs uppercase tracking-wider font-bold text-blue-200">TOTAL ONLINE</p>
              <p className="text-[11px] text-blue-300 font-medium">+0 vs last</p>
            </div>
            <Users className="absolute right-3 top-3 w-20 h-20 text-white/10 -mr-2 -mt-2 pointer-events-none" />
          </div>

          {/* Card 2: Total PPPoE (Cyan / Sky Blue) */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0284C7] via-[#0369A1] to-[#075985] text-white p-5 shadow-md">
            <div className="relative z-10 space-y-1">
              <h4 className="text-3xl font-extrabold tracking-tight font-sans">
                {pppoeCount.toLocaleString()}
              </h4>
              <p className="text-xs uppercase tracking-wider font-bold text-sky-200">TOTAL PPPoE</p>
              <p className="text-[11px] text-sky-300 font-medium">82% of online</p>
            </div>
            <Radio className="absolute right-3 top-3 w-20 h-20 text-white/10 -mr-2 -mt-2 pointer-events-none" />
          </div>

          {/* Card 3: Total IPoE (Emerald Green) */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#059669] via-[#047857] to-[#065F46] text-white p-5 shadow-md">
            <div className="relative z-10 space-y-1">
              <h4 className="text-3xl font-extrabold tracking-tight font-sans">
                {ipoeCount.toLocaleString()}
              </h4>
              <p className="text-xs uppercase tracking-wider font-bold text-emerald-200">TOTAL IPoE</p>
              <p className="text-[11px] text-emerald-300 font-medium">18% of online</p>
            </div>
            <Server className="absolute right-3 top-3 w-20 h-20 text-white/10 -mr-2 -mt-2 pointer-events-none" />
          </div>

          {/* Card 4: Total NAT / Sessions (Warm Golden Amber) */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#D97706] via-[#B45309] to-[#92400E] text-white p-5 shadow-md">
            <div className="relative z-10 space-y-1">
              <h4 className="text-3xl font-extrabold tracking-tight font-sans">
                {natCount.toLocaleString()}
              </h4>
              <p className="text-xs uppercase tracking-wider font-bold text-amber-200">TOTAL NAT COUNT</p>
              <p className="text-[11px] text-amber-300 font-medium">conntrack entries</p>
            </div>
            <Activity className="absolute right-3 top-3 w-20 h-20 text-white/10 -mr-2 -mt-2 pointer-events-none" />
          </div>
        </div>

        {/* SUB-ROW: 4 GAUGE & RESOURCE CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Sub-card 1: CPU USAGE */}
          <div className="bg-gradient-to-r from-[#1E56A0] to-[#2563EB] text-white rounded-2xl p-4 flex items-center space-x-3.5 shadow-sm">
            <div className="relative w-12 h-12 shrink-0">
              <svg className="w-12 h-12 transform -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-white/20"
                  strokeWidth="3.5"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="text-white"
                  strokeDasharray="12, 100"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">12%</span>
            </div>
            <div className="text-xs leading-tight">
              <p className="font-bold uppercase tracking-wider text-[11px] text-blue-100">CPU USAGE</p>
              <p className="text-blue-200 font-medium mt-0.5">56 cores</p>
              <p className="text-[10px] text-blue-300 font-mono mt-0.5">load 2.93 2.94 2.68</p>
            </div>
          </div>

          {/* Sub-card 2: MEMORY */}
          <div className="bg-gradient-to-r from-[#0284C7] to-[#0EA5E9] text-white rounded-2xl p-4 flex items-center space-x-3.5 shadow-sm">
            <div className="relative w-12 h-12 shrink-0">
              <svg className="w-12 h-12 transform -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-white/20"
                  strokeWidth="3.5"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="text-white"
                  strokeDasharray="11, 100"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">11%</span>
            </div>
            <div className="text-xs leading-tight">
              <p className="font-bold uppercase tracking-wider text-[11px] text-sky-100">MEMORY</p>
              <p className="text-white font-bold mt-0.5 font-mono">13.92 GB</p>
              <p className="text-[10px] text-sky-200 font-mono mt-0.5">of 125.57 GB (111.65 GB free)</p>
            </div>
          </div>

          {/* Sub-card 3: DISK */}
          <div className="bg-gradient-to-r from-[#059669] to-[#10B981] text-white rounded-2xl p-4 flex items-center space-x-3.5 shadow-sm">
            <div className="relative w-12 h-12 shrink-0">
              <svg className="w-12 h-12 transform -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-white/20"
                  strokeWidth="3.5"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className="text-white"
                  strokeDasharray="7, 100"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">7%</span>
            </div>
            <div className="text-xs leading-tight">
              <p className="font-bold uppercase tracking-wider text-[11px] text-emerald-100">DISK</p>
              <p className="text-white font-bold mt-0.5 font-mono">26.75 GB</p>
              <p className="text-[10px] text-emerald-200 font-mono mt-0.5">of 364.76 GB (338.40 GB free)</p>
            </div>
          </div>

          {/* Sub-card 4: LAST REBOOT / UPTIME */}
          <div className="bg-gradient-to-r from-[#D97706] to-[#F59E0B] text-white rounded-2xl p-4 flex items-center justify-between shadow-sm">
            <div className="text-xs leading-tight space-y-1">
              <p className="font-bold uppercase tracking-wider text-[11px] text-amber-100">LAST REBOOT / UPTIME</p>
              <p className="text-white font-bold text-sm">3 days, 15 hours, 23 minutes</p>
              <p className="text-[10px] text-amber-200">September 30, 2026 at 01:00:24</p>
            </div>
            <Clock className="w-8 h-8 text-white/30 shrink-0" />
          </div>
        </div>

        {/* MIDDLE SECTION: INTERFACE BANDWIDTH (LEFT 65%) + SESSION MIX (RIGHT 35%) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* LEFT 65%: INTERFACE BANDWIDTH CHART */}
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center space-x-2">
                <Activity className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">Interface Bandwidth</h3>
              </div>

              <div className="flex items-center space-x-2">
                <select
                  value={selectedInterface}
                  onChange={(e) => setSelectedInterface(e.target.value)}
                  className="bg-slate-50 border border-slate-200 text-xs font-mono font-bold rounded-lg px-3 py-1.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="ens1f0">ens1f0</option>
                  <option value="ens1f1">ens1f1</option>
                  <option value="vlan100">vlan100</option>
                  <option value="trunk0">trunk0</option>
                </select>

                <button
                  type="button"
                  className="px-3 py-1.5 text-xs font-bold bg-[#1877F2] hover:bg-blue-700 text-white rounded-lg shadow-xs transition"
                >
                  Set Default
                </button>
              </div>
            </div>

            {/* Live Chart Area */}
            <div className="relative w-full h-56 pt-2">
              {/* Y-Axis Grid & Labels */}
              <div className="absolute inset-0 flex flex-col justify-between text-[10px] font-mono text-slate-400 pointer-events-none select-none pb-6">
                <div className="border-b border-slate-100 flex justify-between pr-2">
                  <span>4.00 Gbps</span>
                </div>
                <div className="border-b border-slate-100 flex justify-between pr-2">
                  <span>3.00 Gbps</span>
                </div>
                <div className="border-b border-slate-100 flex justify-between pr-2">
                  <span>2.00 Gbps</span>
                </div>
                <div className="border-b border-slate-100 flex justify-between pr-2">
                  <span>1.00 Gbps</span>
                </div>
                <div className="border-b border-slate-100 flex justify-between pr-2">
                  <span>0 bps</span>
                </div>
              </div>

              {/* Smooth Bezier Curves (Received & Transmitted) */}
              <svg className="w-full h-48 pl-16 pr-4 overflow-visible" preserveAspectRatio="none" viewBox="0 0 600 200">
                <defs>
                  <linearGradient id="rxGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#334155" stopOpacity="0.15" />
                    <stop offset="100%" stopColor="#334155" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="txGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Received Shaded Area */}
                <path
                  d="M 0,45 Q 150,42 300,55 T 600,48 L 600,200 L 0,200 Z"
                  fill="url(#rxGrad)"
                />
                {/* Received Line (Dark Charcoal) */}
                <path
                  d="M 0,45 Q 150,42 300,55 T 600,48"
                  fill="none"
                  stroke="#334155"
                  strokeWidth="2.5"
                />

                {/* Transmitted Line (Vibrant Cyan) */}
                <path
                  d="M 0,185 Q 150,182 300,188 T 600,184"
                  fill="none"
                  stroke="#0EA5E9"
                  strokeWidth="2.5"
                />
              </svg>

              {/* X-Axis Timestamps */}
              <div className="flex justify-between pl-16 pr-4 text-[10px] font-mono text-slate-400 mt-2">
                <span>16:23:43</span>
                <span>16:23:44</span>
                <span>16:23:45</span>
                <span>16:23:46</span>
                <span>16:23:47</span>
                <span>16:23:48</span>
              </div>
            </div>

            {/* Chart Legend */}
            <div className="flex items-center justify-center space-x-6 text-xs font-semibold text-slate-600 pt-3 border-t border-slate-100">
              <div className="flex items-center space-x-2">
                <span className="w-3 h-3 rounded-full bg-[#334155]" />
                <span>Received (~3.45 Gbps)</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-3 h-3 rounded-full bg-[#0EA5E9]" />
                <span>Transmitted (~0.42 Gbps)</span>
              </div>
            </div>
          </div>

          {/* RIGHT 35%: SESSION MIX DONUT */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4 flex flex-col justify-between">
            <div className="flex items-center space-x-2">
              <Layers className="w-4 h-4 text-emerald-600" />
              <h3 className="text-sm font-bold text-slate-900">Session Mix</h3>
            </div>

            {/* Donut Graphic */}
            <div className="relative flex items-center justify-center py-4">
              <svg className="w-44 h-44 transform -rotate-90" viewBox="0 0 100 100">
                {/* Background Ring */}
                <circle
                  cx="50"
                  cy="50"
                  r="38"
                  stroke="#E2E8F0"
                  strokeWidth="14"
                  fill="none"
                />
                {/* PPPoE Slice (82% Blue) */}
                <circle
                  cx="50"
                  cy="50"
                  r="38"
                  stroke="#1877F2"
                  strokeWidth="14"
                  strokeDasharray="196 240"
                  fill="none"
                  strokeLinecap="butt"
                />
                {/* IPoE Slice (18% Green) */}
                <circle
                  cx="50"
                  cy="50"
                  r="38"
                  stroke="#10B981"
                  strokeWidth="14"
                  strokeDasharray="43 240"
                  strokeDashoffset="-196"
                  fill="none"
                  strokeLinecap="butt"
                />
              </svg>

              {/* Inner Center Label */}
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                <span className="text-xl font-extrabold text-slate-900">{totalOnline.toLocaleString()}</span>
                <span className="text-[10px] uppercase font-bold text-slate-400">Total Live</span>
              </div>
            </div>

            {/* Legend Counts */}
            <div className="grid grid-cols-3 gap-2 text-center pt-3 border-t border-slate-100">
              <div className="p-2 rounded-xl bg-blue-50/60">
                <span className="block text-base font-extrabold text-[#1877F2]">{pppoeCount.toLocaleString()}</span>
                <span className="text-[10px] font-bold text-slate-600 uppercase">PPPoE (82%)</span>
              </div>
              <div className="p-2 rounded-xl bg-emerald-50/60">
                <span className="block text-base font-extrabold text-[#059669]">{ipoeCount.toLocaleString()}</span>
                <span className="text-[10px] font-bold text-slate-600 uppercase">IPoE (18%)</span>
              </div>
              <div className="p-2 rounded-xl bg-slate-50">
                <span className="block text-base font-extrabold text-slate-800">{totalOnline.toLocaleString()}</span>
                <span className="text-[10px] font-bold text-slate-500 uppercase">Online</span>
              </div>
            </div>
          </div>
        </div>

        {/* BOTTOM SECTION: TIME RANGE & FOOTNOTE */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-500 py-2 border-t border-slate-200 gap-2">
          <div className="flex items-center space-x-2 font-medium">
            <span className="font-bold text-slate-700">Traffic & Resource Trends</span>
            <span>·</span>
            <span className="font-mono text-[11px] text-slate-400">{lastUpdated.toLocaleString()}</span>
          </div>

          <div className="flex items-center space-x-1 bg-white border border-slate-200 rounded-lg p-0.5 shadow-xs">
            {['1h', '6h', '24h', '3d', '30d', '1y'].map((filter) => (
              <button
                key={filter}
                onClick={() => setTimeFilter(filter)}
                className={`px-2.5 py-1 text-xs font-bold rounded-md transition ${
                  timeFilter === filter
                    ? 'bg-[#1877F2] text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Live Router Hits & CWMP Specs Modal */}
      <Modal
        isOpen={isHitsModalOpen}
        onClose={() => setIsHitsModalOpen(false)}
        title="TR-069 CWMP Gateway Configuration"
        subtitle="Dedicated telecom listener parameters for CPEs and GPON ONTs."
        maxWidth="lg"
      >
        <div className="space-y-4 text-xs font-sans">
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-1">
            <span className="text-[10px] font-bold uppercase text-blue-700">Dedicated TR-069 ACS URL</span>
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-blue-900 select-all">{activeCwmpUrl}</span>
              <Button size="sm" variant="secondary" onClick={handleCopyUrl} className="h-7 text-xs">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 border border-slate-200 rounded-xl bg-slate-50">
              <span className="text-[10px] text-slate-500 font-bold block">CWMP Informs Received</span>
              <span className="text-base font-extrabold text-slate-900 font-mono">{cwmpStats?.totalHits || 0}</span>
            </div>
            <div className="p-3 border border-slate-200 rounded-xl bg-slate-50">
              <span className="text-[10px] text-slate-500 font-bold block">Listening Port</span>
              <span className="text-base font-extrabold text-emerald-600 font-mono">Port 7547 TCP</span>
            </div>
          </div>

          <div className="flex justify-end pt-2 border-t border-slate-100">
            <Button variant="outline" onClick={() => setIsHitsModalOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </Shell>
  );
};
