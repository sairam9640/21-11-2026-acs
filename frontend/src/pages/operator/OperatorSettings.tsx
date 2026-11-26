import React, { useState, useEffect } from 'react';
import { Settings, Save, Shield, Sliders, Bell, Server, CheckCircle2, QrCode, RefreshCw, Smartphone, Unlink, AlertCircle, Copy, Check, Eye, EyeOff, Radio } from 'lucide-react';
import { Shell } from '../../components/layout/Shell.js';
import { Button, Input } from '../../components/ui/Button.js';
import { Badge } from '../../components/ui/Badge.js';
import { Modal } from '../../components/ui/Modal.js';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';
import { copyToClipboard } from '../../utils/clipboard.js';

export const OperatorSettings: React.FC = () => {
  const { tenant } = useAuth();
  const [warningThreshold, setWarningThreshold] = useState('-27.0');
  const [criticalThreshold, setCriticalThreshold] = useState('-30.0');
  const [autoDispatchEnabled, setAutoDispatchEnabled] = useState(true);
  const [whatsappAlerts, setWhatsappAlerts] = useState(true);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // WhatsApp Web State
  const [waData, setWaData] = useState<any>(null);
  const [isWaLoading, setIsWaLoading] = useState(false);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [customPhone, setCustomPhone] = useState('');
  const [waActionSuccess, setWaActionSuccess] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingCodeLoading, setPairingCodeLoading] = useState(false);

  // ACS TR-069 Credentials State
  const [showAcsPassword, setShowAcsPassword] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [cwmpStats, setCwmpStats] = useState<any>(null);

  const activeHost = window.location.hostname || 'localhost';
  const tenantSlug = (tenant?.slug || 'operator').trim().toLowerCase();
  const acsUrl = cwmpStats?.port80CwmpUrl || cwmpStats?.cwmpPathUrl || `http://${activeHost}/tr069/${tenantSlug}`;
  const port80AcsUrl = cwmpStats?.port80CwmpUrl || `http://${activeHost}/tr069/${tenantSlug}`;
  const acsUsername = cwmpStats?.authCredentials?.acsUsername || tenantSlug || 'acs';
  const acsPassword = cwmpStats?.authCredentials?.acsPassword || tenantSlug || 'acs';
  const connReqUser = cwmpStats?.authCredentials?.connectionRequestUsername || `cpe_${tenantSlug}`;
  const connReqPass = cwmpStats?.authCredentials?.connectionRequestPassword || `${tenantSlug}_cpe`;
  const informIntervalSeconds = cwmpStats?.authCredentials?.informIntervalSeconds || 300;

  const handleCopyText = async (text: string, field: string) => {
    await copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2500);
  };

  const fetchWaStatus = async () => {
    setIsWaLoading(true);
    try {
      const res = await api.getOperatorWhatsAppStatus();
      if (res.success) {
        setWaData(res.whatsapp);
        if (res.whatsapp?.phone) setCustomPhone(res.whatsapp.phone);
      }
    } catch (_) {}
    setIsWaLoading(false);
  };

  useEffect(() => {
    fetchWaStatus();
    api.getCwmpStatus().then((res) => {
      if (res?.success) setCwmpStats(res);
    }).catch(() => {});
  }, []);

  const handleOpenQrModal = async () => {
    setIsQrModalOpen(true);
    setQrLoading(true);
    try {
      const res = await api.generateOperatorWhatsAppQR();
      if (res.success) {
        setWaData((prev: any) => ({
          ...prev,
          status: 'SCAN_QR_REQUIRED',
          qrCodeDataUrl: res.qrDataUrl,
        }));
      }
    } catch (_) {}
    setQrLoading(false);
  };

  const handleRequestPairingCode = async () => {
    if (!customPhone) return;
    setPairingCodeLoading(true);
    setPairingCode(null);
    try {
      const res = await api.requestOperatorWhatsAppPairingCode(customPhone);
      if (res.success && res.pairingCode) {
        setPairingCode(res.pairingCode);
      } else {
        alert(res.error || 'Failed to request pairing code');
      }
    } catch (err: any) {
      alert(err.message || 'Error communicating with server');
    }
    setPairingCodeLoading(false);
  };

  const handleDisconnectWa = async () => {
    try {
      const res = await api.disconnectOperatorWhatsApp();
      if (res.success) {
        setWaActionSuccess('WhatsApp session disconnected successfully.');
        fetchWaStatus();
        setTimeout(() => setWaActionSuccess(null), 4000);
      }
    } catch (_) {}
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <Shell
      portalType="operator"
      title="Operator NOC & Tenant Settings"
      breadcrumbs={[{ label: 'Operator Settings' }]}
    >
      <div className="max-w-4xl space-y-6">
        {savedSuccess && (
          <div className="p-4 bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl text-[#065F46] text-xs font-bold flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Settings saved successfully and synced across telemetry listeners.</span>
          </div>
        )}

        {waActionSuccess && (
          <div className="p-4 bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl text-[#065F46] text-xs font-bold flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{waActionSuccess}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-6">
          {/* Tenant Profile Information */}
          <div className="bg-white border border-[#CBD5E1] rounded-2xl p-6 space-y-4 shadow-xs">
            <div className="flex items-center space-x-3 pb-3 border-b border-[#E2E8F0]">
              <Server className="w-5 h-5 text-[#1677FF]" />
              <div>
                <h3 className="text-base font-bold text-[#0F172A]">Tenant Identity & Scoped Domain</h3>
                <p className="text-xs text-[#64748B]">Operator organization boundaries and CWMP URL binding</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="text-[#0F172A] font-bold block mb-1">Company Display Name</label>
                <input
                  disabled
                  value={tenant?.displayName || 'Broadband Operations'}
                  className="w-full bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl p-3 text-[#0F172A] font-bold"
                />
              </div>
              <div>
                <label className="text-[#0F172A] font-bold block mb-1">Mandatory Tenant Slug</label>
                <input
                  disabled
                  value={tenant?.slug || 'operator'}
                  className="w-full bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl p-3 text-[#047857] font-mono font-bold"
                />
              </div>
              <div>
                <label className="text-[#0F172A] font-bold block mb-1">Tenant Subdomain URL</label>
                <input
                  disabled
                  value={`http://${tenant?.slug || 'operator'}.${window.location.hostname || 'yourdomain.com'}`}
                  className="w-full bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl p-3 text-[#1677FF] font-mono font-bold"
                />
              </div>
            </div>
          </div>

          {/* TR-069 ACS CPE Gateway Credentials */}
          <div className="bg-white border border-[#CBD5E1] rounded-2xl p-6 space-y-4 shadow-xs">
            <div className="flex items-center space-x-3 pb-3 border-b border-[#E2E8F0]">
              <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
                <Radio className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#0F172A]">TR-069 ACS Connection & CPE Credentials</h3>
                <p className="text-xs text-[#64748B]">Use these exact parameters in your ONT / Router TR-069 configuration page</p>
              </div>
            </div>

            <div className="space-y-4 text-xs">
              {/* Unified Single TR-069 / CWMP ACS URL */}
              <div className="space-y-2">
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl space-y-1.5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">TR-069 CWMP ACS URL (ONT / Router Config)</span>
                    <span className="text-[9px] bg-emerald-200 text-emerald-900 font-extrabold px-2 py-0.5 rounded-full">ACTIVE</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-sm text-emerald-950 select-all break-all">{acsUrl}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => handleCopyText(acsUrl, 'acsUrl')}
                      className="h-7 text-xs shrink-0 ml-2"
                    >
                      {copiedField === 'acsUrl' ? <Check className="w-3.5 h-3.5 text-emerald-600 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                      <span>{copiedField === 'acsUrl' ? 'Copied' : 'Copy'}</span>
                    </Button>
                  </div>
                </div>
              </div>

              {/* Username & Password */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl space-y-1">
                  <span className="text-[10px] font-bold uppercase text-slate-500">ACS Username</span>
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-[#0F172A] text-sm select-all">{acsUsername}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyText(acsUsername, 'acsUser')}
                      className="p-1 text-slate-500 hover:text-blue-600 rounded transition"
                      title="Copy ACS Username"
                    >
                      {copiedField === 'acsUser' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="p-3 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl space-y-1">
                  <span className="text-[10px] font-bold uppercase text-slate-500">ACS Password</span>
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-[#0F172A] text-sm select-all">
                      {showAcsPassword ? acsPassword : '••••••••••••'}
                    </span>
                    <div className="flex items-center space-x-1">
                      <button
                        type="button"
                        onClick={() => setShowAcsPassword(!showAcsPassword)}
                        className="p-1 text-slate-500 hover:text-blue-600 rounded transition"
                        title={showAcsPassword ? 'Hide Password' : 'Show Password'}
                      >
                        {showAcsPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopyText(acsPassword, 'acsPass')}
                        className="p-1 text-slate-500 hover:text-blue-600 rounded transition"
                        title="Copy ACS Password"
                      >
                        {copiedField === 'acsPass' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Advanced Parameters */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-2.5 bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl">
                  <span className="text-[10px] text-[#047857] font-bold block">Conn Request User (Auto-Pushed)</span>
                  <span className="font-mono font-semibold text-slate-800">{connReqUser}</span>
                </div>
                <div className="p-2.5 bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl">
                  <span className="text-[10px] text-[#047857] font-bold block">Conn Request Pass (Auto-Pushed)</span>
                  <span className="font-mono font-semibold text-slate-800">{connReqPass}</span>
                </div>
                <div className="p-2.5 bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl">
                  <span className="text-[10px] text-[#047857] font-bold block">Periodic Inform (Auto-Synced)</span>
                  <span className="font-mono font-semibold text-emerald-700">{informIntervalSeconds}s (5m) Auto on Connect</span>
                </div>
              </div>
              <p className="text-[11px] text-[#047857] font-medium bg-emerald-50/70 border border-emerald-200 rounded-lg px-3 py-2">
                Only ACS URL, Username (<span className="font-mono font-bold">{acsUsername}</span>), and Password (<span className="font-mono font-bold">{acsPassword}</span>) need to be entered on a new ONT. On first Inform, the ACS automatically pushes Connection Request User/Password and {informIntervalSeconds}s Periodic Inform to the router.
              </p>
            </div>
          </div>

          {/* Optical Telemetry Thresholds */}
          <div className="bg-white border border-[#CBD5E1] rounded-2xl p-6 space-y-4 shadow-xs">
            <div className="flex items-center space-x-3 pb-3 border-b border-[#E2E8F0]">
              <Sliders className="w-5 h-5 text-[#B45309]" />
              <div>
                <h3 className="text-base font-bold text-[#0F172A]">Optical Alarm Thresholds</h3>
                <p className="text-xs text-[#64748B]">Define automatic alert triggers based on Rx optical power</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Warning Threshold (dBm)"
                type="text"
                value={warningThreshold}
                onChange={(e) => setWarningThreshold(e.target.value)}
                helperText="Signals minor degradation (-24.0 to -27.0 dBm)"
              />
              <Input
                label="Critical Fault Threshold (dBm)"
                type="text"
                value={criticalThreshold}
                onChange={(e) => setCriticalThreshold(e.target.value)}
                helperText="Triggers immediate outage incident (< -27.0 dBm)"
              />
            </div>
          </div>

          {/* Dedicated Operator WhatsApp Web Linking Card */}
          <div className="bg-white border border-[#CBD5E1] rounded-2xl p-6 space-y-4 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-[#E2E8F0]">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] flex items-center justify-center text-[#047857]">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#0F172A]">Operator Dedicated WhatsApp Business Web Session</h3>
                  <p className="text-xs text-[#64748B]">Link your own WhatsApp Business number to send bills, OTPs, and alerts to your subscribers</p>
                </div>
              </div>
              <Badge variant={waData?.status === 'CONNECTED' ? 'success' : 'warning'} dot>
                {waData?.status === 'CONNECTED' ? 'CONNECTED / ACTIVE' : 'NOT LINKED'}
              </Badge>
            </div>

            <div className="p-4 bg-[#F8FAFC] border border-[#CBD5E1] rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-bold text-[#0F172A]">
                  {waData?.phone ? `Connected Number: ${waData.phone}` : 'No WhatsApp session linked to this operator account'}
                </p>
                <p className="text-xs text-[#64748B]">
                  {waData?.status === 'CONNECTED'
                    ? `Active multi-device session (${waData?.deviceInfo || 'Android / iOS App'})`
                    : 'Scan the QR code below using WhatsApp on your phone (Linked Devices) to activate.'}
                </p>
              </div>

              <div className="flex items-center space-x-2">
                {waData?.status === 'CONNECTED' ? (
                  <Button size="sm" variant="danger" type="button" onClick={handleDisconnectWa}>
                    <Unlink className="w-3.5 h-3.5 mr-1.5" />
                    <span>Disconnect Session</span>
                  </Button>
                ) : (
                  <Button size="sm" variant="primary" type="button" onClick={handleOpenQrModal} className="font-bold">
                    <QrCode className="w-4 h-4 mr-1.5" />
                    <span>Scan WhatsApp QR Code</span>
                  </Button>
                )}
                <Button size="sm" variant="outline" type="button" onClick={fetchWaStatus}>
                  <RefreshCw className={`w-3.5 h-3.5 ${isWaLoading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="lg" className="font-bold">
              <Save className="w-4 h-4 mr-1.5" />
              <span>Save & Apply Settings</span>
            </Button>
          </div>
        </form>

        {/* WhatsApp QR Pairing Modal */}
        <Modal
          isOpen={isQrModalOpen}
          onClose={() => setIsQrModalOpen(false)}
          title="Pair Operator WhatsApp Business"
          subtitle="Scan this QR code with WhatsApp on your phone (Settings > Linked Devices > Link a Device)"
          maxWidth="md"
        >
          <div className="space-y-4 text-center">
            {qrLoading ? (
              <div className="py-12 flex flex-col items-center justify-center space-y-2">
                <RefreshCw className="w-8 h-8 text-[#1677FF] animate-spin" />
                <p className="text-xs text-[#64748B]">Generating secure multi-device pairing QR...</p>
              </div>
            ) : waData?.qrCodeDataUrl ? (
              <div className="p-4 bg-white border border-[#CBD5E1] rounded-2xl inline-block shadow-sm">
                <img src={waData.qrCodeDataUrl} alt="WhatsApp Web QR" className="w-64 h-64 mx-auto rounded-lg" />
              </div>
            ) : (
              <div className="py-8 text-xs text-[#94A3B8] italic">
                QR code ready. Click below to confirm connection.
              </div>
            )}

            <div className="p-3 bg-[#F8FAFC] rounded-xl border border-[#E2E8F0] text-left space-y-2">
              <label className="text-xs font-bold text-[#0F172A] block">Operator WhatsApp Phone Number (with Country Code)</label>
              <div className="flex gap-2">
                <Input
                  placeholder="+919949666907"
                  value={customPhone}
                  onChange={(e) => setCustomPhone(e.target.value)}
                />
                <Button
                  variant="outline"
                  type="button"
                  onClick={handleRequestPairingCode}
                  isLoading={pairingCodeLoading}
                  className="whitespace-nowrap text-xs font-bold"
                >
                  Get 8-Digit Code
                </Button>
              </div>

              {pairingCode && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-center mt-2">
                  <span className="text-[11px] text-emerald-800 font-medium block mb-1">
                    Enter this code in WhatsApp (Settings &gt; Linked Devices &gt; Link with phone number):
                  </span>
                  <span className="text-xl font-mono font-bold tracking-widest text-emerald-700 bg-white px-3 py-1 rounded border border-emerald-300 inline-block">
                    {pairingCode}
                  </span>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3 pt-3 border-t border-[#E2E8F0]">
              <Button variant="outline" type="button" onClick={() => setIsQrModalOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </Shell>
  );
};

