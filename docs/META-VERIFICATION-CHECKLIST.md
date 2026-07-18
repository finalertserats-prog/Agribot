# Meta Business Verification — India Checklist (Agri-Dosth)

You need **Meta Business Verification** to run the WhatsApp Cloud API in production
(it lifts the 250-msg/day sandbox cap). Start this **now, in parallel** with the
Baileys pilot — it's the slow part (days). India-specific, current as of **July 2026**;
reconfirm on Meta's Security Center before submitting.

> The #1 cause of rejection is a **name/address mismatch** between what you type in
> Meta and what's on your documents. Match them **letter-for-letter**.

---

## 0. If you have NO registered business yet (sole proprietor / startup)

Meta **does not verify individuals** — you must represent a legal business entity.
The fastest, **free** route for a sole proprietor:

1. **Register for Udyam (MSME)** — free, 100% online, ~15–30 min, using your Aadhaar +
   PAN at **udyamregistration.gov.in**. Instantly issues a certificate Meta accepts as
   proof of legal name **and** address.
2. **Open a current (business) bank account** in the business name (using the Udyam cert)
   → its statements become your address proof.
3. *(Optional)* **Shop & Establishment License** from your municipal portal if you don't
   have GST.

Udyam alone is usually enough to start verification.

---

## 1. Documents to gather (upload clean PDFs from the source portal)

Provide one document per category. **All must show the exact legal business name** and be
recent (within 3–6 months where dated).

### (a) Legal business name / existence — submit 1
- [ ] **GST Registration Certificate** (Form GST REG-06), OR
- [ ] **Udyam / MSME Certificate** (fastest for proprietors), OR
- [ ] **Certificate of Incorporation** (Pvt Ltd / LLP), OR
- [ ] **Shop & Establishment License**, OR
- [ ] **Partnership Deed** (partnerships)
- Also accepted: Business PAN, IEC (import/export), FSSAI license.
- ⚠️ A **personal** PAN is **not** accepted for company verification.

### (b) Business address — submit 1
- [ ] **GST Certificate** (principal-place-of-business page), OR
- [ ] **Udyam Certificate** (unit address), OR
- [ ] **Business bank statement** (in the business name), OR
- [ ] **Utility bill** — electricity / water / gas / internet (business name), OR
- [ ] **Registered lease / rental agreement**
- Must be **dated within the last 3–6 months** and match the Meta address exactly.

### (c) Phone number — submit 1 (if asked)
- [ ] **Official phone bill** (Airtel/Jio/BSNL/Vi), OR
- [ ] **Business bank statement**, OR
- [ ] **Utility bill**
- Must show the phone number alongside the legal business name.

### Nice to have (reduces rejections / enables automated approval)
- [ ] A **business website** on HTTPS whose **footer shows the exact legal name, address,
      and contact email** (matching your docs).
- [ ] A **domain email** (e.g. `info@yourdomain.in`) — free Gmail/Outlook is **not**
      accepted as the verification contact email.

---

## 2. Submit (Meta Business Suite → Security Center)

1. **business.facebook.com/settings** → left nav → **Security Center**.
2. Under *Business Verification* → **Start Verification**.
   - If greyed out: first create a **WhatsApp Business Account (WABA)** or a developer app
     linked to this business portfolio — that unlocks the button.
3. **FIRST, fix Business Info** — go to *Business Info* and edit the legal name + address to
   match your GST/Udyam **letter-for-letter** (spacing, punctuation, "&" vs "and" all matter).
   *Then* start verification. (This one step prevents most rejections.)
4. Enter Legal Business Name, Address, Phone, Website.
5. Pick your business from Meta's list if shown, else **"None of these match"**.
6. **Upload** the legal-identity doc + the address doc (clean, full-page, original PDFs).
7. Choose OTP method: **domain email** (recommended) / phone call / SMS / DNS-TXT domain verify.
8. Enter the code → **Submit**.

---

## 3. Avoid these rejection traps
- **Name/address mismatch** → fix Business Info to match docs *before* submitting (most common).
- **Blurry / cropped / screenshot docs** → upload original PDFs from the GST/Udyam portal; scan
  full pages flat.
- **Personal email** for the verification contact → use a domain email.
- **Weak website** → HTTPS, working links, footer with exact legal name + address + email.
- **Stale statements** → use the most recent month.

---

## 4. How long it takes
| Path | Time |
|---|---|
| Automated (clean website + domain email + listed business) | 15 min – 24 h |
| Manual review (Udyam / Shop & Est. / regional docs) | **3–7 business days** |
| Complex (discrepancies / peak periods) | up to 14 business days |

**→ Start now.** Verification is the long pole; everything else (adapter, templates, webhook)
can be built while it's in review.

---

## Quick-start for a sole proprietor with nothing yet
1. Get **Udyam** (free, today) → 2. Open a **business bank account** → 3. Stand up a small
**HTTPS website** with a matching footer + a **domain email** → 4. Create the **WABA** →
5. In **Security Center**, match Business Info to the Udyam cert exactly → 6. Submit Udyam
(legal name) + bank statement (address). Most approvals land in a few days.
