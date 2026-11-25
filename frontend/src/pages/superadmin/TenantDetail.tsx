import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Building2, Shield, Users, Radio, Wrench, AlertTriangle, CheckCircle2, ArrowLeft, ExternalLink, Power, Sparkles, Sliders, Check } from 'lucide-react';
import { Shell } from '../../components/layout/Shell.js';
import { StateWrapper } from '../../components/ui/StateWrapper.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button } from '../../components/ui/Button.js';
import { Modal } from '../../components/ui/Modal.js';
import { api } from '../../services/api.js';
import { useAuth } from '../../context/AuthContext.js';

export const TenantDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [planSuccessMsg, setPlanSuccessMsg] = useState<string | null>(null);
  const [planForm, setPlanForm] = useState({
    planName: 'Growth Plan',
    maxCustomers: 5000,
    maxDevices: 5000,
    maxTechnicians: 10,
    monthlyFee: 4999,
    billingCycle: 'monthly' as 'monthly' | 'quarterly' | 'annually',
  });

  const navigate = useNavigate();
  const { impersonateTenant } = useAuth();

  const fetchDetail = async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    const res = await api.getTenantDetail(id);
    setIsLoading(false);
    if (res.success) {
      setData(res);
      if (res.tenant?.plan) {
        setPlanForm({
          planName: res.tenant.plan.name || 'Growth Plan',
          maxCustomers: res.tenant.plan.maxCustomers || 5000,
          maxDevices: res.tenant.plan.maxDevices || 5000,
          maxTechnicians: res.tenant.plan.maxTechnicians || 10,
          monthlyFee: res.tenant.plan.monthlyFee || 4999,
          billingCycle: res.tenant.plan.billingCycle || 'monthly',
        });
      }
    } else {
      setError(res.error || 'Failed to fetch tenant detail');
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const toggleStatus = async () => {
    if (!id || !data?.tenant) return;
    const nextStatus = data.tenant.status === 'active' ? 'suspended' : 'active';
    const res = await api.updateTenantStatus(id, nextStatus);
    if (res.success) {
      fetchDetail();
    } else {
      alert(res.error || 'Failed to update status');
    }
  };

  const handleApplyPreset = (name: string, devices: number, fee: number) => {
    setPlanForm({
      ...planForm,
      planName: name,
      maxCustomers: devices,
      maxDevices: devices,
      monthlyFee: fee,
    });
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setIsSavingPlan(true);
    setPlanSuccessMsg(null);
    try {
      const res: any = await api.updateTenantPlan(id, planForm);
      setIsSavingPlan(false);
      if (res.success) {
        setPlanSuccessMsg(res.message || 'Operator subscription plan updated successfully!');
        setTimeout(() => {
          setIsPlanModalOpen(false);
          setPlanSuccessMsg(null);
        }, 1500);
        fetchDetail();
      } else {
        alert(res.error || 'Failed to update plan');
      }
    } catch (err: any) {
      setIsSavingPlan(false);
      alert(err.message || 'Error updating plan');
    }
  };

  const tenant = data?.tenant;
  const usage = data?.usage || {};

  return (
    <Shell
      portalType="superadmin"
      title={tenant ? `${tenant.displayName} Control Profile` : 'Tenant Detail'}
      breadcrumbs={[{ label: 'Tenants', href: '/superadmin/tenants' }, { label: tenant?.displayName || 'Detail' }]}
      primaryAction={
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsPlanModalOpen(true)}
            className="border-purple-300 text-purple-700 hover:bg-purple-50 font-bold"
          >
            <Sparkles className="w-3.5 h-3.5 mr-1 text-purple-600" />
            <span>Upgrade / Downgrade Plan</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (tenant) {
                impersonateTenant(tenant);
                navigate('/operator/dashboard');
              }
            }}
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1" />
            <span>Impersonate NOC</span>
          </Button>
          <Button
            variant={tenant?.status === 'active' ? 'danger' : 'success'}
            size="sm"
            onClick={toggleStatus}
          >
            <Power className="w-3.5 h-3.5 mr-1" />
            <span>{tenant?.status === 'active' ? 'Suspend Tenant' : 'Activate Tenant'}</span>
          </Button>
        </div>
      }
    >
      <StateWrapper isLoading={isLoading} error={error} onRetry={fetchDetail}>
        {tenant && (
          <div className="space-y-6">
            {/* Header Card */}
            <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="flex items-center space-x-4">
                <div className="w-14 h-14 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] flex items-center justify-center font-bold text-[#1677FF] text-xl">
                  {tenant.displayName?.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h2 className="text-lg font-bold text-[#0F172A]">{tenant.displayName}</h2>
                    <Badge variant={tenant.status === 'active' ? 'success' : 'warning'} dot>
                      {tenant.status}
                    </Badge>
                  </div>
                  <p className="text-xs font-mono text-[#64748B] mt-1">https://{tenant.subdomain}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <span className="text-[#94A3B8] block">Plan Tier</span>
                  <div className="flex items-center space-x-1.5 mt-0.5">
                    <p className="font-bold text-[#1E293B]">{tenant.plan?.name || 'Enterprise'}</p>
                    <button
                      onClick={() => setIsPlanModalOpen(true)}
                      className="text-[10px] text-purple-600 hover:text-purple-800 font-bold underline cursor-pointer"
                    >
                      Change
                    </button>
                  </div>
                </div>
                <div>
                  <span className="text-[#94A3B8]">Monthly Billing</span>
                  <p className="font-semibold text-[#1E293B]">₹{(tenant.plan?.monthlyFee || 4999).toLocaleString()}</p>
                </div>
                <div>
                  <span className="text-[#94A3B8]">Owner Contact</span>
                  <p className="font-semibold text-[#1E293B]">{tenant.owner?.email}</p>
                </div>
              </div>
            </div>

            {/* Plan Usage Bars */}
            <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 space-y-4">
              <h3 className="text-sm font-bold text-[#0F172A]">Subscription Quotas & Fleet Capacity</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Customers Bar */}
                <div className="p-4 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-[#64748B]">Subscribers</span>
                    <span className="font-semibold text-[#1E293B]">
                      {usage.customers?.current || 0} / {usage.customers?.limit || 5000}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-[#F1F5F9] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-sky-500 rounded-full transition-all"
                      style={{
                        width: `${Math.min(
                          100,
                          ((usage.customers?.current || 0) / (usage.customers?.limit || 5000)) * 100
                        )}%`,
                      }}
                    ></div>
                  </div>
                </div>

                {/* Devices Bar */}
                <div className="p-4 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-[#64748B]">ONT Devices</span>
                    <span className="font-semibold text-[#1E293B]">
                      {usage.devices?.current || 0} / {usage.devices?.limit || 5000}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-[#F1F5F9] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all"
                      style={{
                        width: `${Math.min(
                          100,
                          ((usage.devices?.current || 0) / (usage.devices?.limit || 5000)) * 100
                        )}%`,
                      }}
                    ></div>
                  </div>
                </div>

                {/* Technicians Bar */}
                <div className="p-4 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-[#64748B]">Field Technicians</span>
                    <span className="font-semibold text-[#1E293B]">
                      {usage.technicians?.current || 0} / {usage.technicians?.limit || 20}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-[#F1F5F9] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-purple-500 rounded-full transition-all"
                      style={{
                        width: `${Math.min(
                          100,
                          ((usage.technicians?.current || 0) / (usage.technicians?.limit || 20)) * 100
                        )}%`,
                      }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>

            {/* CWMP ACS Provisioning Config */}
            <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-[#0F172A] flex items-center space-x-2">
                    <Radio className="w-4 h-4 text-[#047857]" />
                    <span>TR-069 CWMP & ACS Gateway Endpoint</span>
                  </h3>
                  <p className="text-xs text-[#64748B] mt-0.5">Configure this direct URL on customer ONT / CPE hardware for cloud management</p>
                </div>
                <Badge variant="success" dot>Live Gateway</Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                <div className="p-3.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl">
                  <span className="text-[#94A3B8] block text-[11px] mb-1 font-sans font-bold">Unified TR-069 CWMP ACS URL (ONT Config)</span>
                  <span className="text-[#047857] font-bold select-all text-sm">{data?.cwmpPathUrl || `http://${window.location.hostname || 'yourdomain.com'}:7547/tr069/${tenant.slug || 'operator'}`}</span>
                </div>
                <div className="p-3.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl">
                  <span className="text-[#94A3B8] block text-[11px] mb-1 font-sans font-bold">ACS Username / ACS Password (Slug)</span>
                  <span className="text-[#1677FF] font-bold select-all text-sm">{data?.acsCredentials?.acsUsername || tenant.slug} / {data?.acsCredentials?.acsPassword || tenant.slug}</span>
                </div>
                <div className="p-3.5 bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl">
                  <span className="text-[#047857] block text-[11px] mb-1 font-sans font-bold">Auto-Pushed CPE Conn Request Credentials</span>
                  <span className="text-[#065F46] font-bold select-all text-sm">
                    {data?.acsCredentials?.connectionRequestUsername || `cpe_${tenant.slug}`} / {data?.acsCredentials?.connectionRequestPassword || `${tenant.slug}_cpe`} (300s Inform)
                  </span>
                </div>
                <div className="p-3.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl">
                  <span className="text-[#94A3B8] block text-[11px] mb-1 font-sans font-bold">Operator Key (Auth Token)</span>
                  <span className="text-[#1677FF] font-bold select-all text-sm">{tenant.operatorKey}</span>
                </div>
              </div>
            </div>

            {/* Audit Trail for this Tenant */}
            <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 space-y-3">
              <h3 className="text-sm font-bold text-[#0F172A]">Recent Security & Governance Audits</h3>
              <div className="space-y-2 text-xs">
                {(data?.recentAuditLogs || []).map((log: any) => (
                  <div
                    key={log._id}
                    className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg flex items-center justify-between"
                  >
                    <div>
                      <span className="font-mono text-[#1677FF]">{log.action}</span>
                      <p className="text-[#64748B] mt-0.5">By {log.actorEmail}</p>
                    </div>
                    <div className="text-right">
                      <Badge variant={log.result === 'SUCCESS' ? 'success' : 'danger'}>{log.result}</Badge>
                      <p className="text-[10px] text-[#94A3B8] mt-0.5">
                        {new Date(log.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </StateWrapper>

      {/* Plan Upgrade / Downgrade Modal */}
      <Modal
        isOpen={isPlanModalOpen}
        onClose={() => setIsPlanModalOpen(false)}
        title={`Upgrade / Downgrade Plan — ${tenant?.displayName || 'Operator'}`}
      >
        <form onSubmit={handleSavePlan} className="space-y-4">
          {planSuccessMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-bold flex items-center space-x-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{planSuccessMsg}</span>
            </div>
          )}

          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1.5">Preset Platform Tiers</label>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                type="button"
                onClick={() => handleApplyPreset('Starter Tier', 1000, 1999)}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  planForm.planName === 'Starter Tier'
                    ? 'border-purple-600 bg-purple-50 text-purple-900 font-bold'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span>Starter</span>
                  <span className="font-mono font-bold">₹1,999/m</span>
                </div>
                <span className="text-[10px] text-slate-500 block">1,000 ONT Devices</span>
              </button>

              <button
                type="button"
                onClick={() => handleApplyPreset('Growth Tier', 5000, 4999)}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  planForm.planName === 'Growth Tier'
                    ? 'border-purple-600 bg-purple-50 text-purple-900 font-bold'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span>Growth</span>
                  <span className="font-mono font-bold">₹4,999/m</span>
                </div>
                <span className="text-[10px] text-slate-500 block">5,000 ONT Devices</span>
              </button>

              <button
                type="button"
                onClick={() => handleApplyPreset('Enterprise Pro', 25000, 14999)}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  planForm.planName === 'Enterprise Pro'
                    ? 'border-purple-600 bg-purple-50 text-purple-900 font-bold'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span>Enterprise</span>
                  <span className="font-mono font-bold">₹14,999/m</span>
                </div>
                <span className="text-[10px] text-slate-500 block">25,000 ONT Devices</span>
              </button>

              <button
                type="button"
                onClick={() => handleApplyPreset('Carrier Unlimited', 100000, 39999)}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  planForm.planName === 'Carrier Unlimited'
                    ? 'border-purple-600 bg-purple-50 text-purple-900 font-bold'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span>Carrier Pro</span>
                  <span className="font-mono font-bold">₹39,999/m</span>
                </div>
                <span className="text-[10px] text-slate-500 block">100,000 ONT Devices</span>
              </button>
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t border-slate-200">
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">Plan Tier Name</label>
              <input
                type="text"
                value={planForm.planName}
                onChange={(e) => setPlanForm({ ...planForm, planName: e.target.value })}
                className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Max Devices (ONTs)</label>
                <input
                  type="number"
                  value={planForm.maxDevices}
                  onChange={(e) => setPlanForm({ ...planForm, maxDevices: parseInt(e.target.value, 10) || 1000 })}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Max Subscribers</label>
                <input
                  type="number"
                  value={planForm.maxCustomers}
                  onChange={(e) => setPlanForm({ ...planForm, maxCustomers: parseInt(e.target.value, 10) || 1000 })}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Monthly Billing Fee (₹)</label>
                <input
                  type="number"
                  value={planForm.monthlyFee}
                  onChange={(e) => setPlanForm({ ...planForm, monthlyFee: parseInt(e.target.value, 10) || 0 })}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Billing Frequency</label>
                <select
                  value={planForm.billingCycle}
                  onChange={(e) => setPlanForm({ ...planForm, billingCycle: e.target.value as any })}
                  className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annually">Annually</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsPlanModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              isLoading={isSavingPlan}
              className="bg-purple-600 hover:bg-purple-500 text-white font-bold"
            >
              Save & Apply Plan Changes
            </Button>
          </div>
        </form>
      </Modal>
    </Shell>
  );
};
