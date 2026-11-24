import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Server,
  Radio,
  MapPin,
  AlertTriangle,
  Ticket,
  Wrench,
  BarChart3,
  Bot,
  Settings,
  Bell,
  LogOut,
  Building2,
  Shield,
  Activity,
  ChevronRight,
  Menu,
  X,
  CheckSquare,
  Package,
  Zap,
  Eye,
  ArrowLeft,
  Sparkles,
  CalendarClock,
  CreditCard,
  TrendingUp,
  Layers,
  MessageSquare,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { useLanguage } from '../../context/LanguageContext.js';
import { Button } from '../ui/Button.js';

export interface ShellProps {
  children: React.ReactNode;
  portalType: 'superadmin' | 'operator' | 'customer' | 'technician';
  title: string;
  breadcrumbs?: Array<{ label: string; href?: string }>;
  primaryAction?: React.ReactNode;
}

export const Shell: React.FC<ShellProps> = ({
  children,
  portalType,
  title,
  breadcrumbs = [],
  primaryAction,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, tenant, isImpersonating, exitImpersonation, logout } = useAuth();
  const { lang, setLang, t } = useLanguage();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const superAdminNav = [
    { label: lang === 'te' ? 'ఎగ్జిక్యూటివ్ డ్యాష్‌బోర్డ్' : 'Executive Dashboard', path: '/superadmin/dashboard', icon: LayoutDashboard },
    { label: lang === 'te' ? 'పెండింగ్ ఆపరేటర్ మ్యాపింగ్' : 'Pending Operator Mapping', path: '/superadmin/pending-mappings', icon: Radio },
    { label: lang === 'te' ? 'టెనెంట్ నిర్వహణ' : 'Tenant Management', path: '/superadmin/tenants', icon: Building2 },
    { label: lang === 'te' ? 'యూజర్లు & గ్లోబల్ రోల్స్' : 'Users & Global Roles', path: '/superadmin/users', icon: Users },
    { label: lang === 'te' ? 'ప్లాన్లు & రాబడి' : 'Plans & Revenue', path: '/superadmin/plans', icon: BarChart3 },
    { label: lang === 'te' ? 'సిస్టమ్ ఆరోగ్యం & క్యూలు' : 'System Health & Queues', path: '/superadmin/health', icon: Activity },
    { label: lang === 'te' ? 'గ్లోబల్ సమస్యలు' : 'Global Incidents', path: '/superadmin/incidents', icon: AlertTriangle },
    { label: lang === 'te' ? 'ఆడిట్ లాగ్ ఎక్స్‌ప్లోరర్' : 'Audit Log Explorer', path: '/superadmin/audit', icon: Shield },
    { label: lang === 'te' ? 'ప్లాట్‌ఫారమ్ సెట్టింగులు' : 'Platform Settings', path: '/superadmin/settings', icon: Settings },
  ];

  const operatorNav = [
    { label: t('navNoc'), path: '/operator/dashboard', icon: LayoutDashboard },
    { label: t('navCustomers'), path: '/operator/customers', icon: Users },
    { label: t('navDevices'), path: '/operator/devices', icon: Radio },
    { label: t('navOlt'), path: '/operator/network', icon: Server },
    { label: t('navGis'), path: '/operator/gis', icon: MapPin },
    { label: t('navPlans'), path: '/operator/plans', icon: CalendarClock },
    { label: t('navGateways'), path: '/operator/payments/gateways', icon: CreditCard },
    { label: t('navReconciliation'), path: '/operator/payments/reconciliation', icon: CreditCard },
    { label: t('navWhatsapp'), path: '/operator/whatsapp-chat', icon: MessageSquare },
    { label: t('navWarehouse'), path: '/operator/inventory/warehouse', icon: Layers },
    { label: t('navApprovals'), path: '/operator/approvals', icon: CheckSquare },
    { label: t('navAutomation'), path: '/operator/automation', icon: Zap },
    { label: t('navIncidents'), path: '/operator/incidents', icon: AlertTriangle },
    { label: t('navTickets'), path: '/operator/tickets', icon: Ticket },
    { label: t('navTechs'), path: '/operator/technicians', icon: Wrench },
    { label: t('navAi'), path: '/operator/ai', icon: Bot },
    { label: t('navAnalytics'), path: '/operator/analytics', icon: TrendingUp },
    { label: t('navSettings'), path: '/operator/settings', icon: Settings },
  ];

  const customerNav = [
    { label: 'My Fiber Home', path: '/customer/home', icon: LayoutDashboard },
    { label: 'My Billing & Invoices', path: '/customer/billing', icon: CreditCard },
    { label: 'Wi-Fi Settings', path: '/customer/wifi', icon: Radio },
    { label: 'Connected Devices', path: '/customer/devices', icon: Users },
    { label: 'Helpdesk & Tickets', path: '/customer/support', icon: Ticket },
  ];

  const navItems = portalType === 'superadmin' ? superAdminNav : portalType === 'customer' ? customerNav : operatorNav;

  const handleLogout = () => {
    logout();
    navigate(portalType === 'superadmin' ? '/superadmin/login' : portalType === 'customer' ? '/customer/login' : '/operator/login');
  };

  const handleExitImpersonation = () => {
    exitImpersonation();
    navigate('/superadmin/tenants');
  };

  return (
    <div className="flex flex-col h-screen bg-[#F8FAFC] text-[#0F172A] overflow-hidden font-sans">
      {/* Super Admin Active Impersonation Top Banner */}
      {isImpersonating && (
        <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white px-4 py-2 text-xs font-medium flex items-center justify-between shadow-xs z-50 shrink-0 border-b border-amber-600">
          <div className="flex items-center space-x-2">
            <Eye className="w-4 h-4 text-[#0F172A] animate-pulse" />
            <span>
              <strong>Super Admin Impersonation Active:</strong> Viewing tenant{' '}
              <span className="font-bold underline">{tenant?.displayName || 'Tenant'}</span> (Slug:{' '}
              <code className="bg-black/20 px-1.5 py-0.5 rounded font-mono text-[#0F172A]">{tenant?.slug}</code>). All operations are executed within this tenant scope.
            </span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="bg-white text-slate-900 hover:bg-slate-50 font-bold text-xs py-1 px-3 shadow-xs flex items-center space-x-1 border-0"
            onClick={handleExitImpersonation}
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            <span>Exit Impersonation</span>
          </Button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - oneTRacs Dark Enterprise */}
        <aside
          className={`fixed inset-y-0 left-0 z-40 w-64 bg-[#0F172A] border-r border-slate-800 flex flex-col transition-transform duration-200 lg:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } ${isImpersonating ? 'top-[37px]' : ''}`}
        >
          {/* Brand Header */}
          <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-[#0F172A]">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-black text-white text-xs shadow-md">
                {portalType === 'superadmin' ? 'SA' : 'ACS'}
              </div>
              <div>
                <div className="flex items-center space-x-1.5">
                  <h2 className="text-sm font-extrabold tracking-tight text-white leading-tight">
                    {portalType === 'superadmin' ? 'AI ISP OS Control' : tenant?.displayName || 'Apex Fiber'}
                  </h2>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                </div>
                <p className="text-[10px] uppercase font-bold tracking-wider text-sky-400">
                  {portalType === 'superadmin' ? 'Super Admin SaaS' : 'TR-069 Operations'}
                </p>
              </div>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-1 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto bg-[#0F172A]">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center space-x-3 px-3 py-2 rounded-xl text-xs font-semibold transition ${
                    isActive
                      ? 'bg-slate-800 text-sky-400 border-l-4 border-sky-400 shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-sky-400' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* User Footer Profile */}
          <div className="p-3 border-t border-slate-800 bg-[#0B132B]">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5 overflow-hidden">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 border border-slate-700 flex items-center justify-center font-bold text-xs text-white">
                  {user?.fullName?.charAt(0) || 'U'}
                </div>
                <div className="truncate">
                  <p className="text-xs font-semibold text-white truncate">{user?.fullName || 'Operator'}</p>
                  <p className="text-[10px] text-slate-400 capitalize">
                    {isImpersonating ? 'Super Admin (Impersonating)' : user?.role?.replace('_', ' ')}
                  </p>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition"
                title={t('signOut') || 'Sign Out'}
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* Main Workspace Shell */}
        <div className="flex-1 flex flex-col min-w-0 lg:pl-64">
          {/* Top Navbar */}
          <header className="h-14 border-b border-[#E2E8F0] bg-white px-6 flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-1.5 text-[#64748B] hover:text-[#0F172A]"
              >
                <Menu className="w-5 h-5" />
              </button>

              {/* Breadcrumbs */}
              <div className="flex items-center space-x-2 text-xs text-[#64748B]">
                <Link to={portalType === 'superadmin' ? '/superadmin/dashboard' : '/operator/dashboard'} className="hover:text-[#1677FF] font-medium">
                  {portalType === 'superadmin' ? 'Control Plane' : 'NOC'}
                </Link>
                {breadcrumbs.map((b, i) => (
                  <React.Fragment key={i}>
                    <ChevronRight className="w-3.5 h-3.5 text-[#94A3B8]" />
                    {b.href ? (
                      <Link to={b.href} className="hover:text-[#1677FF] font-medium">
                        {b.label}
                      </Link>
                    ) : (
                      <span className="text-[#0F172A] font-semibold">{b.label}</span>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>

            <div className="flex items-center space-x-3">
              {/* Language Switcher Pill */}
              <div className="flex items-center space-x-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                <button
                  type="button"
                  onClick={() => setLang('en')}
                  className={`px-2 py-1 text-[11px] font-bold rounded-md transition ${
                    lang === 'en'
                      ? 'bg-white text-blue-600 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  EN
                </button>
                <button
                  type="button"
                  onClick={() => setLang('te')}
                  className={`px-2 py-1 text-[11px] font-bold rounded-md transition ${
                    lang === 'te'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  తెలుగు
                </button>
              </div>

              <div className="relative">
                <button
                  onClick={() => navigate(portalType === 'superadmin' ? '/superadmin/incidents' : '/operator/incidents')}
                  className="p-2 text-[#64748B] hover:text-[#0F172A] hover:bg-[#F8FAFC] rounded-lg transition relative border border-transparent hover:border-[#E2E8F0]"
                  title="Active Alarms"
                >
                  <Bell className="w-4 h-4" />
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500"></span>
                </button>
              </div>
            </div>
          </header>

          {/* Page Content Container */}
          <main className="flex-1 p-6 overflow-y-auto bg-[#F8FAFC]">
            <div className="max-w-7xl mx-auto space-y-6">
              {/* Page Header */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E2E8F0] pb-4">
                <div>
                  <h1 className="text-xl font-bold text-[#0F172A]">{title}</h1>
                  <p className="text-xs text-[#64748B] mt-0.5">
                    Tenant: <span className="font-mono text-[#1677FF] font-medium">{tenant?.slug || 'global-plane'}</span> | Role: <span className="capitalize">{user?.role?.replace('_', ' ')}</span>
                  </p>
                </div>
                {primaryAction && <div>{primaryAction}</div>}
              </div>

              {/* Page Body */}
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};
