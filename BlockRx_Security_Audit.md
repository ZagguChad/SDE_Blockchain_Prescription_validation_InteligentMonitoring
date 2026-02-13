# BlockRx Security Audit Report
**Blockchain-Based Digital Prescription System**  
**Audit Date:** February 11, 2026  
**Auditor:** Senior Blockchain Systems Auditor  
**Project Type:** Academic/Self-Project (Zero Budget)

---

## SECTION 1: SYSTEM OVERVIEW (High-Level Evaluation)

### Architecture Summary
BlockRx is a **hybrid blockchain-database prescription management system** with the following stack:
- **Smart Contract:** Solidity (PrescriptionRegistryV2) on Ethereum-compatible chain
- **Backend:** Node.js + Express.js + MongoDB
- **Frontend:** React + Vite + ethers.js
- **External Services:** SMTP (email), PDF generation (pdf-lib/muhammara)

### What BlockRx Does Well
1. **Dual-Layer Architecture:** Combines on-chain immutability with off-chain flexibility
2. **Role-Based Access Control (RBAC):** Distinct workflows for doctors, pharmacies, patients, admin
3. **Data Privacy:** AES-256-CBC encryption for sensitive patient data
4. **Prescription Lifecycle Management:** State transitions (CREATED → ACTIVE → USED/EXPIRED)
5. **Inventory Integration:** Real pharmacy stock validation with FIFO depletion
6. **Atomic Dispensing:** Rollback-safe stock deduction with transaction journaling
7. **PDF Security:** Password-protected prescription delivery via email
8. **Fraud Detection:** Basic pattern monitoring (high-volume doctors, abnormal stock depletion)

### Critical Weaknesses
1. **Sync Fragility:** DB-blockchain synchronization is NOT atomic (race condition risk)
2. **Hardcoded Secrets:** Encryption key derived from hardcoded string in code
3. **No Multi-Signature:** Owner-only control on smart contract (single point of failure)
4. **JWT Without Refresh:** 30-day tokens with no revocation mechanism
5. **Missing Input Sanitization:** No XSS/injection protection on user inputs
6. **No Rate Limiting:** API endpoints vulnerable to brute-force/D DoS
7. **Blockchain Dependency:** System fails if blockchain is unreachable
8. **No Audit Logs:** Missing comprehensive activity trail for compliance

### Maturity Level
**Academic Prototype** — Demonstrates solid architectural thinking but lacks production hardening.

---

## SECTION 2: LAYER BY LAYER AUDIT

### Layer 1: Actors & Access Control

**What is Implemented:**
- 3 Primary Roles: Doctor, Pharmacy, Patient + Admin
- Smart Contract RBAC: Doctors can issue, pharmacies can dispense
- JWT Authentication with role payload
- Patient Temporary Access via prescription-driven accounts
- Middleware Authorization: `protect` + `authorize(role)` pattern

**What is Missing:**
- Permission Granularity (no sub-roles)
- Multi-Factor Authentication
- Account Recovery/Password Reset
- Session Management/Token Blacklist
- IP Whitelisting for Admin

**Security Level:** 🟡 Partial (5/10)  
**Risk:** Stolen JWT = full account compromise for 30 days

---

### Layer 2: Web Portal / Frontend

**What is Implemented:**
- React SPA with role-based dashboards
- ethers.js blockchain integration
- Context-Based Auth (`AuthContext`)
- Protected Routes by role
- Client-side validation (email, quantity)

**What is Missing:**
- Input Sanitization (XSS risk)
- HTTPS Enforcement
- Content Security Policy
- CORS validation
- Front-Running Protection
- Error message sanitization

**Security Level:** 🟡 Partial (4/10)  
**Risk:** Client-side validation easily bypassed

---

### Layer 3: Database Layer

**What is Implemented:**
- MongoDB with Mongoose schemas
- Indexed fields (`blockchainId`, `medicineId`)
- Sparse indexes for unique/null combos
- Pre-save hooks for medicineId generation
- Encrypted sensitive fields

**What is Missing:**
- Database authentication
- Connection encryption (SSL)
- Backup strategy
- Data retention policy
- Schema versioning/migrations
- Access auditing

**Security Level:** 🟡 Partial (5/10)  
**Risk:** Exposed MongoDB = all PII accessible

---

### Layer 4: Prescription Data Model

**Structure:**
```
{
  blockchainId, patientName (encrypted), patientUsername,
  patientDOB, patientEmail (encrypted),
  medicines: [{ name, dosage, quantity, instructions (encrypted) }],
  diagnosis (encrypted), maxUsage, usageCount,
  blockchainSynced, txHash, blockNumber,
  dispenseId, invoiceDetails
}
```

**Strengths:**
- ✅ Normalization layer prevents data mismatches
- ✅ Canonical `medicineId` for inventory matching
- ✅ Handles field name variations

**Weaknesses:**
- ⚠️ `medicines.name` is **plaintext** (privacy leak)
- ⚠️ No field-level validation beyond Mongoose
- ⚠️ Hash stored on-chain but never verified

**Security Level:** 🟢 Strong (7/10)

---

### Layer 5: Inventory System

**What is Implemented:**
- Batch-based tracking with FIFO depletion
- Atomic deduction with rollback journal
- Status management (ACTIVE/DEPLETED/EXPIRED)
- Weighted average pricing across batches
- Blockchain batch registration (events only)

**What is Missing:**
- Batch verification against on-chain hash
- Manufacturer lot tracking
- Cold chain monitoring
- Proactive expiry alerts
- Supplier validation

**Security Level:** 🟢 Strong (7/10)  
**Best Feature:** Rollback mechanism prevents corruption

---

### Layer 6: Dispensing System

**Flow:**
1. Fetch prescription from DB
2. Normalize medicines (field resolution)
3. Validate quantities > 0
4. Check stock availability
5. Deduct stock (FIFO) with rollback
6. Compute pricing
7. Update status → DISPENSED
8. Generate invoice PDF
9. Email invoice (non-blocking)

**Strengths:**
- ✅ 3-Phase validation (Normalize → Check → Deduct)
- ✅ Defensive quantity guards
- ✅ Single atomic endpoint
- ✅ Rollback safety

**Weaknesses:**
- ⚠️ No idempotency check (duplicate risk)
- ⚠️ No DB locking (race condition)
- ⚠️ Cannot partial-dispense
- ⚠️ Off-chain updates even if on-chain fails

**Security Level:** 🟢 Strong (8/10)  
**Critical Gap:** Race condition between concurrent pharmacies

---

### Layer 7: SMTP & PDF System

**What is Implemented:**
- Nodemailer SMTP integration
- pdf-lib + muhammara for encrypted PDFs
- Deterministic password: `username_DDMMYYYY`
- HTML email templates
- Dual PDF types (prescription + invoice)

**What is Missing:**
- Email verification
- SPF/DKIM setup
- Bounce handling/retries
- PDF watermarking
- Stronger password entropy

**Security Level:** 🟡 Partial (6/10)  
**Risk:** DOB-based passwords = brute-forceable

---

### Layer 8: Blockchain Layer (Smart Contract)

**PrescriptionRegistryV2.sol:**
```solidity
struct Prescription {
  bytes32 id; address issuer; address pharmacy;
  bytes32 prescriptionHash; uint256 quantity;
  uint256 usageCount; uint256 maxUsage;
  uint256 expiryDate; Status status; uint256 timestamp;
}
```

**Strengths:**
- ✅ Access control modifiers
- ✅ State validation (expiry, usage limits)
- ✅ Event emission for audit trail
- ✅ Reentrancy safe
- ✅ Overflow safe (Solidity 0.8.19)

**Weaknesses:**
- ⚠️ Single owner (centralization)
- ⚠️ No pause mechanism
- ⚠️ Not upgradeable
- ⚠️ Hash stored but never verified
- ⚠️ Time dependency (`block.timestamp`)

**Security Level:** 🟢 Strong (7/10)

---

### Layer 9: Data Synchronization

**Current Flow:**
1. Frontend → Blockchain TX
2. Wait for receipt
3. POST to backend with `txHash`, `blockchainSynced: true`

**🔴 CRITICAL ISSUE:** Steps 2→3 are NOT atomic  
If backend POST fails after blockchain success:
- Prescription exists on-chain but NOT in DB
- Creates orphaned data
- No auto-recovery

**What is Missing:**
- Event listener service
- Reconciliation tool
- Retry mechanism
- Idempotency

**Security Level:** 🔴 Weak (3/10)

---

### Layer 10: Patient Privacy

**Encrypted:** `patientName`, `patientEmail`, `diagnosis`, `allergies`, `notes`, `medicines[].instructions`

**NOT Encrypted (Leaks):**
- `medicines[].name` — **PLAINTEXT**
- `patientAge`, `patientDOB` — **PLAINTEXT**
- `patientUsername` — **PLAINTEXT**

**🔴 CRITICAL:** Encryption key = `'MY_SECRET_KEY_12345'` **HARDCODED IN CODE**

**Security Level:** 🔴 Weak (2/10)  
**Verdict:** Encryption theater — key in source code defeats purpose

---

### Layer 11: Error Handling

**Implemented:**
- Try/catch wrappers
- HTTP status codes
- Contextual logging
- User-friendly messages

**Missing:**
- Machine-readable error codes
- Retry logic
- Circuit breakers
- Centralized error handler
- Monitoring/alerting

**Security Level:** 🟡 Partial (5/10)  
**Risk:** Error messages leak internal structure

---

### Layer 12: Overall Security Design

**Attack Vector Analysis:**

| Attack | Likelihood | Impact | Mitigated? |
|--------|-----------|--------|-----------|
| XSS | **HIGH** | Medium | ❌ No |
| CSRF | **HIGH** | High | ❌ No |
| JWT Theft | Medium | **HIGH** | ⚠️ Partial |
| Encryption Key Leak | **HIGH** | **CRITICAL** | ❌ No |
| Race Condition | Medium | Medium | ⚠️ Partial |
| DoS | **HIGH** | Medium | ❌ No |
| Smart Contract Ownership | Low | **CRITICAL** | ⚠️ Single owner |

**Security Level:** 🟡 Partial (4/10)

---

## SECTION 3: RISK ANALYSIS TABLE

| Component | Risk | Type | Reason | Fix |
|-----------|------|------|--------|-----|
| **Hardcoded Encryption Key** | 🔴 CRITICAL | Data Breach | Key in code = privacy breach | LOW |
| **DB-Blockchain Sync Gap** | 🔴 CRITICAL | Consistency | Non-atomic updates | HIGH |
| **No Rate Limiting** | 🔴 HIGH | DDoS | Unprotected APIs | LOW |
| **XSS Vulnerability** | 🔴 HIGH | Injection | No sanitization | LOW |
| **Single Owner Contract** | 🟡 HIGH | Centralization | One address controls all | MED |
| **JWT No Refresh** | 🟡 HIGH | Session Hijack | 30-day validity | MED |
| **No HTTPS** | 🟡 HIGH | MITM | Localhost URLs | LOW |
| **Medicine Names Plaintext** | 🟡 MED | Privacy | DB leak reveals meds | LOW |
| **No CSRF** | 🟡 MED | Unauth Actions | No tokens | LOW |
| **Race Condition** | 🟡 MED | Duplicate Dispense | No locking | MED |
| **No Backups** | 🟡 MED | Data Loss | No recovery | LOW |

---

## SECTION 4: FINAL HONEST SCORECARD

| Layer | Status | Score | Explanation |
|-------|--------|-------|-------------|
| **Smart Contract** | 🟢 Strong | 7/10 | Solid Solidity. Missing multi-sig |
| **Backend Architecture** | 🟢 Strong | 7/10 | Modular, atomic dispensing |
| **Database Schema** | 🟢 Strong | 7/10 | Good structure, no backups |
| **Encryption** | 🔴 Weak | 2/10 | **Hardcoded key** |
| **Blockchain Sync** | 🔴 Weak | 3/10 | Non-atomic, fragile |
| **Authentication** | 🟡 Partial | 5/10 | Works, missing MFA |
| **Input Validation** | 🟡 Partial | 6/10 | Present, no XSS protection |
| **Inventory** | 🟢 Strong | 8/10 | **Excellent rollback** |
| **API Security** | 🔴 Weak | 3/10 | No rate limiting |
| **PDF/Email** | 🟡 Partial | 6/10 | Functional, weak passwords |
| **Frontend** | 🟡 Partial | 4/10 | Clean code, no CSP |
| **Error Handling** | 🟡 Partial | 5/10 | Try/catch, info leaks |
| **Privacy** | 🔴 Weak | 2/10 | Hardcoded key defeats all |
| **Audit Trail** | 🟡 Partial | 4/10 | Blockchain events only |
| **Resilience** | 🟡 Partial | 5/10 | Rollback good, no failover |

**Aggregate: 5.1/10** — Advanced Academic Prototype

---

## SECTION 5: PRODUCTION READY (ZERO BUDGET)

### CRITICAL (Must Fix)

**1. Move Encryption Key to .env (15 min)**
```javascript
// .env: ENCRYPTION_KEY=<openssl rand -hex 32>
const KEY = process.env.ENCRYPTION_KEY;
```

**2. Add Rate Limiting (30 min)**
```bash
npm install express-rate-limit
app.use('/api/', rateLimit({ windowMs: 15*60*1000, max: 100 }));
```

** 3. Sanitize Inputs (20 min)**
```bash
npm install express-mongo-sanitize xss-clean
app.use(mongoSanitize()); app.use(xss());
```

**4. Event Listener Service (2 hrs)**
```javascript
setInterval(async () => {
  const events = await contract.queryFilter('PrescriptionCreated');
  // Sync to DB with blockchainSynced: true
}, 60000);
```

**5. Add Helmet Security Headers (5 min)**
```bash
npm install helmet
app.use(helmet());
```

### HIGH PRIORITY

6. Encrypt medicine names (1 hr)
7. httpOnly JWT cookies (1 hr)
8. CSRF protection (1 hr)
9. MongoDB backups (30 min)
10. Idempotency checks (30 min)

### MEDIUM PRIORITY

11. DB transaction locking (2 hrs)
12. Winston logging (2 hrs)
13. Multi-sig contract (4 hrs + redeploy)
14. HTTPS reverse proxy (1 hr)
15. Stronger PDF passwords (1 hr)

**Total Time to MVP Security: ~12 hours**

---

## SECTION 6: FINAL VERDICT

### Classification: **🟡 Advanced Academic Project**

**BlockRx demonstrates senior-level architectural thinking** with hybrid blockchain design, atomic inventory management, and prescription lifecycle control. The code is clean, modular, and follows best practices.

**However, critical security gaps prevent production use:**
- Hardcoded encryption key
- Missing rate limiting
- Non-atomic sync
- No XSS protection

**Skill Demonstrated:**
- Backend Engineering: 7/10
- Smart Contract: 7/10
- System Design: 8/10
- Security: 4/10
- Production Readiness: 3/10

### Recommendation

**✅ Academic Submission:** APPROVED  
**✅ Portfolio Project:** APPROVED (with disclaimer)  
**⚠️ Startup Pilot:** Fix items 1-5 first  
**❌ Production Healthcare:** Requires audit + HIPAA compliance

### Time to Production

- **Minimum Security (items 1-10):** 12 hours → Safe for pilot
- **Startup Beta (items 1-15):** 25 hours → Small pharmacy trial
- **Production Healthcare:** 200+ hours + audit → Requires budget

### Bottom Line

**BlockRx is a SOLID ACADEMIC PROJECT** with real engineering skill. The architecture is intelligent, the dispensing flow is production-grade, and the hybrid blockchain approach is thoughtful.

**It's NOT production-ready.** The hardcoded encryption key alone disqualifies it. But **fix the 10 critical items (12 hours) and this becomes a legitimate startup MVP.**

**HONEST RATING:**  
**7/10** as academic project  
**3/10** as production software

**You built something real. Now harden it.**

---

**End of Audit Report**
