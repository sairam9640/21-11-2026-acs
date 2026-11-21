import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Mail, KeyRound, ArrowRight, CheckCircle2, Lock, UserPlus, Phone, User as UserIcon } from 'lucide-react';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';
import { Button, Input } from '../../components/ui/Button.js';

export const SuperAdminLogin: React.FC = () => {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'email' | 'otp' | 'setup'>('email');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Initial Setup State
  const [setupData, setSetupData] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });

  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    // Check if any Super Admin exists in the database
    api.checkSuperAdminSetup().then((res) => {
      if (res && res.success && res.setupRequired) {
        setStep('setup');
      }
    }).catch(() => {
      // Keep default email step if status check fails
    });
  }, []);

  const handleInitialSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (setupData.password !== setupData.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (setupData.password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setIsLoading(true);
    setError(null);

    const res = await api.superAdminInitialSetup({
      fullName: setupData.fullName,
      email: setupData.email,
      phone: setupData.phone,
      password: setupData.password,
    });
    setIsLoading(false);

    if (res && res.success) {
      setSuccessMsg('Super Administrator created successfully! Please sign in.');
      setEmail(setupData.email);
      setStep('email');
    } else {
      setError(res?.error || 'Failed to initialize Super Administrator.');
    }
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);

    const res = await api.superAdminRequestOtp(email);
    setIsLoading(false);

    if (res.success) {
      setStep('otp');
    } else {
      setError(res.error || 'Failed to send OTP');
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const res = await api.superAdminVerifyOtp(email, otp);
    setIsLoading(false);

    if (res.success && res.token) {
      login(res.token, res.user);
      navigate('/superadmin/dashboard');
    } else {
      setError(res.error || 'Invalid OTP code or password.');
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="w-14 h-14 rounded-2xl bg-[#EFF6FF] border border-[#BFDBFE] flex items-center justify-center mx-auto text-[#1677FF] shadow-lg shadow-sky-500/10 mb-4">
          <Shield className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-[#0F172A]">AI ISP OS Control Plane</h2>
        <p className="text-xs text-[#64748B] mt-1">
          {step === 'setup' ? 'First-Time Setup: Create Primary Super Administrator' : 'Super Administrator SaaS Management Console'}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white border border-[#E2E8F0] py-8 px-6 shadow-2xl rounded-2xl sm:px-10 backdrop-blur-md">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] text-xs flex items-center space-x-2">
              <Lock className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="mb-4 p-3 rounded-lg bg-[#F0FDF4] border border-[#BBF7D0] text-[#166534] text-xs flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {step === 'setup' ? (
            <form onSubmit={handleInitialSetup} className="space-y-4">
              <div className="p-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg text-xs text-[#1D4ED8]">
                <strong>Welcome!</strong> No Super Administrator exists yet. Please create the primary administrator account to secure this installation.
              </div>

              <Input
                label="Full Name"
                type="text"
                required
                value={setupData.fullName}
                onChange={(e) => setSetupData({ ...setupData, fullName: e.target.value })}
                placeholder="e.g. Administrator"
                icon={UserIcon}
                autoFocus
              />

              <Input
                label="Super Admin Email"
                type="email"
                required
                value={setupData.email}
                onChange={(e) => setSetupData({ ...setupData, email: e.target.value })}
                placeholder="admin@yourisp.com"
                icon={Mail}
              />

              <Input
                label="Mobile Number (Optional)"
                type="tel"
                value={setupData.phone}
                onChange={(e) => setSetupData({ ...setupData, phone: e.target.value })}
                placeholder="+91 98765 43210"
                icon={Phone}
              />

              <Input
                label="Create Password (Min 8 characters)"
                type="password"
                required
                value={setupData.password}
                onChange={(e) => setSetupData({ ...setupData, password: e.target.value })}
                placeholder="••••••••"
                icon={KeyRound}
              />

              <Input
                label="Confirm Password"
                type="password"
                required
                value={setupData.confirmPassword}
                onChange={(e) => setSetupData({ ...setupData, confirmPassword: e.target.value })}
                placeholder="••••••••"
                icon={KeyRound}
              />

              <Button type="submit" className="w-full" isLoading={isLoading}>
                <UserPlus className="w-4 h-4 mr-2" />
                <span>Initialize Super Administrator</span>
              </Button>
            </form>
          ) : step === 'email' ? (
            <form onSubmit={handleRequestOtp} className="space-y-4">
              <Input
                label="Super Admin Email Address or Mobile Number"
                type="text"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter registered email or mobile number"
                icon={Mail}
                autoFocus
              />
              <p className="text-[11px] text-[#94A3B8]">
                Enter registered email to receive dynamic passcode, or sign in with your password.
              </p>
              <Button type="submit" className="w-full" isLoading={isLoading}>
                <span>Continue</span>
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="p-3 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg text-xs text-[#1D4ED8] flex items-center justify-between">
                <span>Signing in as {email}</span>
                <button
                  type="button"
                  onClick={() => setStep('email')}
                  className="text-[#1677FF] underline hover:text-[#1D4ED8]"
                >
                  Change
                </button>
              </div>

              <Input
                label="Enter 6-Digit Passcode or Password"
                type="password"
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="6-digit OTP or Password"
                icon={KeyRound}
                className="text-center font-mono font-bold"
                autoFocus
              />

              <Button type="submit" className="w-full" isLoading={isLoading}>
                <CheckCircle2 className="w-4 h-4 mr-2" />
                <span>Verify & Sign In</span>
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
