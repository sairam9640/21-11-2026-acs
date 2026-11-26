import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Wifi,
  Activity,
  Server,
  Zap,
  Building2,
  Users,
  Wrench,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Cpu,
  Globe,
  Database,
  Terminal,
  Lock,
  Play,
  Languages,
  Check,
  ChevronRight,
  Radio,
  Gauge
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext.js';
import { SpeedtestWidget } from '../components/SpeedtestWidget.js';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { lang, setLang, t } = useLanguage();

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-blue-600 selection:text-white antialiased">
      {/* 1. TOP STICKY NAVBAR - CLEAN & LIGHT */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between">
          {/* Brand Logo */}
          <Link to="/" className="flex items-center space-x-3 group">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-all">
              <Zap className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-black text-lg sm:text-xl tracking-tight text-slate-900">
                  {lang === 'te' ? 'AI ISP OS' : 'AI ISP OS'}
                </span>
                <span className="bg-blue-50 text-blue-700 text-[10px] font-black uppercase px-2 py-0.5 rounded-full border border-blue-200/60 hidden sm:inline-block">
                  ACS Core 2.4
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium hidden sm:block">
                {t('brandSubtitle')}
              </p>
            </div>
          </Link>

          {/* Center Navigation Links */}
          <nav className="hidden md:flex items-center space-x-6 text-xs font-bold text-slate-600">
            <a href="#portals" className="hover:text-blue-600 transition-colors">
              {t('navPortals')}
            </a>
            <a href="#speedtest" className="hover:text-blue-600 transition-colors flex items-center space-x-1">
              <Gauge className="w-3.5 h-3.5 text-blue-500" />
              <span>{t('navSpeedtest')}</span>
            </a>
            <a href="#vendors" className="hover:text-blue-600 transition-colors">
              {lang === 'te' ? 'మద్దతు రౌటర్లు' : 'ONT Compatibility'}
            </a>
            <a href="#features" className="hover:text-blue-600 transition-colors">
              {t('navFeatures')}
            </a>
          </nav>

          {/* Right Action Bar: Language Selector & Login */}
          <div className="flex items-center space-x-3">
            {/* Language Switcher Pill */}
            <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setLang('te')}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all flex items-center space-x-1 ${
                  lang === 'te'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
                title="తెలుగు భాషను ఎంచుకోండి"
              >
                <span>🇮🇳</span>
                <span>తెలుగు</span>
              </button>
              <button
                type="button"
                onClick={() => setLang('en')}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all flex items-center space-x-1 ${
                  lang === 'en'
                    ? 'bg-white text-blue-700 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
                title="Switch to English"
              >
                <span>🇺🇸</span>
                <span>English</span>
              </button>
            </div>

            {/* Operator NOC Portal Button */}
            <Link
              to="/login"
              className="px-4 py-2 sm:px-5 sm:py-2.5 text-xs font-black text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 rounded-xl shadow-md shadow-blue-500/20 transition-all flex items-center space-x-1.5 active:scale-95"
            >
              <span>{t('navLogin')}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* 2. HERO SECTION - CLEAN LIGHT THEME */}
      <section className="relative overflow-hidden pt-12 pb-16 sm:pt-20 sm:pb-24 border-b border-slate-200/60 bg-gradient-to-b from-white via-slate-50/50 to-[#F8FAFC]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          {/* Top Pill */}
          <div className="inline-flex items-center space-x-2 bg-blue-50 border border-blue-200/80 px-3.5 py-1.5 rounded-full text-xs font-bold text-blue-700 mb-6 shadow-xs animate-fadeIn">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>{t('heroBadge')}</span>
            <span className="text-blue-300">|</span>
            <span className="font-mono text-[11px] text-blue-600 font-semibold">CWMP Port 7547 & 4000 Active</span>
          </div>

          {/* Main Hero Headline */}
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight text-slate-900 max-w-4xl mx-auto leading-[1.15]">
            {t('heroTitle1')}
            <span className="block mt-2 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent">
              {t('heroTitle2')}
            </span>
          </h1>

          {/* Subtitle Description */}
          <p className="mt-6 text-sm sm:text-base text-slate-600 max-w-2xl mx-auto leading-relaxed font-medium">
            {t('heroDesc')}
          </p>

          {/* Hero CTAs */}
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/login"
              className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-black text-sm shadow-xl shadow-blue-500/25 transition-all flex items-center justify-center space-x-2 active:scale-95"
            >
              <span>{t('heroCtaOperator')}</span>
              <ArrowRight className="w-4 h-4" />
            </Link>

            <a
              href="#speedtest"
              className="w-full sm:w-auto px-8 py-3.5 rounded-2xl bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 font-bold text-sm shadow-xs transition-all flex items-center justify-center space-x-2 active:scale-95"
            >
              <Gauge className="w-4 h-4 text-blue-600" />
              <span>{t('heroCtaSpeedtest')}</span>
            </a>
          </div>

          {/* Live System Telemetry Badges */}
          <div className="mt-12 grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-3xl mx-auto text-left">
            <div className="p-3.5 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Production Server</span>
              <span className="font-mono font-bold text-xs text-slate-800">{window.location.hostname || 'ACS Gateway'}</span>
            </div>
            <div className="p-3.5 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Security Protocol</span>
              <span className="font-mono font-bold text-xs text-emerald-600 flex items-center">
                <Check className="w-3.5 h-3.5 mr-1" />
                RFC 2617 Digest
              </span>
            </div>
            <div className="p-3.5 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Data Models</span>
              <span className="font-mono font-bold text-xs text-blue-600">TR-098 + TR-181</span>
            </div>
            <div className="p-3.5 bg-white rounded-2xl border border-slate-200/80 shadow-xs">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Fault 9005 Guard</span>
              <span className="font-mono font-bold text-xs text-purple-600">Active Auto-Shield</span>
            </div>
          </div>
        </div>
      </section>

      {/* 3. DIRECT PORTAL ACCESS GRID */}
      <section id="portals" className="py-16 sm:py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900">
            {t('portalHeading')}
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-2 font-medium">
            {t('portalSubheading')}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* 1. Operator NOC Portal */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs hover:shadow-xl hover:border-blue-300 transition-all group flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold mb-4 group-hover:scale-110 transition-transform">
                <Radio className="w-6 h-6" />
              </div>
              <h3 className="font-black text-slate-900 text-lg group-hover:text-blue-600 transition-colors">
                {t('portalOperator')}
              </h3>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                {t('portalOperatorDesc')}
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[11px] font-mono font-bold text-blue-600">/login</span>
              <Link
                to="/login"
                className="px-3.5 py-1.5 rounded-xl bg-blue-50 text-blue-700 font-bold text-xs group-hover:bg-blue-600 group-hover:text-white transition-all flex items-center space-x-1"
              >
                <span>{lang === 'te' ? 'ఓపెన్ చేయి' : 'Open'}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* 2. Super Admin Core */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs hover:shadow-xl hover:border-indigo-300 transition-all group flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold mb-4 group-hover:scale-110 transition-transform">
                <Building2 className="w-6 h-6" />
              </div>
              <h3 className="font-black text-slate-900 text-lg group-hover:text-indigo-600 transition-colors">
                {t('portalSuperadmin')}
              </h3>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                {t('portalSuperadminDesc')}
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[11px] font-mono font-bold text-indigo-600">/superadmin</span>
              <Link
                to="/superadmin/login"
                className="px-3.5 py-1.5 rounded-xl bg-indigo-50 text-indigo-700 font-bold text-xs group-hover:bg-indigo-600 group-hover:text-white transition-all flex items-center space-x-1"
              >
                <span>{lang === 'te' ? 'ఓపెన్ చేయి' : 'Open'}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* 3. Subscriber Portal */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs hover:shadow-xl hover:border-emerald-300 transition-all group flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold mb-4 group-hover:scale-110 transition-transform">
                <Users className="w-6 h-6" />
              </div>
              <h3 className="font-black text-slate-900 text-lg group-hover:text-emerald-600 transition-colors">
                {t('portalSubscriber')}
              </h3>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                {t('portalSubscriberDesc')}
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[11px] font-mono font-bold text-emerald-600">/customer</span>
              <Link
                to="/customer/login"
                className="px-3.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 font-bold text-xs group-hover:bg-emerald-600 group-hover:text-white transition-all flex items-center space-x-1"
              >
                <span>{lang === 'te' ? 'ఓపెన్ చేయి' : 'Open'}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* 4. Field Tech Mobile App */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs hover:shadow-xl hover:border-amber-300 transition-all group flex flex-col justify-between">
            <div>
              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold mb-4 group-hover:scale-110 transition-transform">
                <Wrench className="w-6 h-6" />
              </div>
              <h3 className="font-black text-slate-900 text-lg group-hover:text-amber-600 transition-colors">
                {t('portalTech')}
              </h3>
              <p className="text-xs text-slate-600 mt-2 leading-relaxed">
                {t('portalTechDesc')}
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[11px] font-mono font-bold text-amber-600">/tech</span>
              <Link
                to="/tech/login"
                className="px-3.5 py-1.5 rounded-xl bg-amber-50 text-amber-700 font-bold text-xs group-hover:bg-amber-600 group-hover:text-white transition-all flex items-center space-x-1"
              >
                <span>{lang === 'te' ? 'ఓపెన్ చేయి' : 'Open'}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 4. EMBEDDED SPEEDTEST SERVER SECTION */}
      <section id="speedtest" className="py-16 bg-white border-y border-slate-200/80">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <span className="inline-flex items-center space-x-1.5 bg-blue-50 text-blue-700 text-xs font-bold px-3 py-1 rounded-full border border-blue-200 mb-3">
              <Zap className="w-3.5 h-3.5" />
              <span>{lang === 'te' ? 'లైవ్ నెట్‌వర్క్ స్పీడ్ టెస్ట్' : 'Production Speedtest Engine'}</span>
            </span>
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900">
              {t('speedtestHeading')}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-2 font-medium max-w-xl mx-auto">
              {t('speedtestSubheading')}
            </p>
          </div>

          {/* Embedded Speedtest Widget Component */}
          <SpeedtestWidget />
        </div>
      </section>

      {/* 5. MULTI-VENDOR ONT COMPATIBILITY */}
      <section id="vendors" className="py-16 sm:py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900">
            {lang === 'te' ? 'ధృవీకరించబడిన మల్టీ-వెండర్ ONT రౌటర్లు' : 'Multi-Vendor Verified ONT Compatibility'}
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-2 font-medium">
            {lang === 'te' 
              ? 'సిస్టమ్ ఆటోమేటిక్గా రౌటర్ మోడల్ను గుర్తించి తగిన TR-069 పారామీటర్లను మాత్రమే డిస్పాచ్ చేస్తుంది'
              : 'Our dynamic engine detects ONT hardware and suppresses unsupported vendor parameters to prevent faults.'}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* Syrotech */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-black text-base text-slate-900">Syrotech 1110WD</span>
              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full">
                Realtek Luna SDK
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {lang === 'te'
                ? 'Fault 9005 లోపం రాకుండా ఆటో-గార్డ్ చేయబడింది. EPON & GPON VLANIDMark పాత్లకు తక్షణ అనుకూలత.'
                : 'Guarded against Fault 9005 parameter rejection. Full support for EPON & GPON VLANIDMark.'}
            </p>
            <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-1.5 text-[10px] font-mono font-bold text-slate-500">
              <span className="bg-slate-100 px-2 py-0.5 rounded">PPPoE</span>
              <span className="bg-slate-100 px-2 py-0.5 rounded">DHCP Route</span>
              <span className="bg-slate-100 px-2 py-0.5 rounded">Bridge</span>
              <span className="bg-slate-100 px-2 py-0.5 rounded">Optical -19.45 dBm</span>
            </div>
          </div>

          {/* Genexis */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-black text-base text-slate-900">Genexis Platinum-4410</span>
              <span className="bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold px-2 py-0.5 rounded-full">
                TR-181 Issue 2
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {lang === 'te'
                ? 'స్టాండర్డ్ బ్రాడ్‌బ్యాండ్ ఫోరం TR-181 డాటా మోడల్ మద్దతు. ఈథర్‌నెట్ VLANTermination మరియు Wi-Fi రేడియో ట్యూనింగ్.'
                : 'Full Broadband Forum TR-181 Issue 2 compliance. VLANTermination, Wi-Fi 5GHz & optical telemetry.'}
            </p>
            <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-1.5 text-[10px] font-mono font-bold text-slate-500">
              <span className="bg-slate-100 px-2 py-0.5 rounded">TR-181</span>
              <span className="bg-slate-100 px-2 py-0.5 rounded">Dual Band 5GHz</span>
              <span className="bg-slate-100 px-2 py-0.5 rounded">WPA2/WPA3</span>
            </div>
          </div>

          {/* Huawei & ZTE */}
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-black text-base text-slate-900">Huawei EchoLife & ZTE</span>
              <span className="bg-purple-50 text-purple-700 border border-purple-200 text-[10px] font-bold px-2 py-0.5 rounded-full">
                X_HW & CT-COM
              </span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {lang === 'te'
                ? 'హువాయి X_HW_VLAN మరియు చైనా టెలికాం X_CT-COM ఎక్స్‌టెన్షన్‌లకు ప్రత్యేకమైన ఆటో-రెస్పాన్స్ గార్డ్.'
                : 'Specialized handling for Huawei X_HW_VLAN and China Telecom X_CT-COM parameter extensions.'}
            </p>
            <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-1.5 text-[10px] font-mono font-bold text-slate-500">
              <span className="bg-slate-100 px-2 py-0.5 rounded">X_HW_VLAN</span>
              <span className="bg-slate-100 px-2 py-0.5 rounded">ServiceList</span>
              <span className="bg-slate-100 px-2 py-0.5 rounded">Voice SIP</span>
            </div>
          </div>
        </div>
      </section>

      {/* 6. ENTERPRISE ACS FEATURES */}
      <section id="features" className="py-16 bg-slate-100/60 border-t border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="text-2xl sm:text-3xl font-black text-slate-900">
              {t('featuresHeading')}
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
              <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                <Radio className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-slate-900 text-sm">{t('feat1Title')}</h4>
              <p className="text-xs text-slate-500 leading-relaxed">{t('feat1Desc')}</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
              <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-bold">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-slate-900 text-sm">{t('feat2Title')}</h4>
              <p className="text-xs text-slate-500 leading-relaxed">{t('feat2Desc')}</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
              <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                <Activity className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-slate-900 text-sm">{t('feat3Title')}</h4>
              <p className="text-xs text-slate-500 leading-relaxed">{t('feat3Desc')}</p>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-2">
              <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                <Cpu className="w-5 h-5" />
              </div>
              <h4 className="font-bold text-slate-900 text-sm">{t('feat4Title')}</h4>
              <p className="text-xs text-slate-500 leading-relaxed">{t('feat4Desc')}</p>
            </div>
          </div>
        </div>
      </section>

      {/* 7. FOOTER - CLEAN & LIGHT */}
      <footer className="bg-white border-t border-slate-200 py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs">
              ⚡
            </div>
            <span className="font-bold text-slate-700">AI ISP OS & ACS Core</span>
            <span>© 2026</span>
          </div>

          <div className="flex items-center space-x-4">
            <span>{t('footerTagline')}</span>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-[11px] font-mono text-emerald-600 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
              Carrier ACS Online
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};
