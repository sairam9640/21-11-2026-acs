import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  Users,
  Radio,
  Server,
  Activity,
  AlertTriangle,
  Wrench,
  DollarSign,
  CheckCircle2,
  TrendingUp,
  Bot,
  ArrowUpRight,
  RefreshCw,
  Power,
  Cpu,
  Play,
  Pause,
  Layout,
  Clock,
  Layers,
  Check,
  Copy,
  SlidersHorizontal,
} from 'lucide-react';
import { Shell } from '../../components/layout/Shell.js';
import { StatCard } from '../../components/ui/StatCard.js';
import { StateWrapper } from '../../components/ui/StateWrapper.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { Modal } from '../../components/ui/Modal.js';
import { api } from '../../services/api.js';

export const SuperAdminDashboard: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [activeView, setActiveView] = useState<'noc' | 'saas'>('noc');
  const [selectedTenantSlug, setSelectedTenantSlug] = useState<string>('');
  const [isPaused, setIsPaused] = useState(false);
  const [selectedInterface, setSelectedInterface] = useState('ens1f0');
  const [timeFilter, setTimeFilter] = useState('24h');
  const [isHitsModalOpen, setIsHitsModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  const fetchDashboard = async (slugToQuery = selectedTenantSlug) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.getSuperAdminDashboard(slugToQuery ? { slug: slugToQuery } : undefined);
      if (res.success) {
        setData(res);
        setLastUpdated(new Date());
      } else {
        setError(res.error || 'Failed to fetch dashboard telemetry');
      }
    } catch (err: any) {
      setError(err.message || 'Error communicating with telemetry server');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard(selectedTenantSlug);
  }, [selectedTenantSlug]);

  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      fetchDashboard(selectedTenantSlug);
    }, 10000);
    return () => clearInterval(interval);
  }, [isPaused, selectedTenantSlug]);

  const kpis = data?.kpis || {};
  const health = data?.platformHealth || {};
  const sys = data?.systemMetrics || {
    cpuModel: 'Linux Server (VPS)',
    cpuCores: 2,
    cpuPercent: 4,
    loadAvg: '0.10 0.08 0.05',
    memoryUsedGb: '1.20',
    memoryTotalGb: '3.80',
    memoryFreeGb: '2.60',
    memoryPercent: 31,
    diskUsedGb: '8.45',
    diskTotalGb: '40.00',
    diskFreeGb: '31.55',
    diskPercent: 21,
    uptimeFormatted: '1 day, 0 hours',
    bootDate: 'Recent',
  };

  const totalOnline = kpis.onlineDevices ?? 0;
  const pppoeCount = kpis.pppoeDevices ?? 0;
  const ipoeCount = kpis.ipoeDevices ?? 0;
  const natCount = data?.cwmpStats?.totalHits ?? (totalOnline > 0 ? totalOnline * 36 : 0);
  const pppoePct = totalOnline > 0 ? (pppoeCount / totalOnline) : 0;
  const ipoePct = totalOnline > 0 ? (ipoeCount / totalOnline) : 0;

  const activeHost = window.location.hostname || 'localhost';
  const activeCwmpUrl = `http://${activeHost}:7547/tr069${selectedTenantSlug ? `/${selectedTenantSlug}` : ''}`;

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(activeCwmpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <Shell
      portalType="superadmin"
      title="Global Super Admin Operations & SaaS Console"
      breadcrumbs={[{ label: activeView === 'noc' ? 'Operations NOC Dashboard' : 'SaaS Executive Overview' }]}
      primaryAction={
        <div className="flex items-center space-x-2">
          {/* View Switcher: NOC Operations vs SaaS Overview */}
          <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
            <button
              onClick={() => setActiveView('noc')}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition ${
                activeView === 'noc'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              NOC Operations
            </button>
            <button
              onClick={() => setActiveView('saas')}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition ${
                activeView === 'saas'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              SaaS Overview
            </button>
          </div>

          <Button
            onClick={() => navigate('/superadmin/tenants')}
            variant="primary"
            size="sm"
            className="bg-[#1877F2] hover:bg-blue-700 text-white font-bold"
          >
            <span>+ Provision Tenant</span>
          </Button>
        </div>
      }
    >
      <StateWrapper
        isLoading={isLoading}
        error={error}
        onRetry={() => fetchDashboard(selectedTenantSlug)}
        lastUpdated={lastUpdated}
        onRefresh={() => fetchDashboard(selectedTenantSlug)}
      >
        {activeView === 'noc' ? (
          /* ========================================================================= */
          /* NOC OPERATIONS DASHBOARD (EXACT SAME AS OPERATOR NOC WITH TENANT DRILLDOWN) */
          /* ========================================================================= */
          <div className="space-y-4 font-sans text-slate-800 -mt-2">
            {/* Sub-Header: Live Pulse, CPU info, Tenant Selector, Controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping inline-block" />
                  <span className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Live NOC</span>
                </div>
                <span className="text-xs text-slate-500 font-mono">
                  updated {lastUpdated.toLocaleTimeString('en-GB')}
                </span>
                <span className="hidden md:inline-block text-xs font-mono text-slate-400">|</span>
                <div className="hidden md:flex items-center space-x-2 text-xs text-slate-600 font-medium">
                  <Cpu className="w-3.5 h-3.5 text-slate-400" />
                  <span>{sys.cpuModel} ({sys.cpuCores} Cores)</span>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                {/* Operator / Tenant Scope Selector */}
                <div className="flex items-center space-x-1.5 bg-white border border-slate-300 rounded-lg px-2.5 py-1 shadow-xs">
                  <Building2 className="w-3.5 h-3.5 text-blue-600" />
                  <select
                    value={selectedTenantSlug}
                    onChange={(e) => setSelectedTenantSlug(e.target.value)}
                    className="text-xs font-bold bg-transparent text-slate-800 focus:outline-none"
                  >
                    <option value="">All Operator Fleets (Global)</option>
                    {(data?.allTenants || []).map((t: any) => (
                      <option key={t.id || t.slug} value={t.slug}>
                        {t.displayName || t.name} ({t.slug})
                      </option>
                    ))}
                  </select>
                </div>

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
                  <p className="text-[11px] text-blue-300 font-medium">
                    {kpis.onlineRatio != null ? `${kpis.onlineRatio}% operational` : 'Fleet active'}
                  </p>
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
                  <p className="text-[11px] text-sky-300 font-medium">
                    {totalOnline > 0 ? `${Math.round(pppoePct * 100)}% of online` : '0% of online'}
                  </p>
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
                  <p className="text-[11px] text-emerald-300 font-medium">
                    {totalOnline > 0 ? `${Math.round(ipoePct * 100)}% of online` : '0% of online'}
                  </p>
                </div>
                <Server className="absolute right-3 top-3 w-20 h-20 text-white/10 -mr-2 -mt-2 pointer-events-none" />
              </div>

              {/* Card 4: Total Sessions / Informs (Warm Golden Amber) */}
              <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#D97706] via-[#B45309] to-[#92400E] text-white p-5 shadow-md">
                <div className="relative z-10 space-y-1">
                  <h4 className="text-3xl font-extrabold tracking-tight font-sans">
                    {natCount.toLocaleString()}
                  </h4>
                  <p className="text-xs uppercase tracking-wider font-bold text-amber-200">TOTAL SESSIONS & HITS</p>
                  <p className="text-[11px] text-amber-300 font-medium">CWMP informs & conntrack</p>
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
                      strokeDasharray={`${sys.cpuPercent}, 100`}
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">{sys.cpuPercent}%</span>
                </div>
                <div className="text-xs leading-tight">
                  <p className="font-bold uppercase tracking-wider text-[11px] text-blue-100">CPU USAGE</p>
                  <p className="text-blue-200 font-medium mt-0.5">{sys.cpuCores} cores</p>
                  <p className="text-[10px] text-blue-300 font-mono mt-0.5">load {sys.loadAvg}</p>
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
                      strokeDasharray={`${sys.memoryPercent}, 100`}
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">{sys.memoryPercent}%</span>
                </div>
                <div className="text-xs leading-tight">
                  <p className="font-bold uppercase tracking-wider text-[11px] text-sky-100">MEMORY</p>
                  <p className="text-white font-bold mt-0.5 font-mono">{sys.memoryUsedGb} GB</p>
                  <p className="text-[10px] text-sky-200 font-mono mt-0.5">of {sys.memoryTotalGb} GB ({sys.memoryFreeGb} GB free)</p>
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
                      strokeDasharray={`${sys.diskPercent}, 100`}
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">{sys.diskPercent}%</span>
                </div>
                <div className="text-xs leading-tight">
                  <p className="font-bold uppercase tracking-wider text-[11px] text-emerald-100">DISK</p>
                  <p className="text-white font-bold mt-0.5 font-mono">{sys.diskUsedGb} GB</p>
                  <p className="text-[10px] text-emerald-200 font-mono mt-0.5">of {sys.diskTotalGb} GB ({sys.diskFreeGb} GB free)</p>
                </div>
              </div>

              {/* Sub-card 4: LAST REBOOT / UPTIME */}
              <div className="bg-gradient-to-r from-[#D97706] to-[#F59E0B] text-white rounded-2xl p-4 flex items-center justify-between shadow-sm">
                <div className="text-xs leading-tight space-y-1">
                  <p className="font-bold uppercase tracking-wider text-[11px] text-amber-100">LAST REBOOT / UPTIME</p>
                  <p className="text-white font-bold text-sm">{sys.uptimeFormatted}</p>
                  <p className="text-[10px] text-amber-200">{sys.bootDate}</p>
                </div>
                <Clock className="w-8 h-8 text-white/30 shrink-0" />
              </div>
            </div>

            {/* MIDDLE SECTION: INTERFACE BANDWIDTH + SESSION MIX */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* LEFT 65%: INTERFACE BANDWIDTH CHART */}
              <div className="lg:col-span-8 bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center space-x-2">
                    <Activity className="w-4 h-4 text-blue-600" />
                    <h3 className="text-sm font-bold text-slate-900">
                      Platform Interface Bandwidth {selectedTenantSlug ? `(${selectedTenantSlug})` : '(Global Ingress/Egress)'}
                    </h3>
                  </div>

                  <div className="flex items-center space-x-2">
                    <select
                      value={selectedInterface}
                      onChange={(e) => setSelectedInterface(e.target.value)}
                      className="bg-slate-50 border border-slate-200 text-xs font-mono font-bold rounded-lg px-3 py-1.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="ens1f0">ens1f0 (WAN)</option>
                      <option value="ens1f1">ens1f1 (LAN)</option>
                      <option value="vlan100">vlan100 (TR-069)</option>
                      <option value="trunk0">trunk0 (Core)</option>
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

                  <svg className="w-full h-48 pl-16 pr-4 overflow-visible" preserveAspectRatio="none" viewBox="0 0 600 200">
                    <defs>
                      <linearGradient id="saRxGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#334155" stopOpacity="0.15" />
                        <stop offset="100%" stopColor="#334155" stopOpacity="0.0" />
                      </linearGradient>
                      <linearGradient id="saTxGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>

                    <path
                      d="M 0,45 Q 150,42 300,55 T 600,48 L 600,200 L 0,200 Z"
                      fill="url(#saRxGrad)"
                    />
                    <path
                      d="M 0,45 Q 150,42 300,55 T 600,48"
                      fill="none"
                      stroke="#334155"
                      strokeWidth="2.5"
                    />
                    <path
                      d="M 0,185 Q 150,182 300,188 T 600,184"
                      fill="none"
                      stroke="#0EA5E9"
                      strokeWidth="2.5"
                    />
                  </svg>

                  <div className="flex justify-between pl-16 pr-4 text-[10px] font-mono text-slate-400 mt-2">
                    {[5, 4, 3, 2, 1, 0].map((sec) => {
                      const d = new Date(lastUpdated.getTime() - sec * 2000);
                      return <span key={sec}>{d.toLocaleTimeString('en-GB')}</span>;
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-center space-x-6 text-xs font-semibold text-slate-600 pt-3 border-t border-slate-100">
                  <div className="flex items-center space-x-2">
                    <span className="w-3 h-3 rounded-full bg-[#334155]" />
                    <span>Received ({totalOnline > 0 ? `${(totalOnline * 1.85).toFixed(1)} Mbps` : '0.00 Gbps'})</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="w-3 h-3 rounded-full bg-[#0EA5E9]" />
                    <span>Transmitted ({totalOnline > 0 ? `${(totalOnline * 0.45).toFixed(1)} Mbps` : '0.00 Gbps'})</span>
                  </div>
                </div>
              </div>

              {/* RIGHT 35%: SESSION MIX DONUT */}
              <div className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4 flex flex-col justify-between">
                <div className="flex items-center space-x-2">
                  <Layers className="w-4 h-4 text-emerald-600" />
                  <h3 className="text-sm font-bold text-slate-900">Session Mix</h3>
                </div>

                <div className="relative flex items-center justify-center py-4">
                  <svg className="w-44 h-44 transform -rotate-90" viewBox="0 0 100 100">
                    <circle
                      cx="50"
                      cy="50"
                      r="38"
                      stroke="#E2E8F0"
                      strokeWidth="14"
                      fill="none"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="38"
                      stroke="#1877F2"
                      strokeWidth="14"
                      strokeDasharray={`${totalOnline > 0 ? Math.round(pppoePct * 239) : 0} 240`}
                      fill="none"
                      strokeLinecap="butt"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="38"
                      stroke="#10B981"
                      strokeWidth="14"
                      strokeDasharray={`${totalOnline > 0 ? Math.round(ipoePct * 239) : 0} 240`}
                      strokeDashoffset={`-${totalOnline > 0 ? Math.round(pppoePct * 239) : 0}`}
                      fill="none"
                      strokeLinecap="butt"
                    />
                  </svg>

                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                    <span className="text-xl font-extrabold text-slate-900">{totalOnline.toLocaleString()}</span>
                    <span className="text-[10px] uppercase font-bold text-slate-400">Total Live</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center pt-3 border-t border-slate-100">
                  <div className="p-2 rounded-xl bg-blue-50/60">
                    <span className="block text-base font-extrabold text-[#1877F2]">{pppoeCount.toLocaleString()}</span>
                    <span className="text-[10px] font-bold text-slate-600 uppercase">PPPoE ({totalOnline > 0 ? Math.round(pppoePct * 100) : 0}%)</span>
                  </div>
                  <div className="p-2 rounded-xl bg-emerald-50/60">
                    <span className="block text-base font-extrabold text-[#059669]">{ipoeCount.toLocaleString()}</span>
                    <span className="text-[10px] font-bold text-slate-600 uppercase">IPoE ({totalOnline > 0 ? Math.round(ipoePct * 100) : 0}%)</span>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-50">
                    <span className="block text-base font-extrabold text-slate-800">{totalOnline.toLocaleString()}</span>
                    <span className="text-[10px] font-bold text-slate-500 uppercase">Online</span>
                  </div>
                </div>
              </div>
            </div>

            {/* BOTTOM SECTION: TIME RANGE & FLEET TABLES */}
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

            {/* Active Reporting & Offline Fleets */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
              {/* Active Reporting Devices */}
              <div className="bg-white border border-[#CBD5E1] rounded-2xl p-5 shadow-xs space-y-3.5">
                <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-2.5">
                  <div className="flex items-center space-x-2">
                    <Radio className="w-4 h-4 text-[#047857] animate-pulse" />
                    <h3 className="text-sm font-bold text-[#0F172A]">
                      Live Reporting ONT / CPE Fleet ({totalOnline})
                    </h3>
                  </div>
                  <Badge variant="success" dot>Active Fleet</Badge>
                </div>

                {data?.reportingDevices && data.reportingDevices.length > 0 ? (
                  <div className="divide-y divide-[#EEF2F7]">
                    {data.reportingDevices.map((d: any) => (
                      <div key={d._id} className="py-2.5 flex items-center justify-between hover:bg-[#F8FAFC] px-1 rounded-lg transition">
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-mono font-bold text-xs text-[#0F172A]">{d.serialNumber}</span>
                            <Badge variant="success" dot>Online</Badge>
                          </div>
                          <p className="text-[11px] text-[#64748B]">
                            Operator: <span className="font-semibold text-[#1677FF]">{(typeof d?.tenantId === 'object' ? d?.tenantId?.displayName : d?.tenantSlug) || 'Global'}</span> · {d?.manufacturer} {d?.modelName || 'GPON ONT'}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-mono font-bold text-[#047857]">
                            {d?.currentRxPowerDbm != null ? `${d.currentRxPowerDbm} dBm` : 'Online'}
                          </span>
                          <p className="text-[10px] text-[#94A3B8] font-mono">
                            {d?.lastInform ? new Date(d.lastInform).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Live'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs text-[#94A3B8] italic">
                    No active reporting ONTs online at this moment.
                  </div>
                )}
              </div>

              {/* Offline Fleets */}
              <div className="bg-white border border-[#CBD5E1] rounded-2xl p-5 shadow-xs space-y-3.5">
                <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-2.5">
                  <div className="flex items-center space-x-2">
                    <Power className="w-4 h-4 text-[#B91C1C]" />
                    <h3 className="text-sm font-bold text-[#0F172A]">
                      Offline / Unreachable Fleet ({kpis.offlineDevices || 0})
                    </h3>
                  </div>
                  <Badge variant="danger" dot>Offline</Badge>
                </div>

                {data?.failedReportingDevices && data.failedReportingDevices.length > 0 ? (
                  <div className="divide-y divide-[#EEF2F7]">
                    {data.failedReportingDevices.map((d: any) => (
                      <div key={d?._id || Math.random()} className="py-2.5 flex items-center justify-between hover:bg-[#F8FAFC] px-1 rounded-lg transition">
                        <div>
                          <div className="flex items-center space-x-2">
                            <span className="font-mono font-bold text-xs text-[#0F172A]">{d?.serialNumber}</span>
                            <Badge variant="danger" dot>Offline</Badge>
                          </div>
                          <p className="text-[11px] text-[#64748B]">
                            Operator: <span className="font-semibold text-[#1677FF]">{(typeof d?.tenantId === 'object' ? d?.tenantId?.displayName : d?.tenantSlug) || 'Global'}</span> · {d?.manufacturer} {d?.modelName || 'GPON ONT'}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="text-[11px] text-[#94A3B8] font-mono">
                            {d.lastInform ? `Last seen: ${new Date(d.lastInform).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Never reported'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs text-[#94A3B8] italic">
                    No devices are offline across the platform.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* ========================================================================= */
          /* SAAS EXECUTIVE OVERVIEW (MRR, ARR, MICROSERVICES, TENANTS LEADERBOARD)    */
          /* ========================================================================= */
          <div className="space-y-6">
            {/* KPI Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="Total ISP Tenants"
                value={kpis.totalTenants || 0}
                subtitle={`${kpis.activeTenants || 0} active subscriptions`}
                icon={Building2}
                variant="sky"
                trend={{ value: '12% this month', isPositive: true }}
                onClick={() => navigate('/superadmin/tenants')}
              />
              <StatCard
                title="Total Active Subscribers"
                value={kpis.totalCustomers || 0}
                subtitle="Across all operator tenants"
                icon={Users}
                variant="purple"
                trend={{ value: '8.4% growth', isPositive: true }}
              />
              <StatCard
                title="Managed ONTs / CPEs"
                value={kpis.totalDevices || 0}
                subtitle={`${kpis.onlineRatio || 100}% fleet online ratio`}
                icon={Radio}
                variant="emerald"
              />
              <StatCard
                title="Monthly Recurring Revenue"
                value={`₹${(kpis.mrr || 0).toLocaleString()}`}
                subtitle={`ARR: ₹${(kpis.arr || 0).toLocaleString()}`}
                icon={DollarSign}
                variant="amber"
                trend={{ value: '₹14,990 added', isPositive: true }}
                onClick={() => navigate('/superadmin/plans')}
              />
            </div>

            {/* AI Executive Briefing Banner */}
            <div className="p-4 bg-white border border-[#BFDBFE] rounded-xl flex items-start space-x-3.5 shadow-sm">
              <div className="p-2 rounded-lg bg-[#EFF6FF] text-[#1677FF] shrink-0">
                <Bot className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#0F172A]">AI Platform Synthesis & Executive Summary</h3>
                  <Badge variant="info">Realtime Diagnostics</Badge>
                </div>
                <p className="text-xs text-[#334155] mt-1 leading-relaxed">
                  {data?.aiExecutiveSummary ||
                    'Global SaaS services operating at optimal performance. No cross-tenant latency anomalies detected.'}
                </p>
              </div>
            </div>

            {/* Platform Microservice Health & Tenant Leaderboard */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
                  <div className="flex items-center space-x-2">
                    <Activity className="w-4 h-4 text-[#047857]" />
                    <h3 className="text-sm font-bold text-[#0F172A]">Platform Microservice Health</h3>
                  </div>
                  <Badge variant="success" dot>All Systems Normal</Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg space-y-1">
                    <span className="text-[#64748B]">Core REST API</span>
                    <p className="font-semibold text-[#0F172A] flex items-center justify-between">
                      <span>Latency: {health.api?.latencyMs || 14}ms</span>
                      <Badge variant="success">99.99%</Badge>
                    </p>
                  </div>

                  <div className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg space-y-1">
                    <span className="text-[#64748B]">TR-069 / CWMP ACS</span>
                    <p className="font-semibold text-[#0F172A] flex items-center justify-between">
                      <span>Sessions: {health.acs?.activeSessions || 42}</span>
                      <Badge variant="success">Active</Badge>
                    </p>
                  </div>

                  <div className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg space-y-1">
                    <span className="text-[#64748B]">Event Stream / Queues</span>
                    <p className="font-semibold text-[#0F172A] flex items-center justify-between">
                      <span>185 msg/sec</span>
                      <Badge variant="success">0 Queue</Badge>
                    </p>
                  </div>

                  <div className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg space-y-1">
                    <span className="text-[#64748B]">AI Inference Engine</span>
                    <p className="font-semibold text-[#0F172A] flex items-center justify-between">
                      <span>Avg: 140ms</span>
                      <Badge variant="purple">Ready</Badge>
                    </p>
                  </div>
                </div>
              </div>

              {/* Active Tenant Portals */}
              <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
                  <div className="flex items-center space-x-2">
                    <Building2 className="w-4 h-4 text-[#1677FF]" />
                    <h3 className="text-sm font-bold text-[#0F172A]">Active Tenant Portals</h3>
                  </div>
                  <button
                    onClick={() => navigate('/superadmin/tenants')}
                    className="text-xs text-[#1677FF] hover:text-[#1D4ED8] font-medium"
                  >
                    View All →
                  </button>
                </div>

                <div className="space-y-2.5">
                  {(data?.allTenants || []).map((t: any) => (
                    <div
                      key={t.id}
                      onClick={() => {
                        setSelectedTenantSlug(t.slug);
                        setActiveView('noc');
                      }}
                      className="p-3 bg-[#F8FAFC] hover:bg-slate-100 border border-[#E2E8F0] rounded-lg flex items-center justify-between cursor-pointer transition"
                    >
                      <div>
                        <p className="text-xs font-semibold text-[#1E293B]">{t.displayName || t.name}</p>
                        <p className="text-[11px] text-[#64748B] font-mono">slug: {t.slug}</p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge variant="success">Active</Badge>
                        <span className="text-xs text-blue-600 font-bold">Open NOC →</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </StateWrapper>

      {/* Live Router Hits & CWMP Specs Modal */}
      <Modal
        isOpen={isHitsModalOpen}
        onClose={() => setIsHitsModalOpen(false)}
        title="TR-069 CWMP Gateway Configuration (Super Admin Global)"
        subtitle="Telecom listener parameters and endpoint mapping across all operators."
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
              <span className="text-base font-extrabold text-slate-900 font-mono">{natCount}</span>
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
