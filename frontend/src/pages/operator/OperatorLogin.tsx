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
  Server,
  Check
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
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col justify-between selection:bg-blue-600 selection:text-white font-sans antialiased">
      {/* Top Clean Header / Navbar */}
      <header className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 flex items-center justify-between border-b border-slate-200/80 bg-white/70 backdrop-blur-md sticky top-0 z-20">
        <Link to="/" className="flex items-center space-x-3 group">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-all">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-base sm:text-lg font-black tracking-tight text-slate-900 font-mono">AI ISP OS</span>
              <span className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200 rounded-full">
                Carrier NOC
              </span>
            </div>
            <p className="text-[10px] text-slate-500 font-medium">FTTH & ISP Operating System</p>
          </div>
        </Link>

        <Link
          to="/"
          className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl transition-all shadow-xs"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>హోమ్ పేజ్ (Home)</span>
        </Link>
      </header>

      {/* Main Login Body */}
      <main className="flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-md">
          {/* Headline & Badges */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold mb-3 shadow-xs">
              <Radio className="w-3.5 h-3.5 text-emerald-600 animate-pulse" />
              <span>TR-069 & USP 2.0 Management</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">Operator NOC Login</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1 max-w-sm mx-auto">
              మీ రిజిస్టర్డ్ మొబైల్ లేదా యూజర్‌నేమ్‌తో సిస్టమ్‌లోకి ప్రవేశించండి
            </p>
          </div>

          {/* Clean White Card */}
          <div className="bg-white border border-slate-200 p-6 sm:p-8 rounded-2xl sm:rounded-3xl shadow-xl shadow-slate-200/60 relative">
            {/* Top Accent Stripe */}
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-600 via-sky-500 to-emerald-500 rounded-t-3xl" />

            {/* Error Message */}
            {error && (
              <div className="mb-5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2.5 animate-fadeIn">
                <Lock className="w-4 h-4 shrink-0 text-rose-500" />
                <span className="leading-snug">{error}</span>
              </div>
            )}

            {/* Mode Switcher */}
            {allowOtp && allowPassword && (
              <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl border border-slate-200 mb-6">
                <button
                  type="button"
                  onClick={() => {
                    setActiveMode('otp');
                    setError(null);
                  }}
                  className={`flex items-center justify-center space-x-2 py-2 sm:py-2.5 text-xs font-bold rounded-lg transition-all ${
                    activeMode === 'otp'
                      ? 'bg-white text-emerald-800 shadow-sm border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                  <span>WhatsApp OTP</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveMode('password');
                    setError(null);
                  }}
                  className={`flex items-center justify-center space-x-2 py-2 sm:py-2.5 text-xs font-bold rounded-lg transition-all ${
                    activeMode === 'password'
                      ? 'bg-white text-blue-800 shadow-sm border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Key className="w-3.5 h-3.5 text-blue-600" />
                  <span>Password Entry</span>
                </button>
              </div>
            )}

            {/* METHOD 1: WHATSAPP OTP */}
            {activeMode === 'otp' && allowOtp && (
              <>
                {step === 'phone' && (
                  <form onSubmit={handleRequestOtp} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">
                        మొబైల్ నంబర్ లేదా ఈమెయిల్
                      </label>
                      <div className="relative">
                        <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                        <input
                          type="text"
                          required
                          placeholder="9876543210 లేదా operator@isp.net"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 font-mono transition-all"
                          autoFocus
                        />
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1.5">
                        మీ WhatsApp నంబర్‌కు 6-అంకెల కోడ్ పంపబడుతుంది.
                      </p>
                    </div>

                    <Button
                      type="submit"
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl shadow-md shadow-emerald-600/20 transition-all text-xs sm:text-sm"
                      isLoading={isLoading}
                    >
                      <MessageSquare className="w-4 h-4 mr-2" />
                      <span>WhatsApp OTP పంపండి</span>
                    </Button>
                  </form>
                )}

                {step === 'tenantSelect' && (
                  <div className="space-y-4">
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800">
                      మీ మొబైల్ నంబర్‌కు సంబంధించి ఒకటి కంటే ఎక్కువ ISP నెట్‌వర్క్‌లు ఉన్నాయి. దయచేసి ఎంచుకోండి:
                    </div>

                    <div className="space-y-2 max-h-56 overflow-y-auto">
                      {availableTenants.map((t) => (
                        <button
                          key={t.slug}
                          onClick={() => handleTenantSelect(t.slug)}
                          className="w-full p-3.5 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-emerald-500 text-left transition flex items-center justify-between group"
                        >
                          <div>
                            <p className="font-bold text-slate-900 text-xs sm:text-sm group-hover:text-emerald-700">
                              {t.displayName}
                            </p>
                            <p className="text-[10px] text-slate-500 font-mono mt-0.5">Tenant: {t.slug}</p>
                          </div>
                          <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600" />
                        </button>
                      ))}
                    </div>

                    <Button
                      variant="outline"
                      onClick={() => setStep('phone')}
                      className="w-full text-xs border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
                    >
                      ← వెనుకకు (Back)
                    </Button>
                  </div>
                )}

                {step === 'otp' && (
                  <form onSubmit={handleVerifyOtp} className="space-y-4">
                    <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-start space-x-2.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold text-slate-900">WhatsApp OTP పంపబడింది</p>
                        <p className="text-[11px] text-emerald-800 mt-0.5">
                          <strong>{destinationMasked}</strong> ({operatorName} · {tenantName}) కు కోడ్ అందింది.
                        </p>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1.5">
                        6-అంకెల WhatsApp OTP కోడ్
                      </label>
                      <div className="relative">
                        <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                        <input
                          type="text"
                          required
                          maxLength={6}
                          placeholder="••••••"
                          value={otp}
                          onChange={(e) => setOtp(e.target.value.trim())}
                          className="w-full bg-slate-50 border border-slate-200 focus:border-emerald-500 rounded-xl pl-10 pr-3.5 py-2.5 text-base tracking-widest text-center text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 font-mono"
                          autoFocus
                        />
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl shadow-md shadow-emerald-600/20 transition-all text-xs sm:text-sm"
                      isLoading={isLoading}
                    >
                      <span>వెరిఫై చేసి లాగిన్ అవ్వండి</span>
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>

                    <div className="flex items-center justify-between text-xs pt-2">
                      <button
                        type="button"
                        onClick={() => setStep('phone')}
                        className="text-slate-500 hover:text-slate-800 transition-colors"
                      >
                        ← నంబర్ మార్చండి
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRequestOtp()}
                        disabled={resendTimer > 0 || isLoading}
                        className="text-emerald-700 hover:text-emerald-800 font-semibold disabled:text-slate-400 disabled:cursor-not-allowed flex items-center space-x-1"
                      >
                        <RefreshCw className={`w-3 h-3 ${resendTimer > 0 ? 'animate-spin' : ''}`} />
                        <span>{resendTimer > 0 ? `${resendTimer}s లో మళ్లీ పంపవచ్చు` : 'మళ్లీ పంపండి (Resend)'}</span>
                      </button>
                    </div>
                  </form>
                )}
              </>
            )}

            {/* METHOD 2: PASSWORD LOGIN */}
            {activeMode === 'password' && allowPassword && (
              <form onSubmit={handlePasswordLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    యూజర్‌నేమ్ లేదా ఈమెయిల్
                  </label>
                  <div className="relative">
                    <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      type="text"
                      required
                      placeholder="operator@rudra.net"
                      value={passwordIdentifier}
                      onChange={(e) => setPasswordIdentifier(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-mono transition-all"
                      autoFocus
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    పాస్‌వర్డ్ (Password)
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      type="password"
                      required
                      placeholder="పాస్‌వర్డ్ ఎంటర్ చేయండి"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    ISP టెనెంట్ స్లగ్ (ఆప్షనల్)
                  </label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                    <input
                      type="text"
                      placeholder="ఉదాహరణ: rudra"
                      value={passwordSlug}
                      onChange={(e) => setPasswordSlug(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-mono transition-all"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    యాక్టివ్ టెనెంట్: <code className="text-blue-600 font-bold font-mono">rudra</code> (ఆటో-డిటెక్ట్ అవుతుంది)
                  </p>
                </div>

                <Button
                  type="submit"
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-md shadow-blue-600/20 transition-all text-xs sm:text-sm"
                  isLoading={isLoading}
                >
                  <Lock className="w-4 h-4 mr-2" />
                  <span>సైన్ ఇన్ అవ్వండి (Sign In)</span>
                </Button>

                {/* Quick Autofill Helper Pill */}
                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={handleQuickFillRudra}
                    className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-semibold transition-all"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                    <span>రుద్ర టెనెంట్ ఆటో-ఫిల్ (Rudra Quick Fill)</span>
                  </button>
                </div>
              </form>
            )}

            {/* Sub-Card Navigation & Superadmin Link */}
            <div className="mt-6 border-t border-slate-200 pt-4 flex items-center justify-between text-xs text-slate-500">
              <span className="flex items-center space-x-1.5">
                <Server className="w-3.5 h-3.5 text-slate-400" />
                <span>NOC సర్వర్ ఆన్‌లైన్</span>
              </span>
              <Link
                to="/superadmin/login"
                className="text-blue-600 hover:text-blue-700 font-bold transition-colors flex items-center space-x-1"
              >
                <span>సూపర్ అడ్మిన్ లాగిన్</span>
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>

          {/* Security Features Bottom Strip */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 text-xs text-slate-500 font-medium">
            <span className="flex items-center space-x-1">
              <Shield className="w-3.5 h-3.5 text-emerald-600" />
              <span>256-Bit SSL సెక్యూర్</span>
            </span>
            <span>•</span>
            <span className="flex items-center space-x-1">
              <Lock className="w-3.5 h-3.5 text-blue-600" />
              <span>RFC 2617 CWMP డైజెస్ట్</span>
            </span>
            <span>•</span>
            <span>టెనెంట్ ఐసోలేషన్</span>
          </div>
        </div>
      </main>

      {/* Clean Footer */}
      <footer className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-4 border-t border-slate-200 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2">
        <p>© 2026 AI ISP Operating System. TR-069 / TR-181 Carrier Standard.</p>
        <div className="flex items-center space-x-4">
          <Link to="/customer/login" className="hover:text-blue-600 transition-colors">కస్టమర్ పోర్టల్</Link>
          <Link to="/tech/login" className="hover:text-blue-600 transition-colors">టెక్నీషియన్ యాప్</Link>
        </div>
      </footer>
    </div>
  );
};
