import React, { createContext, useContext, useState, useEffect } from 'react';

export type Language = 'en' | 'te';

export interface Translations {
  [key: string]: {
    en: string;
    te: string;
  };
}

export const translations: Translations = {
  // Brand & Header
  brandTitle: { en: 'AI ISP OS & ACS Core', te: 'ఏఐ ఐఎస్పీ ఓఎస్ & ఏసీఎస్ కోర్' },
  brandSubtitle: { en: 'Carrier-Grade CWMP Engine & Broadband Automation', te: 'టెలికాం గ్రేడ్ CWMP ఇంజిన్ & బ్రాడ్‌బ్యాండ్ ఆటోమేషన్' },
  language: { en: 'English', te: 'తెలుగు' },
  selectLanguage: { en: 'Language', te: 'భాష' },

  // Nav Items
  navPortals: { en: 'Portals', te: 'పోర్టల్స్' },
  navSpeedtest: { en: 'Speedtest', te: 'స్పీడ్‌టెస్ట్' },
  navFeatures: { en: 'Features', te: 'ఫీచర్లు' },
  navSecurity: { en: 'Security', te: 'సెక్యూరిటీ' },
  navLogin: { en: 'Operator Login', te: 'ఆపరేటర్ లాగిన్' },

  // Hero Section
  heroBadge: { en: 'Next-Gen TR-069 / TR-181 ACS Cloud', te: 'నెక్స్ట్-జెన్ TR-069 / TR-181 ఏసీఎస్ క్లౌడ్' },
  heroTitle1: { en: 'Autonomous ACS & ISP Operating System', te: 'ఆటోమేటెడ్ ఏసీఎస్ & ఐఎస్పీ ఆపరేటింగ్ సిస్టమ్' },
  heroTitle2: { en: 'Zero-Touch ONT Configuration & Live Diagnostics', te: 'జీరో-టచ్ రౌటర్ కాన్ఫిగరేషన్ & లైవ్ డయాగ్నోస్టిక్స్' },
  heroDesc: {
    en: 'Real-time TR-069 CWMP stack, dynamic WAN & VLAN slot provisioning, multi-vendor ONT support (Syrotech, Genexis, Huawei, ZTE, TP-Link, Realtek, Netlink), and built-in bandwidth speedtest.',
    te: 'రియల్-టైమ్ TR-069 CWMP స్టాక్, డైనమిక్ వ్యాన్ & వీలాన్ స్లాట్ ప్రొవిజనింగ్, మల్టీ-వెండర్ ONT మద్దతు (సైరోటెక్, జెనెసిస్, హువాయి, ZTE, టిపి-లింక్, రియల్టెక్), మరియు అంతర్నిర్మిత స్పీడ్‌టెస్ట్.'
  },
  heroCtaOperator: { en: 'Launch Operator NOC', te: 'ఆపరేటర్ NOC లాగిన్' },
  heroCtaSpeedtest: { en: 'Run Live Speedtest', te: 'లైవ్ స్పీడ్‌టెస్ట్ ప్రారంభించు' },

  // Quick Portal Access Cards
  portalHeading: { en: 'Direct Portal Access Grid', te: 'డైరెక్ట్ పోర్టల్ లాగిన్ గ్రిడ్' },
  portalSubheading: { en: 'Select your operational dashboard to access ACS controls', te: 'మీ బాధ్యతకు అనుగుణంగా తగిన పోర్టల్‌ను ఎంచుకోండి' },
  portalOperator: { en: 'Operator NOC Portal', te: 'ఆపరేటర్ NOC పోర్టల్' },
  portalOperatorDesc: { en: 'Manage ONTs, live CWMP sessions, WAN profiles, optical telemetry, and diagnostic ping.', te: 'రౌటర్లు, లైవ్ CWMP సెషన్లు, వ్యాన్ ప్రొఫైల్స్, ఆప్టికల్ పవర్ మరియు డయాగ్నోస్టిక్స్.' },
  portalSuperadmin: { en: 'Super Admin Core', te: 'సూపర్ అడ్మిన్ కోర్' },
  portalSuperadminDesc: { en: 'Tenant provisioning, gateway management, system logs, and global telemetry.', te: 'టెనెంట్ నిర్వహణ, గేట్‌వే కాన్ఫిగరేషన్ మరియు గ్లోబల్ సిస్టమ్ పర్యవేక్షణ.' },
  portalSubscriber: { en: 'Subscriber Self-Care', te: 'కస్టమర్ సెల్ఫ్-కేర్ పోర్టల్' },
  portalSubscriberDesc: { en: 'Instant bill payments, plan renewal, invoice downloads, and Wi-Fi password reset.', te: 'బిల్లు చెల్లింపులు, ప్లాన్ రెన్యూవల్, రసీదులు మరియు వైఫై పాస్‌వర్డ్ మార్పు.' },
  portalTech: { en: 'Field Tech Mobile App', te: 'ఫీల్డ్ టెక్నీషియన్ యాప్' },
  portalTechDesc: { en: 'Mobile PWA for barcode scanning, premise fiber installation, and signal verification.', te: 'మొబైల్ PWA, బార్‌కోడ్ స్కానింగ్, ఫైబర్ ఇన్‌స్టాలేషన్ మరియు సిగ్నల్ ధృవీకరణ.' },

  // Speedtest Section
  speedtestHeading: { en: 'Core Network Speedtest Server', te: 'కోర్ నెట్‌వర్క్ స్పీడ్‌టెస్ట్ సర్వర్' },
  speedtestSubheading: { en: 'Test real-time ISP bandwidth, latency, and packet jitter directly on our production VPS.', te: 'ప్రొడక్షన్ VPS సర్వర్ నుండి నేరుగా ఇంటర్నెట్ స్పీడ్, లేటెన్సీ మరియు పింగ్ టెస్ట్ చేయండి.' },
  startSpeedtest: { en: 'Start Speed Test', te: 'స్పీడ్ టెస్ట్ ప్రారంభించు' },
  testingPing: { en: 'Testing Ping & Jitter...', te: 'పింగ్ & జిట్టర్ తనిఖీ చేస్తోంది...' },
  testingDownload: { en: 'Testing Download Throughput...', te: 'డౌన్‌లోడ్ స్పీడ్ పరీక్షిస్తోంది...' },
  testingUpload: { en: 'Testing Upload Throughput...', te: 'అప్‌లోడ్ స్పీడ్ పరీక్షిస్తోంది...' },
  testCompleted: { en: 'Speedtest Completed', te: 'స్పీడ్‌టెస్ట్ విజయవంతంగా పూర్తయింది' },
  pingLabel: { en: 'Latency / Ping', te: 'లేటెన్సీ / పింగ్' },
  jitterLabel: { en: 'Jitter', te: 'జిట్టర్' },
  downloadLabel: { en: 'Download Speed', te: 'డౌన్‌లోడ్ స్పీడ్' },
  uploadLabel: { en: 'Upload Speed', te: 'అప్‌లోడ్ స్పీడ్' },
  serverLabel: { en: 'Speedtest Node', te: 'స్పీడ్‌టెస్ట్ సర్వర్' },

  // Live ACS Capabilities
  featuresHeading: { en: 'Enterprise Carrier-Grade ACS Engine', te: 'ఎంటర్‌ప్రైజ్ టెలికాం-గ్రేడ్ ఏసీఎస్ ఇంజిన్' },
  feat1Title: { en: 'Universal TR-069 & TR-181 Stack', te: 'యూనివర్సల్ TR-069 & TR-181 స్టాక్' },
  feat1Desc: { en: 'Native CWMP protocol engine supporting both TR-098 and TR-181 data models with live tree discovery and auto-slot allocation.', te: 'లైవ్ పారామీటర్ ట్రీ డిస్కవరీ మరియు ఆటోమేటిక్ స్లాట్ కేటాయింపుతో కూడిన పూర్తి CWMP ఇంజిన్.' },
  feat2Title: { en: 'Multi-Vendor ONT Auto-Guard', te: 'మల్టీ-వెండర్ రౌటర్ ఆటో-గార్డ్' },
  feat2Desc: { en: 'Specialized parameter suppression preventing Fault 9005 & 9003 across Syrotech, Genexis, Realtek, Huawei, ZTE, and Netlink ONTs.', te: 'సైరోటెక్, జెనెసిస్, రియల్టెక్, హువాయి రౌటర్లలో Fault 9005 & 9003 లోపాలు రాకుండా ఆటో-గార్డ్.' },
  feat3Title: { en: 'Real ICMP Diagnostics', te: 'రియల్ ICMP నెట్‌వర్క్ డయాగ్నోస్టిక్స్' },
  feat3Desc: { en: 'Live round-trip packet transmission with 0% mock data. Accurate latency, packet loss, and round-trip time directly from the server.', te: '0% డమ్మీ డేటా — సర్వర్ మరియు రౌటర్ నుండి నేరుగా ఖచ్చితమైన పింగ్, ప్యాకెట్ లాస్ మరియు లేటెన్సీ.' },
  feat4Title: { en: 'Live CWMP Session Tracker', te: 'లైవ్ CWMP సెషన్ ట్రాకర్' },
  feat4Desc: { en: 'Accurate countdown to the next scheduled periodic inform, session status, and one-click instant connection request trigger.', te: 'తదుపరి పీరియాడిక్ ఇన్ఫార్మ్ కౌంట్‌డౌన్, సెషన్ స్టేటస్ మరియు తక్షణ రౌటర్ వేక్-అప్ బటన్.' },

  // Footer
  footerRights: { en: 'All Rights Reserved. Carrier-Grade Broadband Management.', te: 'సర్వ హక్కులు ప్రత్యేకించబడ్డాయి. టెలికాం బ్రాడ్‌బ్యాండ్ మేనేజ్‌మెంట్.' },
  footerTagline: { en: 'Engineered for ISP Operators, LCOs, and High-Speed Fiber Networks.', te: 'ఐఎస్పీ ఆపరేటర్లు, LCOలు మరియు హై-స్పీడ్ ఫైబర్ నెట్‌వర్క్‌ల కోసం రూపొందించబడింది.' },
};

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: keyof typeof translations) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'te',
  setLang: () => {},
  t: (key) => translations[key]?.te || String(key),
});

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem('acs_lang');
    return saved === 'en' ? 'en' : 'te';
  });

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    localStorage.setItem('acs_lang', newLang);
  };

  const t = (key: keyof typeof translations): string => {
    const entry = translations[key];
    if (!entry) return String(key);
    return entry[lang] || entry.en || String(key);
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
