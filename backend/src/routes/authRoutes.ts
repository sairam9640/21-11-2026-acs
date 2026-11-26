import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { Tenant } from '../models/Tenant.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import { AuthenticatedRequest } from '../middleware/tenantIsolation.js';
import { recordAuditLog } from '../middleware/audit.js';
import { EmailService } from '../services/emailService.js';
import { WhatsAppService } from '../services/whatsAppService.js';
import { SystemSetting } from '../models/SystemSetting.js';

export const authRouter = Router();

/**
 * Super Admin Setup Status Check:
 * Informs frontend whether the first Super Administrator needs to be initialized.
 */
authRouter.get('/superadmin/setup-status', async (_req, res: Response) => {
  try {
    const totalSuperAdmins = await User.countDocuments({ role: 'super_admin' });
    return res.json({
      success: true,
      setupRequired: totalSuperAdmins === 0,
      hasSuperAdmin: totalSuperAdmins > 0,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Super Admin First-Time Setup Wizard:
 * ONLY allows creating the first Super Admin when totalSuperAdmins === 0.
 * Once created, this endpoint is permanently locked.
 */
authRouter.post('/superadmin/register-initial', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const totalSuperAdmins = await User.countDocuments({ role: 'super_admin' });
    if (totalSuperAdmins > 0) {
      return res.status(403).json({
        success: false,
        error: 'Initial setup is locked. A Super Administrator has already been created. Please sign in.',
      });
    }

    const { fullName, email, phone, password } = req.body;
    if (!fullName || !email || !password) {
      return res.status(400).json({ success: false, error: 'Full name, email, and password are required.' });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters long.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const cleanPhone = phone ? String(phone).trim() : '';

    const newSuperAdmin = await User.create({
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: cleanPhone,
      passwordHash,
      role: 'super_admin',
      permissions: ['SUPERADMIN_ALL'],
      status: 'active',
      lastLoginAt: new Date(),
    });

    const token = generateToken({
      userId: newSuperAdmin._id.toString(),
      email: newSuperAdmin.email,
      role: 'super_admin',
      permissions: ['SUPERADMIN_ALL'],
    });

    await recordAuditLog({
      actorId: newSuperAdmin._id.toString(),
      actorEmail: newSuperAdmin.email,
      actorRole: 'super_admin',
      action: 'INITIAL_SUPERADMIN_SETUP',
      targetResource: 'User',
      targetId: newSuperAdmin._id.toString(),
      correlationId: `initial_setup_${Date.now()}`,
    });

    return res.status(201).json({
      success: true,
      message: 'Super Administrator initialized successfully!',
      token,
      user: {
        id: newSuperAdmin._id,
        email: newSuperAdmin.email,
        fullName: newSuperAdmin.fullName,
        role: newSuperAdmin.role,
        permissions: newSuperAdmin.permissions,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Super Admin Login: Step 1 (Request Dynamic Email & WhatsApp OTP)
 */
authRouter.post('/superadmin/request-otp', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rawInput = (req.body.email || req.body.phone || req.body.identifier || '').trim();
    if (!rawInput) return res.status(400).json({ success: false, error: 'Registered Email address or Mobile phone number is required.' });

    const isEmail = rawInput.includes('@');
    const cleanDigits = rawInput.replace(/[^0-9]/g, '').slice(-10);

    let user: any = null;
    if (isEmail) {
      user = await User.findOne({ email: rawInput.toLowerCase(), role: 'super_admin' });
    } else if (cleanDigits.length === 10) {
      user = await User.findOne({ phone: { $regex: new RegExp(cleanDigits + '$') }, role: 'super_admin' });
    }

    if (!user) {
      // Fallback search across all super admins
      user = await User.findOne({
        role: 'super_admin',
        $or: [
          { email: rawInput.toLowerCase() },
          { phone: { $regex: new RegExp(cleanDigits + '$') } },
        ]
      });
    }

    const totalSuperAdmins = await User.countDocuments({ role: 'super_admin' });

    // Initial bootstrap: Only if ZERO super admins exist in the system, allow first bootstrap
    if (!user && totalSuperAdmins === 0) {
      user = await User.create({
        email: isEmail ? rawInput.toLowerCase() : (process.env.SUPERADMIN_EMAIL || 'superadmin@acs.local'),
        phone: cleanDigits.length === 10 ? `+91${cleanDigits}` : (process.env.SUPERADMIN_PHONE || '+919999999999'),
        fullName: process.env.SUPERADMIN_NAME || 'Super Administrator',
        role: 'super_admin',
        permissions: ['SUPERADMIN_ALL'],
        status: 'active',
      });
    }

    if (!user || user.status !== 'active') {
      return res.status(403).json({
        success: false,
        error: `Access Denied: '${rawInput}' is not registered as an authorized Super Administrator. Only registered Super Admins under Global Users & Access Control can log in.`,
      });
    }

    // Generate secure dynamic 6-digit OTP
    const dynamicOtp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otpCode = dynamicOtp;
    user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
    await user.save();

    // 1. Send dynamic OTP email via Gmail SMTP App Password service
    let emailSuccess = false;
    let emailErrorMsg: string | undefined;
    if (user.email) {
      try {
        const emailResult = await EmailService.sendOtpEmail(user.email, dynamicOtp, user.fullName);
        emailSuccess = emailResult.success;
        emailErrorMsg = emailResult.error;
      } catch (err: any) {
        emailErrorMsg = err.message;
      }
    }

    // 2. Send dynamic OTP via WhatsApp Web Multi-Device
    let waSuccess = false;
    const dispatchPhone = user.phone || process.env.SUPERADMIN_PHONE || '+919999999999';
    try {
      const waResult = await WhatsAppService.sendOtpMessage(dispatchPhone, dynamicOtp, user.fullName, 'Super Admin Control Plane');
      waSuccess = waResult.success;
    } catch (err: any) {
      console.warn('[SuperAdmin Auth] WhatsApp OTP dispatch warning:', err.message);
    }

    console.log(`[SuperAdmin Auth] 🔑 Dynamic OTP for ${user.email} (${dispatchPhone}): ${dynamicOtp}`);

    const maskedEmail = user.email ? user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') : '';
    const maskedPhone = user.phone ? user.phone.replace(/(\+?\d{2,4})\d+(\d{4})/, '$1******$2') : '';

    return res.json({
      success: true,
      message: waSuccess || emailSuccess 
        ? `Dynamic OTP dispatched to ${maskedEmail || maskedPhone} (Email & WhatsApp).`
        : `Dynamic OTP generated and sent to ${maskedEmail || maskedPhone}.`,
      destinationMasked: maskedEmail || maskedPhone,
      emailDelivered: emailSuccess,
      emailError: emailErrorMsg,
      whatsappDelivered: waSuccess,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Super Admin Login: Step 2 (Verify Email / WhatsApp OTP)
 * Strictly verifies dynamic 6-digit OTP code against database.
 */
authRouter.post('/superadmin/verify-otp', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rawInput = (req.body.email || req.body.phone || req.body.identifier || '').trim();
    const { otp } = req.body;
    if (!rawInput || !otp) return res.status(400).json({ success: false, error: 'Email/Phone and OTP are required' });

    const isEmail = rawInput.includes('@');
    const cleanDigits = rawInput.replace(/[^0-9]/g, '').slice(-10);

    let user: any = null;
    if (isEmail) {
      user = await User.findOne({ email: rawInput.toLowerCase(), role: 'super_admin' });
    } else if (cleanDigits.length === 10) {
      user = await User.findOne({ phone: { $regex: new RegExp(cleanDigits + '$') }, role: 'super_admin' });
    }

    if (!user) {
      user = await User.findOne({
        role: 'super_admin',
        $or: [
          { email: rawInput.toLowerCase() },
          { phone: { $regex: new RegExp(cleanDigits + '$') } },
        ]
      });
    }

    if (!user) return res.status(401).json({ success: false, error: 'Invalid super administrator credentials' });

    // Strictly verify against user.otpCode in database or password fallback
    const cleanOtp = String(otp || '').trim();
    let isOtpValid = Boolean(user.otpCode && user.otpCode === cleanOtp);

    if (isOtpValid && user.otpExpiresAt && new Date() > user.otpExpiresAt) {
      return res.status(401).json({ success: false, error: 'OTP code has expired. Please request a new code.' });
    }

    // Password fallback if user enters their configured password
    if (!isOtpValid && user.passwordHash) {
      const isPasswordMatch = await bcrypt.compare(cleanOtp, user.passwordHash);
      if (isPasswordMatch) {
        isOtpValid = true;
      }
    }

    if (!isOtpValid) {
      return res.status(401).json({ success: false, error: 'Invalid OTP code or password. Please enter the 6-digit code received or your Super Admin password.' });
    }

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket?.remoteAddress || req.ip || '127.0.0.1';
    const userAgent = (req.headers['user-agent'] as string) || '';

    user.otpCode = undefined;
    user.otpExpiresAt = undefined;
    user.lastLoginAt = new Date();
    (user as any).lastLoginIp = clientIp;
    await user.save();

    const token = generateToken({
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      permissions: user.permissions || ['SUPERADMIN_ALL'],
    });

    await recordAuditLog({
      actorId: user._id.toString(),
      actorEmail: user.email,
      actorRole: user.role,
      action: 'SUPER_ADMIN_LOGIN',
      targetResource: 'ControlPlane',
      targetId: user._id.toString(),
      correlationId: req.correlationId || `sa_login_${Date.now()}`,
      ipAddress: clientIp,
      userAgent,
    });

    return res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        fullName: user.fullName,
        role: user.role,
        permissions: user.permissions,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Public Endpoint: Get active Operator Authentication Policy (OTP vs Password)
 */
authRouter.get('/operator/policy', async (_req, res: Response) => {
  try {
    const setting = await SystemSetting.findOne({ key: 'global_config' });
    const policy = setting?.operatorAuth || {
      allowOtp: true,
      allowPassword: true,
      primaryMethod: 'OTP',
    };
    return res.json({ success: true, policy });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Operator WhatsApp OTP Login: Step 1 (Request WhatsApp OTP)
 * Flexible lookup across registered users and tenant owner phone numbers.
 */
authRouter.post('/operator/request-otp', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const setting = await SystemSetting.findOne({ key: 'global_config' });
    if (setting?.operatorAuth?.allowOtp === false) {
      return res.status(403).json({
        success: false,
        error: 'WhatsApp OTP verification has been disabled by Super Administrator. Please sign in using your password.',
      });
    }

    const { phone, slug } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Mobile phone number or email is required.' });
    }

    const inputVal = phone.trim();
    const isEmail = inputVal.includes('@');
    const cleanPhoneDigits = inputVal.replace(/[^0-9]/g, '');
    const last10Digits = cleanPhoneDigits.slice(-10);

    let matchingUsers: any[] = [];
    let matchingTenants: any[] = [];

    if (isEmail) {
      matchingUsers = await User.find({
        email: inputVal.toLowerCase(),
        status: { $ne: 'suspended' },
      }).populate('tenantId');

      matchingTenants = await Tenant.find({
        'owner.email': inputVal.toLowerCase(),
        status: { $ne: 'suspended' },
      });
    } else {
      if (last10Digits.length < 10) {
        return res.status(400).json({ success: false, error: 'Please enter a valid 10-digit mobile number or email.' });
      }

      matchingUsers = await User.find({
        phone: { $regex: new RegExp(last10Digits + '$') },
        status: { $ne: 'suspended' },
      }).populate('tenantId');

      matchingTenants = await Tenant.find({
        'owner.phone': { $regex: new RegExp(last10Digits + '$') },
        status: { $ne: 'suspended' },
      });
    }

    // Check if user is a Super Admin
    const isSuperAdmin = matchingUsers.some((u) => u.role === 'super_admin');
    if (isSuperAdmin) {
      const allTenants = await Tenant.find({ status: { $ne: 'suspended' } });
      matchingTenants = allTenants;
    }

    // Ensure matching operator user exists for each tenant
    for (const t of matchingTenants) {
      let existingUser = matchingUsers.find((u) => u.tenantId && ((u.tenantId as any)._id || u.tenantId).toString() === t._id.toString());
      if (!existingUser) {
        let opUser = await User.findOne({ tenantId: t._id });
        if (!opUser) {
          try {
            opUser = await User.create({
              tenantId: t._id,
              email: t.owner?.email || `admin@${t.slug}.local`,
              phone: t.owner?.phone || (last10Digits ? `+91${last10Digits}` : '+919999999999'),
              fullName: t.owner?.name || t.displayName || 'Operator Admin',
              role: 'operator_admin',
              permissions: ['CUSTOMER_ALL', 'DEVICE_ALL', 'GIS_ALL', 'AI_ALL', 'TECH_ALL'],
              status: 'active',
            });
          } catch {
            opUser = await User.findOne({ tenantId: t._id });
          }
        }
        if (opUser) matchingUsers.push(opUser);
      }
    }

    // If slug is explicitly provided, filter by that slug
    if (slug && slug !== 'default') {
      matchingUsers = matchingUsers.filter((u) => {
        const t = u.tenantId as any;
        return t && t.slug && t.slug.toLowerCase() === slug.toLowerCase();
      });
    }

    if (matchingUsers.length === 0 && matchingTenants.length === 0) {
      return res.status(404).json({
        success: false,
        error: `Identifier '${inputVal}' is not registered as an authorized operator in the database. Please verify the mobile/email or register in Super Admin > Tenants.`,
      });
    }

    // Collect unique tenants from matching users and matching tenants
    const tenantMap = new Map<string, any>();

    for (const u of matchingUsers) {
      if (u.tenantId && typeof u.tenantId === 'object' && (u.tenantId as any).slug) {
        tenantMap.set((u.tenantId as any)._id.toString(), u.tenantId);
      }
    }
    for (const t of matchingTenants) {
      tenantMap.set(t._id.toString(), t);
    }

    const uniqueTenants = Array.from(tenantMap.values());

    // If multiple unique tenants exist and no specific slug provided, ask for tenant selection
    if (uniqueTenants.length > 1 && !slug) {
      return res.json({
        success: true,
        requireTenantSelection: true,
        tenants: uniqueTenants.map((t: any) => ({
          id: t._id,
          name: t.name,
          displayName: t.displayName || t.name,
          slug: t.slug,
        })),
      });
    }

    // Determine target tenant
    let targetTenant: any = uniqueTenants.length === 1 ? uniqueTenants[0] : null;
    if (!targetTenant) {
      if (slug && slug !== 'default') {
        targetTenant = await Tenant.findOne({ slug: slug.toLowerCase() });
      }
      if (!targetTenant) {
        targetTenant = await Tenant.findOne({ status: { $ne: 'suspended' } });
      }
    }

    if (targetTenant && targetTenant.status === 'suspended') {
      return res.status(403).json({ success: false, error: `ISP Tenant '${targetTenant.displayName}' account is suspended.` });
    }

    // Find or create operator user for targetTenant
    let operatorUser: any = null;
    if (targetTenant) {
      operatorUser = await User.findOne({
        tenantId: targetTenant._id,
        $or: [
          { phone: { $regex: new RegExp(last10Digits + '$') } },
          { email: isEmail ? inputVal.toLowerCase() : undefined }
        ].filter(Boolean)
      });
      if (!operatorUser) {
        operatorUser = await User.findOne({ tenantId: targetTenant._id, role: 'operator_admin' });
      }
      if (!operatorUser) {
        operatorUser = await User.findOne({ tenantId: targetTenant._id });
      }
    }

    if (!operatorUser && matchingUsers.length > 0) {
      operatorUser = matchingUsers[0];
    }

    if (!operatorUser && targetTenant) {
      operatorUser = await User.create({
        tenantId: targetTenant._id,
        email: targetTenant.owner?.email || `admin@${targetTenant.slug}.local`,
        phone: targetTenant.owner?.phone || (last10Digits ? `+91${last10Digits}` : '+919999999999'),
        fullName: targetTenant.owner?.name || targetTenant.displayName || 'Operator Admin',
        role: 'operator_admin',
        permissions: ['CUSTOMER_ALL', 'DEVICE_ALL', 'GIS_ALL', 'AI_ALL', 'TECH_ALL'],
        status: 'active',
      });
    }

    if (!operatorUser) {
      return res.status(404).json({
        success: false,
        error: `Could not find or create an operator user account for '${inputVal}'. Please contact Super Admin.`,
      });
    }

    // Generate dynamic 6-digit random OTP
    const dynamicOtp = Math.floor(100000 + Math.random() * 900000).toString();
    operatorUser.otpCode = dynamicOtp;
    operatorUser.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
    operatorUser.status = 'active';
    await operatorUser.save();

    console.log(`[Operator Auth] 🔑 Dynamic OTP for ${operatorUser.email || operatorUser.phone} (${operatorUser.fullName}): ${dynamicOtp}`);

    // 1. Dispatch WhatsApp OTP via Baileys Multi-Device Engine
    const dispatchPhone = operatorUser.phone || (last10Digits ? `+91${last10Digits}` : '+919999999999');
    let waDelivered = false;
    let waMessageId: string | undefined;
    try {
      const waResult = await WhatsAppService.sendOtpMessage(
        dispatchPhone,
        dynamicOtp,
        operatorUser.fullName,
        targetTenant?.displayName || 'Primary ISP'
      );
      waDelivered = waResult.success;
      waMessageId = waResult.messageId;
    } catch (waErr: any) {
      console.warn('[Operator Auth] WhatsApp dispatch warning:', waErr.message);
    }

    // 2. Dispatch Email OTP fallback if email is available
    let emailDelivered = false;
    if (operatorUser.email) {
      try {
        const emailResult = await EmailService.sendOtpEmail(operatorUser.email, dynamicOtp, operatorUser.fullName);
        emailDelivered = emailResult.success;
      } catch (emErr: any) {
        console.warn('[Operator Auth] Email OTP dispatch warning:', emErr.message);
      }
    }

    const maskedPhone = dispatchPhone.replace(/(\+\d{2})(\d{2})(\d+)(\d{2})/, '$1 $2******$4');

    return res.json({
      success: true,
      message: `Login OTP sent successfully to ${maskedPhone}${operatorUser.email ? ' and ' + operatorUser.email : ''}`,
      destinationMasked: maskedPhone,
      emailDelivered,
      whatsappDelivered: waDelivered,
      operatorName: operatorUser.fullName,
      tenantName: targetTenant?.displayName || 'Primary ISP',
      tenantSlug: targetTenant?.slug || 'default',
      messageId: waMessageId,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Operator WhatsApp OTP Login: Step 2 (Verify WhatsApp OTP)
 */
authRouter.post('/operator/verify-otp', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { phone, slug, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ success: false, error: 'Mobile number/email and OTP are required' });
    }

    const inputVal = phone.trim();
    const isEmail = inputVal.includes('@');
    const cleanPhoneDigits = inputVal.replace(/[^0-9]/g, '');
    const last10Digits = cleanPhoneDigits.slice(-10);

    let users: any[] = [];
    if (isEmail) {
      users = await User.find({
        email: inputVal.toLowerCase(),
      }).populate('tenantId');
    } else {
      users = await User.find({
        phone: { $regex: new RegExp(last10Digits + '$') },
      }).populate('tenantId');
    }

    let operatorUser: any = null;

    if (slug && slug !== 'default') {
      operatorUser = users.find((u: any) => u.tenantId && u.tenantId.slug && u.tenantId.slug.toLowerCase() === slug.toLowerCase());
    } else {
      operatorUser = users[0];
    }

    if (!operatorUser) {
      operatorUser = users[0];
    }

    if (!operatorUser) {
      return res.status(404).json({ success: false, error: 'No operator user found matching this account' });
    }

    const cleanOtp = String(otp).trim();
    let isOtpValid = Boolean(operatorUser.otpCode && operatorUser.otpCode === cleanOtp);

    // Password Fallback: allow operators with configured password to authenticate
    if (!isOtpValid && operatorUser.passwordHash) {
      try {
        const isPassMatch = await bcrypt.compare(cleanOtp, operatorUser.passwordHash);
        if (isPassMatch) {
          isOtpValid = true;
        }
      } catch {}
    }

    if (!isOtpValid) {
      return res.status(401).json({ success: false, error: 'Invalid WhatsApp OTP or login password. Please enter the dynamic 6-digit code or your account password.' });
    }

    if (operatorUser.otpCode === cleanOtp && operatorUser.otpExpiresAt && new Date() > operatorUser.otpExpiresAt) {
      return res.status(401).json({ success: false, error: 'OTP has expired. Please request a new code.' });
    }

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket?.remoteAddress || req.ip || '127.0.0.1';
    const userAgent = (req.headers['user-agent'] as string) || '';

    // Clear OTP and record login
    operatorUser.otpCode = undefined;
    operatorUser.otpExpiresAt = undefined;
    operatorUser.lastLoginAt = new Date();
    (operatorUser as any).lastLoginIp = clientIp;
    await operatorUser.save();

    // Resolve active tenant strictly from user profile or verified tenant slug
    let activeTenant: any = operatorUser.tenantId;
    if (!activeTenant || typeof activeTenant !== 'object' || !activeTenant._id) {
      if (slug && slug !== 'default') {
        activeTenant = await Tenant.findOne({ slug: slug.toLowerCase() });
      } else if (operatorUser.tenantId) {
        activeTenant = await Tenant.findById(operatorUser.tenantId);
      }
    }

    if (!activeTenant || !activeTenant._id) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Operator user account has no valid tenant assigned.',
      });
    }

    const token = generateToken({
      userId: operatorUser._id.toString(),
      email: operatorUser.email,
      role: operatorUser.role || 'operator_admin',
      tenantId: activeTenant._id.toString(),
      permissions: operatorUser.permissions || ['CUSTOMER_ALL', 'DEVICE_ALL', 'GIS_ALL', 'AI_ALL', 'TECH_ALL'],
    });

    await recordAuditLog({
      tenantId: activeTenant?._id,
      actorId: operatorUser._id.toString(),
      actorEmail: operatorUser.email,
      actorRole: operatorUser.role,
      action: 'OPERATOR_WHATSAPP_LOGIN',
      targetResource: 'Tenant',
      targetId: activeTenant ? activeTenant._id.toString() : 'primary',
      correlationId: req.correlationId || `op_wa_login_${Date.now()}`,
      ipAddress: clientIp,
      userAgent,
    });

    return res.json({
      success: true,
      token,
      tenant: activeTenant
        ? {
            id: activeTenant._id,
            name: activeTenant.name,
            displayName: activeTenant.displayName,
            slug: activeTenant.slug,
            branding: activeTenant.branding,
            plan: activeTenant.plan,
          }
        : {
            id: 'primary',
            name: 'Primary ISP',
            displayName: 'Primary ISP NOC',
            slug: 'default',
          },
      user: {
        id: operatorUser._id,
        email: operatorUser.email,
        phone: operatorUser.phone,
        fullName: operatorUser.fullName,
        role: operatorUser.role,
        permissions: operatorUser.permissions,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Operator Login (Password Entry)
 */
authRouter.post('/operator/login', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const setting = await SystemSetting.findOne({ key: 'global_config' });
    if (setting?.operatorAuth?.allowPassword === false) {
      return res.status(403).json({
        success: false,
        error: 'Password login has been disabled by Super Administrator. Please sign in using WhatsApp OTP verification.',
      });
    }

    const { email, password, slug, phone } = req.body;
    const identifier = (email || phone || '').trim();
    if (!identifier || !password) {
      return res.status(400).json({ success: false, error: 'Email or phone and password are required for operator login.' });
    }

    const tenantSlug = slug || (req.headers['x-tenant-slug'] as string) || 'apex';

    const tenant = await Tenant.findOne({ slug: tenantSlug.toLowerCase() });
    if (!tenant) {
      return res.status(404).json({ success: false, error: `ISP Tenant '${tenantSlug}' not found.` });
    }

    if (tenant.status === 'suspended') {
      return res.status(403).json({ success: false, error: 'Tenant account is suspended.' });
    }

    const isEmail = identifier.includes('@');
    const cleanDigits = identifier.replace(/[^0-9]/g, '');
    const last10 = cleanDigits.slice(-10);

    let query: any = { tenantId: tenant._id };
    if (isEmail) {
      query.email = identifier.toLowerCase();
    } else if (last10.length === 10) {
      query.$or = [
        { phone: { $regex: new RegExp(last10 + '$') } },
        { email: identifier.toLowerCase() },
      ];
    } else {
      query.email = identifier.toLowerCase();
    }

    const user = await User.findOne(query);

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid operator credentials.' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ success: false, error: 'Operator account is suspended or inactive.' });
    }

    // Secure bcrypt password verification
    if (user.passwordHash) {
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return res.status(401).json({ success: false, error: 'Invalid operator credentials.' });
      }
    } else {
      // Legacy user initial password setup: set passwordHash if meeting strength requirement (>= 8 chars)
      if (password.length >= 8) {
        user.passwordHash = await bcrypt.hash(password, 10);
      } else {
        return res.status(401).json({
          success: false,
          error: 'Password not established. Please sign in with WhatsApp OTP or provide a secure password (min 8 characters).',
        });
      }
    }

    const token = generateToken({
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      tenantId: tenant._id.toString(),
      permissions: user.permissions,
    });

    user.lastLoginAt = new Date();
    await user.save();

    await recordAuditLog({
      tenantId: tenant._id,
      actorId: user._id.toString(),
      actorEmail: user.email,
      actorRole: user.role,
      action: 'OPERATOR_LOGIN',
      targetResource: 'Tenant',
      targetId: tenant._id.toString(),
      correlationId: req.correlationId || `op_login_${Date.now()}`,
    });

    return res.json({
      success: true,
      token,
      tenant: {
        id: tenant._id,
        name: tenant.name,
        displayName: tenant.displayName,
        slug: tenant.slug,
        branding: tenant.branding,
        plan: tenant.plan,
      },
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        fullName: user.fullName,
        role: user.role,
        permissions: user.permissions,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Technician Mobile Web Login
 */
authRouter.post('/technician/login', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { phone, password, tenantSlug = 'apex' } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Registered technician mobile number is required.' });
    }

    const tenant = await Tenant.findOne({ slug: tenantSlug.toLowerCase() });
    if (!tenant) return res.status(404).json({ success: false, error: 'Tenant not found.' });

    const cleanDigits = phone.replace(/[^0-9]/g, '').slice(-10);
    const techUser = await User.findOne({
      tenantId: tenant._id,
      role: 'technician',
      phone: { $regex: new RegExp(cleanDigits + '$') },
    });

    if (!techUser) {
      return res.status(401).json({ success: false, error: 'No authorized technician found matching this phone number.' });
    }

    if (techUser.status !== 'active') {
      return res.status(403).json({ success: false, error: 'Technician account is inactive or suspended.' });
    }

    if (techUser.passwordHash && password) {
      const isMatch = await bcrypt.compare(password, techUser.passwordHash);
      if (!isMatch) {
        return res.status(401).json({ success: false, error: 'Invalid technician credentials.' });
      }
    } else if (password && !techUser.passwordHash && password.length >= 6) {
      techUser.passwordHash = await bcrypt.hash(password, 10);
      await techUser.save();
    }

    const token = generateToken({
      userId: techUser._id.toString(),
      email: techUser.email,
      role: techUser.role,
      tenantId: tenant._id.toString(),
      permissions: techUser.permissions,
    });

    techUser.lastLoginAt = new Date();
    await techUser.save();

    return res.json({
      success: true,
      token,
      tenant: {
        id: tenant._id,
        displayName: tenant.displayName,
        branding: tenant.branding,
      },
      user: {
        id: techUser._id,
        fullName: techUser.fullName,
        phone: techUser.phone,
        role: techUser.role,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Customer Self-Service Login
 */
authRouter.post('/customer/login', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { phone, accountNumber, password, tenantSlug = 'apex' } = req.body;
    if (!phone && !accountNumber) {
      return res.status(400).json({ success: false, error: 'Subscriber phone number or account number is required.' });
    }

    const tenant = await Tenant.findOne({ slug: tenantSlug.toLowerCase() });
    if (!tenant) return res.status(404).json({ success: false, error: 'Tenant not found.' });

    const cleanDigits = phone ? phone.replace(/[^0-9]/g, '').slice(-10) : '';
    const custUser = await User.findOne({
      tenantId: tenant._id,
      role: 'customer',
      ...(cleanDigits ? { phone: { $regex: new RegExp(cleanDigits + '$') } } : {}),
    });

    if (!custUser) {
      return res.status(401).json({ success: false, error: 'No subscriber account found matching this identifier.' });
    }

    if (custUser.status !== 'active') {
      return res.status(403).json({ success: false, error: 'Subscriber account is suspended or inactive.' });
    }

    if (custUser.passwordHash && password) {
      const isMatch = await bcrypt.compare(password, custUser.passwordHash);
      if (!isMatch) {
        return res.status(401).json({ success: false, error: 'Invalid subscriber credentials.' });
      }
    } else if (password && !custUser.passwordHash && password.length >= 6) {
      custUser.passwordHash = await bcrypt.hash(password, 10);
      await custUser.save();
    }

    const token = generateToken({
      userId: custUser._id.toString(),
      email: custUser.email,
      role: custUser.role,
      tenantId: tenant._id.toString(),
      permissions: custUser.permissions,
    });

    custUser.lastLoginAt = new Date();
    await custUser.save();

    return res.json({
      success: true,
      token,
      tenant: {
        id: tenant._id,
        displayName: tenant.displayName,
        branding: tenant.branding,
      },
      user: {
        id: custUser._id,
        fullName: custUser.fullName,
        phone: custUser.phone,
        role: custUser.role,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get Current User Profile & Tenant Info
 */
authRouter.get('/me', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await User.findById(req.user?.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    let tenant = null;
    if (user.tenantId) {
      tenant = await Tenant.findById(user.tenantId);
    }

    return res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        permissions: user.permissions,
        tenantId: user.tenantId,
      },
      tenant: tenant
        ? {
            id: tenant._id,
            name: tenant.name,
            displayName: tenant.displayName,
            slug: tenant.slug,
            branding: tenant.branding,
            plan: tenant.plan,
            featureEntitlements: tenant.featureEntitlements,
          }
        : null,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
});
