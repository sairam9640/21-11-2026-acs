import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Search, Plus, Eye, Radio, Signal, CheckCircle2, AlertTriangle, Edit, Trash2 } from 'lucide-react';
import { Shell } from '../../components/layout/Shell.js';
import { StateWrapper } from '../../components/ui/StateWrapper.js';
import { DataTable, Column } from '../../components/ui/DataTable.js';
import { Badge } from '../../components/ui/Badge.js';
import { Button, Input } from '../../components/ui/Button.js';
import { Modal } from '../../components/ui/Modal.js';
import { api } from '../../services/api.js';

export const CustomerList: React.FC = () => {
  const [customers, setCustomers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Edit / Delete State
  const [editingCustomer, setEditingCustomer] = useState<any | null>(null);
  const [editFormData, setEditFormData] = useState({
    fullName: '',
    phone: '',
    email: '',
    street: '',
    city: '',
    area: '',
    status: 'active',
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deletingCustomer, setDeletingCustomer] = useState<any | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const navigate = useNavigate();

  const fetchCustomers = async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    const res = await api.getCustomers({ search, status: statusFilter });
    if (!silent) setIsLoading(false);
    if (res.success) {
      setCustomers(res.customers || []);
    } else {
      if (!silent) setError(res.error || 'Failed to fetch customers');
    }
  };

  useEffect(() => {
    fetchCustomers(customers.length > 0);
    const interval = setInterval(() => {
      fetchCustomers(true);
    }, 10000);
    return () => clearInterval(interval);
  }, [statusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchCustomers();
  };

  const handleOpenEdit = (c: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingCustomer(c);
    setEditFormData({
      fullName: c.fullName || '',
      phone: c.phone || '',
      email: c.email || '',
      street: c.address?.street || '',
      city: c.address?.city || '',
      area: c.address?.area || '',
      status: c.status || 'active',
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCustomer) return;
    setIsSavingEdit(true);
    try {
      const res = await api.updateCustomer(editingCustomer._id, {
        fullName: editFormData.fullName,
        phone: editFormData.phone,
        email: editFormData.email,
        address: {
          street: editFormData.street,
          city: editFormData.city,
          area: editFormData.area,
        },
        status: editFormData.status,
      });
      if (res.success) {
        setEditingCustomer(null);
        await fetchCustomers(true);
      } else {
        alert(res.error || 'Failed to update customer');
      }
    } catch (err: any) {
      alert(err.message || 'Error saving changes');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingCustomer) return;
    setIsDeleting(true);
    try {
      const res = await api.deleteCustomer(deletingCustomer._id);
      if (res.success) {
        setDeletingCustomer(null);
        await fetchCustomers(true);
      } else {
        alert(res.error || 'Failed to delete customer');
      }
    } catch (err: any) {
      alert(err.message || 'Error deleting customer');
    } finally {
      setIsDeleting(false);
    }
  };

  const columns: Column<any>[] = [
    {
      header: 'Subscriber / Account',
      accessor: (c) => (
        <div>
          <p className="font-semibold text-[#0F172A]">{c.fullName}</p>
          <div className="flex items-center space-x-2 text-xs text-[#64748B]">
            <span className="font-mono text-[#1677FF]">{c.accountNumber}</span>
            <span>•</span>
            <span>{c.phone}</span>
          </div>
        </div>
      ),
    },
    {
      header: 'Service Plan',
      accessor: (c) => (
        <div>
          <p className="text-xs font-semibold text-[#1E293B]">{c.servicePlan?.name || 'Broadband'}</p>
          <p className="text-[11px] text-[#64748B]">
            {c.servicePlan?.downloadSpeedMbps} Mbps | ₹{c.servicePlan?.monthlyFee}/mo
          </p>
        </div>
      ),
    },
    {
      header: 'Assigned ONT Device',
      accessor: (c) => {
        const dev = c.assignedDeviceId;
        if (!dev) return <span className="text-xs text-[#94A3B8] italic">No Device Assigned</span>;
        return (
          <div className="flex items-center space-x-2">
            <Radio className={`w-3.5 h-3.5 ${dev.status === 'online' ? 'text-[#047857]' : 'text-[#94A3B8]'}`} />
            <div>
              <p className="text-xs font-mono text-[#1E293B]">{dev.serialNumber}</p>
              <p className="text-[10px] text-[#64748B]">{dev.manufacturer} {dev.modelName}</p>
            </div>
          </div>
        );
      },
    },
    {
      header: 'Optical RX Signal',
      accessor: (c) => {
        const dev = c.assignedDeviceId;
        if (!dev || !dev.currentRxPowerDbm) return <span className="text-xs text-[#94A3B8]">-</span>;
        const pwr = dev.currentRxPowerDbm;
        let variant: 'success' | 'warning' | 'danger' = 'success';
        if (pwr < -27) variant = 'danger';
        else if (pwr < -24) variant = 'warning';

        return (
          <Badge variant={variant} dot>
            {pwr} dBm
          </Badge>
        );
      },
    },
    {
      header: 'Status',
      accessor: (c) => (
        <Badge variant={c.status === 'active' ? 'success' : 'warning'} dot>
          {c.status}
        </Badge>
      ),
    },
    {
      header: 'Actions',
      accessor: (c) => (
        <div className="flex items-center space-x-1.5" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/operator/customers/${c._id}`);
            }}
            title="Open Customer 360 Cockpit"
          >
            <Eye className="w-3.5 h-3.5 mr-1 text-sky-600" />
            <span>360</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={(e) => handleOpenEdit(c, e)}
            className="text-slate-600 hover:text-blue-600 hover:border-blue-300"
            title="Edit Subscriber Profile"
          >
            <Edit className="w-3.5 h-3.5" />
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              setDeletingCustomer(c);
            }}
            className="text-rose-600 hover:bg-rose-50 hover:border-rose-300"
            title="Delete Subscriber"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Shell
      portalType="operator"
      title="Subscriber Directory & Customer 360"
      breadcrumbs={[{ label: 'Customers' }]}
      primaryAction={
        <Button onClick={() => navigate('/operator/customers/new')} variant="primary" size="sm" className="bg-[#1877F2] hover:bg-blue-700 text-white font-bold">
          <Plus className="w-4 h-4 mr-1.5" />
          <span>Provision New Customer</span>
        </Button>
      }
    >
      <div className="space-y-4">
        {/* Top 4 NOC Operations Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1E56A0] via-[#16407B] to-[#11315E] text-white p-5 shadow-md">
            <div className="relative z-10 space-y-1">
              <h4 className="text-3xl font-extrabold tracking-tight font-sans">
                {customers.length.toLocaleString()}
              </h4>
              <p className="text-xs uppercase tracking-wider font-bold text-blue-200">TOTAL SUBSCRIBERS</p>
              <p className="text-[11px] text-blue-300 font-medium">Provisioned billing accounts</p>
            </div>
            <Users className="absolute right-3 top-3 w-20 h-20 text-white/10 -mr-2 -mt-2 pointer-events-none" />
          </div>

          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#059669] via-[#047857] to-[#065F46] text-white p-5 shadow-md">
            <div className="relative z-10 space-y-1">
              <h4 className="text-3xl font-extrabold tracking-tight font-sans">
                {customers.filter((c) => c.status === 'active').length.toLocaleString()}
              </h4>
              <p className="text-xs uppercase tracking-wider font-bold text-emerald-200">ACTIVE SUBSCRIBERS</p>
              <p className="text-[11px] text-emerald-300 font-medium">
                {customers.length > 0
                  ? `${Math.round((customers.filter((c) => c.status === 'active').length / customers.length) * 100)}% operational`
                  : '0% operational'}
              </p>
            </div>
            <CheckCircle2 className="absolute right-3 top-3 w-20 h-20 text-white/10 -mr-2 -mt-2 pointer-events-none" />
          </div>

          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0284C7] via-[#0369A1] to-[#075985] text-white p-5 shadow-md">
            <div className="relative z-10 space-y-1">
              <h4 className="text-3xl font-extrabold tracking-tight font-sans">
                {customers.filter((c) => c.status === 'pending_install').length.toLocaleString()}
              </h4>
              <p className="text-xs uppercase tracking-wider font-bold text-sky-200">PENDING INSTALL</p>
              <p className="text-[11px] text-sky-300 font-medium">Technician dispatch queue</p>
            </div>
            <Signal className="absolute right-3 top-3 w-20 h-20 text-white/10 -mr-2 -mt-2 pointer-events-none" />
          </div>

          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#D97706] via-[#B45309] to-[#92400E] text-white p-5 shadow-md">
            <div className="relative z-10 space-y-1">
              <h4 className="text-3xl font-extrabold tracking-tight font-sans">
                {customers.filter((c) => c.status === 'suspended').length.toLocaleString()}
              </h4>
              <p className="text-xs uppercase tracking-wider font-bold text-amber-200">SUSPENDED / PAST DUE</p>
              <p className="text-[11px] text-amber-300 font-medium">Billing review required</p>
            </div>
            <AlertTriangle className="absolute right-3 top-3 w-20 h-20 text-white/10 -mr-2 -mt-2 pointer-events-none" />
          </div>
        </div>

        {/* Search & Status Toolbar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 border border-[#E2E8F0] rounded-xl">
          <form onSubmit={handleSearchSubmit} className="w-full sm:w-80">
            <Input
              placeholder="Search by name, phone, account #..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              icon={Search}
            />
          </form>

          <div className="flex items-center space-x-2 w-full sm:w-auto">
            <span className="text-xs text-[#64748B]">Filter:</span>
            {['all', 'active', 'pending_install', 'suspended'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition ${
                  statusFilter === st
                    ? 'bg-sky-600 text-white'
                    : 'bg-[#F1F5F9] text-[#64748B] hover:text-[#1E293B]'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {/* Table View */}
        <StateWrapper
          isLoading={isLoading && customers.length === 0}
          hasData={customers.length > 0}
          isEmpty={customers.length === 0}
          emptyTitle="No Subscribers Found"
          emptyMessage="No customers match the current filter. Click Provision to onboard a new subscriber."
          emptyActionLabel="Provision Customer"
          onEmptyAction={() => navigate('/operator/customers/new')}
          error={error}
          onRetry={() => fetchCustomers(false)}
        >
          <DataTable
            columns={columns}
            data={customers}
            keyExtractor={(c) => c._id}
            isLoading={isLoading}
            onRowClick={(c) => navigate(`/operator/customers/${c._id}`)}
          />
        </StateWrapper>

        {/* MODAL: EDIT CUSTOMER */}
        <Modal
          isOpen={Boolean(editingCustomer)}
          onClose={() => setEditingCustomer(null)}
          title={`Edit Subscriber: ${editingCustomer?.accountNumber || ''}`}
          subtitle="Modify subscriber contact details, address, or service status."
          maxWidth="lg"
        >
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Full Name</label>
                <Input
                  value={editFormData.fullName}
                  onChange={(e) => setEditFormData({ ...editFormData, fullName: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Mobile Phone</label>
                <Input
                  value={editFormData.phone}
                  onChange={(e) => setEditFormData({ ...editFormData, phone: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Email Address</label>
                <Input
                  type="email"
                  value={editFormData.email}
                  onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Account Status</label>
                <select
                  value={editFormData.status}
                  onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-medium focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
                >
                  <option value="active">Active</option>
                  <option value="pending_install">Pending Install</option>
                  <option value="suspended">Suspended</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Street Address</label>
                <Input
                  value={editFormData.street}
                  onChange={(e) => setEditFormData({ ...editFormData, street: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Area / Neighborhood</label>
                <Input
                  value={editFormData.area}
                  onChange={(e) => setEditFormData({ ...editFormData, area: e.target.value })}
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-slate-700 mb-1">City / Region</label>
                <Input
                  value={editFormData.city}
                  onChange={(e) => setEditFormData({ ...editFormData, city: e.target.value })}
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setEditingCustomer(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={isSavingEdit} className="bg-blue-600 hover:bg-blue-700 text-white font-bold">
                {isSavingEdit ? 'Saving Changes...' : 'Save Profile Changes'}
              </Button>
            </div>
          </form>
        </Modal>

        {/* MODAL: DELETE CONFIRMATION */}
        <Modal
          isOpen={Boolean(deletingCustomer)}
          onClose={() => setDeletingCustomer(null)}
          title="Delete Subscriber Account"
          subtitle="Carefully confirm deletion of subscriber record."
          maxWidth="md"
        >
          <div className="space-y-4">
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex items-start space-x-2">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Permanent Deletion Warning</p>
                <p className="mt-0.5">
                  Are you sure you want to delete subscriber <strong>{deletingCustomer?.fullName}</strong> ({deletingCustomer?.accountNumber})?
                  Any ONT currently bound to this subscriber will be automatically unlinked and returned to available inventory.
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => setDeletingCustomer(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="bg-rose-600 hover:bg-rose-700 text-white font-bold"
              >
                {isDeleting ? 'Deleting Subscriber...' : 'Yes, Delete Subscriber'}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </Shell>
  );
};
