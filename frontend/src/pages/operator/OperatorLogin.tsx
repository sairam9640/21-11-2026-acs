import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, KeyRound, ArrowRight, Lock, Building2, MessageSquare, CheckCircle2, RefreshCw, Key, Shield } from 'lucide-react';
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

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="w-14 h-14 rounded-2xl bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-center mx-auto text-[#047857] shadow-lg shadow-emerald-500/10 mb-4">
          <MessageSquare className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-[#0F172A]">Operator NOC Portal</h2>
        <p className="text-xs text-[#64748B] mt-1">Authorized Carrier-Grade Operator Access</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white border border-[#E2E8F0] py-8 px-6 shadow-2xl rounded-2xl sm:px-10 backdrop-blur-md">
          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-xs flex items-center space-x-2.5">
              <Lock className="w-4 h-4 shrink-0 text-[#B91C1C]" />
              <span>{error}</span>
            </div>
          )}

          {/* Mode Switcher (Visible only if Super Admin enabled both methods) */}
          {allowOtp && allowPassword && (
            <div className="flex rounded-xl bg-slate-100 p-1 mb-6 border border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setActiveMode('otp');
                  setError(null);
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-lg transition-all ${
                  activeMode === 'otp'
                    ? 'bg-white text-emerald-800 shadow-sm border border-slate-200'
                    : 'text-slate-500 hover:text-slate-900'
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
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold rounded-lg transition-all ${
                  activeMode === 'password'
                    ? 'bg-white text-blue-800 shadow-sm border border-slate-200'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Key className="w-3.5 h-3.5 text-blue-600" />
                <span>Password Entry</span>
              </button>
            </div>
          )}

          {/* METHOD 1: WHATSAPP OTP LOGIN */}
          {activeMode === 'otp' && allowOtp && (
            <>
              {step === 'phone' && (
                <form onSubmit={handleRequestOtp} className="space-y-4">
                  <Input
                    label="Registered Mobile Number or Email"
                    type="text"
                    required
                    placeholder="e.g. 9876543210 or operator@isp.com"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    icon={Phone}
                    helperText="Dynamic 6-digit OTP will be dispatched to your WhatsApp"
                    autoFocus
                  />

                  <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold" isLoading={isLoading} variant="primary">
                    <MessageSquare className="w-4 h-4 mr-2" />
                    <span>Send WhatsApp OTP</span>
                  </Button>
                </form>
              )}

              {step === 'tenantSelect' && (
                <div className="space-y-4">
                  <div className="p-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl text-xs text-[#1D4ED8]">
                    Multiple ISP Tenants found for your mobile number. Please select your NOC context:
                  </div>

                  <div className="space-y-2">
                    {availableTenants.map((t) => (
                      <button
                        key={t.slug}
                        onClick={() => handleTenantSelect(t.slug)}
                        className="w-full p-3.5 rounded-xl bg-[#F8FAFC] hover:bg-[#F1F5F9] border border-[#CBD5E1] hover:border-emerald-500/50 text-left transition flex items-center justify-between"
                      >
                        <div>
                          <p className="font-semibold text-[#0F172A] text-sm">{t.displayName}</p>
                          <p className="text-xs text-[#64748B] font-mono">Slug: {t.slug}</p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-[#64748B]" />
                      </button>
                    ))}
                  </div>

                  <Button
                    variant="outline"
                    onClick={() => setStep('phone')}
                    className="w-full text-xs"
                  >
                    ← Back
                  </Button>
                </div>
              )}

              {step === 'otp' && (
                <form onSubmit={handleVerifyOtp} className="space-y-5">
                  <div className="p-3.5 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] text-xs text-[#065F46] flex items-start space-x-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#047857] shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-[#0F172A]">WhatsApp OTP Dispatched</p>
                      <p className="text-[11px] text-[#065F46]/80 mt-0.5">
                        Sent to <strong>{destinationMasked}</strong> ({operatorName} · {tenantName}).
                      </p>
                    </div>
                  </div>

                  <Input
                    label="6-Digit WhatsApp OTP Code"
                    required
                    placeholder="••••••"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.trim())}
                    icon={KeyRound}
                    helperText="Enter the 6-digit code received on your WhatsApp"
                    autoFocus
                  />

                  <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold" isLoading={isLoading} variant="primary">
                    <span>Verify & Enter NOC</span>
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>

                  <div className="flex items-center justify-between text-xs pt-2">
                    <button
                      type="button"
                      onClick={() => setStep('phone')}
                      className="text-[#64748B] hover:text-[#1E293B]"
                    >
                      ← Change Number
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRequestOtp()}
                      disabled={resendTimer > 0 || isLoading}
                      className="text-[#047857] hover:text-[#065F46] disabled:text-slate-400 disabled:cursor-not-allowed flex items-center space-x-1"
                    >
                      <RefreshCw className={`w-3 h-3 ${resendTimer > 0 ? 'animate-spin' : ''}`} />
                      <span>{resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend OTP'}</span>
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          {/* METHOD 2: MANUAL PASSWORD LOGIN */}
          {activeMode === 'password' && allowPassword && (
            <form onSubmit={handlePasswordLogin} className="space-y-4">
              <Input
                label="Registered Mobile Number or Email"
                type="text"
                required
                placeholder="e.g. operator@isp.com or 9876543210"
                value={passwordIdentifier}
                onChange={(e) => setPasswordIdentifier(e.target.value)}
                icon={Phone}
                helperText="Enter your registered operator identifier"
                autoFocus
              />

              <Input
                label="Password"
                type="password"
                required
                placeholder="Enter your account password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                icon={Lock}
              />

              <Input
                label="ISP Tenant Slug (Optional)"
                type="text"
                placeholder="e.g. apex (leave empty for default)"
                value={passwordSlug}
                onChange={(e) => setPasswordSlug(e.target.value)}
                icon={Building2}
                helperText="Required only if accessing a specific isolated tenant"
              />

              <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold" isLoading={isLoading} variant="primary">
                <Lock className="w-4 h-4 mr-2" />
                <span>Sign In with Password</span>
              </Button>
            </form>
          )}

          {/* Fallback if neither mode is permitted */}
          {!allowOtp && !allowPassword && policyLoaded && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs text-center space-y-2">
              <Shield className="w-6 h-6 text-amber-600 mx-auto" />
              <p className="font-bold">Operator Login Temporarily Disabled</p>
              <p className="text-slate-600">Please contact your Super Administrator to enable an authentication method.</p>
            </div>
          )}

          <div className="mt-6 border-t border-[#E2E8F0] pt-4 flex items-center justify-between text-[11px] text-[#94A3B8]">
            <span>Tenant Subdomain Binding: http://&lt;slug&gt;.{window.location.hostname || 'yourdomain.com'}</span>
            <button
              type="button"
              onClick={() => navigate('/superadmin/login')}
              className="text-[#1677FF] hover:text-[#1D4ED8]"
            >
              Super Admin Console →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
