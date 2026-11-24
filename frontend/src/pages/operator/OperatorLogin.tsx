import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Phone,
  KeyRound,
  ArrowRight,
  Lock,
  Building2,
  MessageSquare,
  CheckCircle2,
  RefreshCw,
  Key,
  Shield,
  Zap,
  Radio,
  ArrowLeft,
  Sparkles,
  Server
} from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { Button, Input } from '../../components/ui/Button.js';

export const OperatorLogin: React.FC = () => {
  // Auth Policy State
  const [allowOtp, setAllowOtp] = useState(true);
  const [allowPassword, setAllowPassword] = useState(true);
  const [activeMode, setActiveMode] = useState<'otp' | 'password'>('otp');
  const [policyLoaded, setPolicyLoaded] = useState(false);

  // OTP Login State
  const [phone, setPhone] = useState('');
  const [slug, setSlug] = useState('');
  const [availableTenants, setAvailableTenants] = useState<any[]>([]);
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'tenantSelect' | 'otp'>('phone');
  const [destinationMasked, setDestinationMasked] = useState('');
  const [operatorName, setOperatorName] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [resendTimer, setResendTimer] = useState(30);

  // Password Login State
  const [passwordIdentifier, setPasswordIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [passwordSlug, setPasswordSlug] = useState('');

  // General State
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { login } = useAuth();
  const navigate = useNavigate();

  // Load Super Admin Auth Policy on mount
  useEffect(() => {
    const fetchPolicy = async () => {
      try {
        const res = await api.getOperatorAuthPolicy();
        if (res.success && res.policy) {
          const otpOk = res.policy.allowOtp !== false;
          const pwdOk = res.policy.allowPassword !== false;
          setAllowOtp(otpOk);
          setAllowPassword(pwdOk);

          if (!otpOk && pwdOk) {
            setActiveMode('password');
          } else if (otpOk && !pwdOk) {
            setActiveMode('otp');
          } else if (res.policy.primaryMethod === 'PASSWORD') {
            setActiveMode('password');
          } else {
            setActiveMode('otp');
          }
        }
      } catch (_) {
        // Default to both enabled
      } finally {
        setPolicyLoaded(true);
      }
    };

    fetchPolicy();
  }, []);

  const handleRequestOtp = async (e?: React.FormEvent, selectedSlug?: string) => {
    if (e) e.preventDefault();
    setIsLoading(true);
    setError(null);

    const targetSlug = selectedSlug || slug;
    const res = await api.operatorRequestOtp(phone, targetSlug || undefined);
    setIsLoading(false);

    if (res.success) {
      if (res.requireTenantSelection && res.tenants?.length > 1) {
        setAvailableTenants(res.tenants);
        setStep('tenantSelect');
      } else {
        setDestinationMasked(res.destinationMasked || phone);
        setOperatorName(res.operatorName || 'Operator');
        setTenantName(res.tenantName || 'Primary ISP');
        if (res.tenantSlug) setSlug(res.tenantSlug);
        setStep('otp');
        startResendCountdown();
      }
    } else {
      setError(res.error || 'Mobile number is not registered as an operator in the database.');
    }
  };

  const handleTenantSelect = (selectedSlug: string) => {
    setSlug(selectedSlug);
    handleRequestOtp(undefined, selectedSlug);
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const res = await api.operatorVerifyOtp(phone, otp, slug || undefined);
    setIsLoading(false);

    if (res.success && res.token) {
      login(res.token, res.user, res.tenant);
      navigate('/operator/dashboard');
    } else {
      setError(res.error || 'Invalid or expired WhatsApp OTP code.');
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const res = await api.operatorLogin(passwordIdentifier, password, passwordSlug || undefined);
    setIsLoading(false);

    if (res.success && res.token) {
      login(res.token, res.user, res.tenant);
      navigate('/operator/dashboard');
    } else {
      setError(res.error || 'Invalid operator credentials. Please check your login details.');
    }
  };

  const startResendCountdown = () => {
    setResendTimer(30);
    const interval = setInterval(() => {
      setResendTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleQuickFillRudra = () => {
    setActiveMode('password');
    setPasswordIdentifier('operator@rudra.net');
    setPassword('Operator@123');
    setPasswordSlug('rudra');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-sky-500 selection:text-white relative overflow-hidden font-sans">
      {/* Background Fiber Grid & Glowing Orbs */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-sky-900/25 via-slate-950 to-slate-950 pointer-events-none" />
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Top Header / Brand Bar */}
      <header className="relative z-10 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 flex items-center justify-between">
        <Link to="/" className="flex items-center space-x-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 via-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-sky-500/25 group-hover:scale-105 transition-all">
            <Zap className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-lg font-black tracking-tight text-white font-mono">AI ISP OS</span>
              <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-sky-500/20 text-sky-400 border border-sky-500/30 rounded-full">
                Carrier NOC
              </span>
            </div>
            <p className="text-[10px] text-slate-400">Autonomous FTTH & ISP Platform</p>
          </div>
        </Link>

        <Link
          to="/"
          className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-400 hover:text-white bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 px-3.5 py-2 rounded-xl transition-all"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Home</span>
        </Link>
      </header>

      {/* Center Auth Card */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 sm:px-6 py-8">
        <div className="w-full max-w-md">
          {/* Header Tagline */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold mb-3 shadow-inner">
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              <span>TR-069 & USP 2.0 Carrier Gateway</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">Operator NOC Portal</h1>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              Secure authentication for network operations, subscriber management, and ONT provisioning.
            </p>
          </div>

          {/* Main Glassmorphic Card */}
          <div className="bg-slate-900/80 backdrop-blur-2xl border border-slate-800/80 p-6 sm:p-8 rounded-3xl shadow-2xl relative overflow-hidden">
            {/* Ambient top border gradient */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 via-indigo-500 to-emerald-500" />

            {/* Error Banner */}
            {error && (
              <div className="mb-5 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-2.5 animate-fadeIn">
                <Lock className="w-4 h-4 shrink-0 text-rose-400" />
                <span className="leading-snug">{error}</span>
              </div>
            )}

            {/* Mode Switcher */}
            {allowOtp && allowPassword && (
              <div className="grid grid-cols-2 p-1 bg-slate-950/80 rounded-2xl border border-slate-800 mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setActiveMode('otp');
                    setError(null);
                  }}
                  className={`flex items-center justify-center space-x-2 py-2.5 text-xs font-bold rounded-xl transition-all ${
                    activeMode === 'otp'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>WhatsApp OTP</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveMode('password');
                    setError(null);
                  }}
                  className={`flex items-center justify-center space-x-2 py-2.5 text-xs font-bold rounded-xl transition-all ${
                    activeMode === 'password'
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30 shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Key className="w-3.5 h-3.5" />
                  <span>Password Entry</span>
                </button>
              </div>
            )}

            {/* METHOD 1: WHATSAPP OTP LOGIN */}
            {activeMode === 'otp' && allowOtp && (
              <>
                {step === 'phone' && (
                  <form onSubmit={handleRequestOtp} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1.5">
                        Registered Mobile Number or Email
                      </label>
                      <div className="relative">
                        <Phone className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                        <input
                          type="text"
                          required
                          placeholder="e.g. 9876543210 or operator@isp.net"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all font-mono"
                          autoFocus
                        />
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1.5">
                        Instant 6-digit verification code will be sent to your registered WhatsApp.
                      </p>
                    </div>

                    <Button
                      type="submit"
                      className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold py-3 rounded-xl shadow-lg shadow-emerald-500/20 transition-all text-xs"
                      isLoading={isLoading}
                    >
                      <MessageSquare className="w-4 h-4 mr-2" />
                      <span>Send WhatsApp Code</span>
                    </Button>
                  </form>
                )}

                {step === 'tenantSelect' && (
                  <div className="space-y-4">
                    <div className="p-3 bg-sky-500/10 border border-sky-500/20 rounded-2xl text-xs text-sky-300">
                      Multiple ISP Tenants found for your account. Please select your NOC network context:
                    </div>

                    <div className="space-y-2 max-h-56 overflow-y-auto">
                      {availableTenants.map((t) => (
                        <button
                          key={t.slug}
                          onClick={() => handleTenantSelect(t.slug)}
                          className="w-full p-3.5 rounded-2xl bg-slate-950 hover:bg-slate-800/80 border border-slate-800 hover:border-emerald-500/50 text-left transition flex items-center justify-between group"
                        >
                          <div>
                            <p className="font-bold text-white text-xs group-hover:text-emerald-400 transition-colors">
                              {t.displayName}
                            </p>
                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">Tenant Slug: {t.slug}</p>
                          </div>
                          <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 transition-colors" />
                        </button>
                      ))}
                    </div>

                    <Button
                      variant="outline"
                      onClick={() => setStep('phone')}
                      className="w-full text-xs border-slate-800 bg-slate-950 hover:bg-slate-800 text-slate-300"
                    >
                      ← Back to Mobile Entry
                    </Button>
                  </div>
                )}

                {step === 'otp' && (
                  <form onSubmit={handleVerifyOtp} className="space-y-4">
                    <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-start space-x-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-white">WhatsApp OTP Dispatched</p>
                        <p className="text-[11px] text-slate-300 mt-0.5">
                          Sent to <strong>{destinationMasked}</strong> ({operatorName} · {tenantName}).
                        </p>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-300 mb-1.5">
                        6-Digit WhatsApp Code
                      </label>
                      <div className="relative">
                        <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                        <input
                          type="text"
                          required
                          maxLength={6}
                          placeholder="••••••"
                          value={otp}
                          onChange={(e) => setOtp(e.target.value.trim())}
                          className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl pl-10 pr-3.5 py-2.5 text-base tracking-widest text-center text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-mono"
                          autoFocus
                        />
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold py-3 rounded-xl shadow-lg shadow-emerald-500/20 transition-all text-xs"
                      isLoading={isLoading}
                    >
                      <span>Verify & Enter NOC</span>
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>

                    <div className="flex items-center justify-between text-xs pt-2">
                      <button
                        type="button"
                        onClick={() => setStep('phone')}
                        className="text-slate-400 hover:text-white transition-colors"
                      >
                        ← Change Number
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRequestOtp()}
                        disabled={resendTimer > 0 || isLoading}
                        className="text-emerald-400 hover:text-emerald-300 disabled:text-slate-500 disabled:cursor-not-allowed flex items-center space-x-1"
                      >
                        <RefreshCw className={`w-3 h-3 ${resendTimer > 0 ? 'animate-spin' : ''}`} />
                        <span>{resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend Code'}</span>
                      </button>
                    </div>
                  </form>
                )}
              </>
            )}

            {/* METHOD 2: MANUAL PASSWORD LOGIN */}
            {activeMode === 'password' && allowPassword && (
              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">
                    Operator Email or Username
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. operator@rudra.net"
                      value={passwordIdentifier}
                      onChange={(e) => setPasswordIdentifier(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono transition-all"
                      autoFocus
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type="password"
                      required
                      placeholder="Enter account password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">
                    ISP Tenant Slug (Optional)
                  </label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type="text"
                      placeholder="e.g. rudra (leave blank for default)"
                      value={passwordSlug}
                      onChange={(e) => setPasswordSlug(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-sky-500 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono transition-all"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Direct access: <code className="text-sky-400 font-mono">http://109.122.56.149/tr069/rudra</code>
                  </p>
                </div>

                <Button
                  type="submit"
                  className="w-full bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-bold py-3 rounded-xl shadow-lg shadow-sky-500/20 transition-all text-xs"
                  isLoading={isLoading}
                >
                  <Lock className="w-4 h-4 mr-2" />
                  <span>Sign In to NOC</span>
                </Button>

                {/* Quick Fill Demo Helper Pill */}
                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={handleQuickFillRudra}
                    className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 text-[11px] font-semibold transition-all"
                  >
                    <Sparkles className="w-3 h-3 text-sky-400" />
                    <span>Quick Autofill: Rudra Tenant</span>
                  </button>
                </div>
              </form>
            )}

            {/* Fallback if neither mode is permitted */}
            {!allowOtp && !allowPassword && policyLoaded && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs text-center space-y-2">
                <Shield className="w-6 h-6 text-amber-400 mx-auto" />
                <p className="font-bold">Operator Login Temporarily Disabled</p>
                <p className="text-slate-400">Please contact your Super Administrator to enable an authentication method.</p>
              </div>
            )}

            {/* Sub-Card Navigation & Superadmin Link */}
            <div className="mt-6 border-t border-slate-800/80 pt-4 flex items-center justify-between text-xs text-slate-400">
              <span className="flex items-center space-x-1.5">
                <Server className="w-3.5 h-3.5 text-slate-500" />
                <span>Isolated NOC</span>
              </span>
              <Link
                to="/superadmin/login"
                className="text-sky-400 hover:text-sky-300 font-semibold transition-colors flex items-center space-x-1"
              >
                <span>Super Admin Cloud</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>

          {/* Security Features Bottom Pill */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-[11px] text-slate-500">
            <span className="flex items-center space-x-1">
              <Shield className="w-3.5 h-3.5 text-emerald-500" />
              <span>256-Bit SSL Encrypted</span>
            </span>
            <span>•</span>
            <span className="flex items-center space-x-1">
              <Lock className="w-3.5 h-3.5 text-sky-500" />
              <span>RFC 2617 Digest CWMP</span>
            </span>
            <span>•</span>
            <span>Zero-Trust RBAC</span>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-4 border-t border-slate-800/60 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-500 gap-2">
        <p>© 2026 AI ISP Operating System. Telecom Standards TR-069 & TR-181 Certified.</p>
        <div className="flex items-center space-x-4">
          <Link to="/customer/login" className="hover:text-slate-400 transition-colors">Customer Portal</Link>
          <Link to="/tech/login" className="hover:text-slate-400 transition-colors">Technician App</Link>
        </div>
      </footer>
    </div>
  );
};
