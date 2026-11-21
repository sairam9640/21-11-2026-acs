import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { Tenant } from './models/Tenant.js';
import { User } from './models/User.js';
import { Customer } from './models/Customer.js';
import { Device } from './models/Device.js';
import { DeviceCapability } from './models/DeviceCapability.js';
import { OLT, PONPort, FiberNode, FiberSegment } from './models/FiberTopology.js';
import { Incident, Alert } from './models/Incident.js';
import { Ticket } from './models/Ticket.js';
import { TechnicianJob } from './models/TechnicianJob.js';
import { TenantPlan } from './models/TenantPlan.js';

dotenv.config();
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai_isp_os_db';

export async function seedDatabase() {
  console.log('--- Initializing Clean Production-Ready Foundation ---');
  await mongoose.connect(MONGODB_URI);

  // Clear dummy data collections
  await Promise.all([
    Tenant.deleteMany({}),
    User.deleteMany({}),
    Customer.deleteMany({}),
    Device.deleteMany({}),
    DeviceCapability.deleteMany({}),
    OLT.deleteMany({}),
    PONPort.deleteMany({}),
    FiberNode.deleteMany({}),
    FiberSegment.deleteMany({}),
    Incident.deleteMany({}),
    Alert.deleteMany({}),
    Ticket.deleteMany({}),
    TechnicianJob.deleteMany({}),
    TenantPlan.deleteMany({}),
  ]);

  // 1. Seed Enterprise SaaS Plans
  await TenantPlan.create([
    {
      name: 'Starter ISP Plan',
      code: 'starter',
      maxCustomers: 1000,
      maxDevices: 1000,
      maxTechnicians: 5,
      monthlyFee: 1999,
      annualFee: 19990,
      features: ['TR-069 ACS Engine', 'Customer CRM & Billing', 'Field Tech Workflows'],
    },
    {
      name: 'Growth ISP Plan',
      code: 'growth',
      maxCustomers: 5000,
      maxDevices: 5000,
      maxTechnicians: 20,
      monthlyFee: 4999,
      annualFee: 49990,
      features: ['TR-069 & TR-369', 'Fiber GIS Mapping', 'WhatsApp Live Dispatch', 'Technician App'],
    },
    {
      name: 'Enterprise Carrier Suite',
      code: 'enterprise',
      maxCustomers: 50000,
      maxDevices: 50000,
      maxTechnicians: 100,
      monthlyFee: 14999,
      annualFee: 149990,
      features: ['All Features', 'AI Command Center', 'Optical Telemetry Prediction', 'Dedicated CWMP Engine'],
    },
  ]);

  // 2. Seed Certified Hardware ONT / CPE Capability Profiles
  await DeviceCapability.create([
    {
      vendor: 'Huawei',
      modelPattern: 'HG8145V5',
      displayName: 'Huawei EchoLife HG8145V5 Dual-Band GPON ONT',
      hardwareType: 'GPON_ONT',
      supportsDualBandWifi: true,
      supportsSingleBandWifi: true,
      supportsWifiPasswordChange: true,
      supportsWifiChannelSelect: true,
      supportsWanProfileEdit: true,
      supportsWanVlanConfig: true,
      supportsConnectedClientList: true,
      supportsConnectedClientBlock: true,
      supportsRemoteReboot: true,
      supportsPingDiagnostics: true,
      supportsTracerouteDiagnostics: true,
      supportsSpeedTest: true,
      supportsOpticalTelemetry: true,
      supportsCpuMemoryTelemetry: true,
      supportsFirmwareUpgrade: true,
      tr069Supported: true,
      tr369Supported: false,
    },
    {
      vendor: 'ZTE',
      modelPattern: 'ZXHN F670L',
      displayName: 'ZTE ZXHN F670L AC1200 GPON ONT',
      hardwareType: 'GPON_ONT',
      supportsDualBandWifi: true,
      supportsSingleBandWifi: true,
      supportsWifiPasswordChange: true,
      supportsWifiChannelSelect: true,
      supportsWanProfileEdit: true,
      supportsWanVlanConfig: true,
      supportsConnectedClientList: true,
      supportsConnectedClientBlock: true,
      supportsRemoteReboot: true,
      supportsPingDiagnostics: true,
      supportsTracerouteDiagnostics: true,
      supportsSpeedTest: true,
      supportsOpticalTelemetry: true,
      supportsCpuMemoryTelemetry: true,
      supportsFirmwareUpgrade: true,
      tr069Supported: true,
      tr369Supported: true,
    },
    {
      vendor: 'Syrotech',
      modelPattern: 'SY-GPON-1110-WDONT',
      displayName: 'Syrotech Dual Band Gigabit GPON ONT',
      hardwareType: 'GPON_ONT',
      supportsDualBandWifi: true,
      supportsSingleBandWifi: true,
      supportsWifiPasswordChange: true,
      supportsWifiChannelSelect: true,
      supportsWanProfileEdit: true,
      supportsWanVlanConfig: true,
      supportsConnectedClientList: true,
      supportsConnectedClientBlock: true,
      supportsRemoteReboot: true,
      supportsPingDiagnostics: true,
      supportsTracerouteDiagnostics: true,
      supportsSpeedTest: true,
      supportsOpticalTelemetry: true,
      supportsCpuMemoryTelemetry: true,
      supportsFirmwareUpgrade: true,
      tr069Supported: true,
      tr369Supported: false,
    },
    {
      vendor: 'Nokia',
      modelPattern: 'G-140W-F',
      displayName: 'Nokia G-140W-F GPON Wireless Gateway',
      hardwareType: 'GPON_ONT',
      supportsDualBandWifi: true,
      supportsSingleBandWifi: true,
      supportsWifiPasswordChange: true,
      supportsWifiChannelSelect: true,
      supportsWanProfileEdit: true,
      supportsWanVlanConfig: true,
      supportsConnectedClientList: true,
      supportsConnectedClientBlock: true,
      supportsRemoteReboot: true,
      supportsPingDiagnostics: true,
      supportsTracerouteDiagnostics: true,
      supportsSpeedTest: true,
      supportsOpticalTelemetry: true,
      supportsCpuMemoryTelemetry: true,
      supportsFirmwareUpgrade: true,
      tr069Supported: true,
      tr369Supported: true,
    },
  ]);

  // 3. Optional Pre-registered Super Administrator from .env
  if (process.env.SUPERADMIN_EMAIL && process.env.SUPERADMIN_PASSWORD) {
    const defaultPasswordHash = bcrypt.hashSync(process.env.SUPERADMIN_PASSWORD, 10);
    const superAdminEmail = process.env.SUPERADMIN_EMAIL.trim().toLowerCase();
    const superAdminPhone = process.env.SUPERADMIN_PHONE || '';

    await User.create({
      email: superAdminEmail,
      phone: superAdminPhone,
      fullName: process.env.SUPERADMIN_NAME || 'Super Administrator',
      role: 'super_admin',
      passwordHash: defaultPasswordHash,
      permissions: ['SUPERADMIN_ALL'],
      status: 'active',
    });
    console.log(`✓ Super Admin initialized from .env: ${superAdminEmail}`);
  } else {
    console.log('ℹ No hardcoded Super Admin seeded. First administrator will initialize via /superadmin/login UI setup.');
  }

  console.log('✓ Clean production database foundation initialized successfully (Zero dummy operators)!');
}

// Auto-run if invoked directly
if (process.argv[1]?.includes('seed')) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed execution error:', err);
      process.exit(1);
    });
}
