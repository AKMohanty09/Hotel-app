# Security Specification (Phase 0 TDD)

## 1. Core Data Invariants
1. **Permanent QR Immutability**: `restaurant_tables.qrToken` cannot be changed after creation except via an explicit audited revocation flow by an Owner/Manager.
2. **Verified Session Gate for Customer Orders**: A `dine_in_qr` order can only be created if `sessionId` references an existing `table_sessions` document with `status == 'active'` and matching `tableId`.
3. **Waiter Presence Gate**: A `table_verification_requests` document cannot transition to `verified` unless `presenceConfirmed == true` has been set by an authenticated Waiter/Manager. OTPs are never stored in Firestore.
4. **Staff RBAC Isolation**: Kitchen staff cannot read or write `bills`, `payments`, `staff_profiles` of other users, or `restaurants` settings. Waiters cannot mutate settled (`paid`) bills or issue refunds.
5. **Immutable Audit Logs & Paid Bills**: `audit_logs` and `payments` cannot be updated or deleted once created. Paid `bills` cannot be silently overwritten.
6. **PII & Role Escalation Guard**: Users cannot self-assign `owner`, `manager`, or `staff` roles in `staff_profiles`.

## 2. Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unverified Email Spoof**: Write to `menu_items` with email matching admin but `email_verified: false`.
2. **Self Role Escalation**: Non-admin authenticated user creates `staff_profiles/{uid}` with `role: "owner"`.
3. **Shadow Ghost Field**: Create `restaurant_tables` including unexpected field `isBypassed: true`.
4. **QR Token Mutation**: Waiter attempts to overwrite `qrToken` on existing `restaurant_tables/{id}`.
5. **Unverified Customer Order**: Guest creates `orders` with `channel: "dine_in_qr"` pointing to a `closed` or nonexistent `sessionId`.
6. **Skipped Presence Confirmation**: Guest updates `table_verification_requests/{id}` to `status: "verified"` while `presenceConfirmed == false`.
7. **Kitchen Reading Financial Bills**: Kitchen staff queries or gets `bills/{billId}` or `payments/{paymentId}`.
8. **Silent Overwrite of Paid Bill**: Waiter updates `totalAmount` on a `bills/{billId}` whose `status == "paid"`.
9. **Audit Log Tampering**: Manager attempts to delete or update `audit_logs/{logId}`.
10. **ID Poisoning**: Create document with 1,500-character ID or invalid path characters.
11. **Blanket List Scraping**: Unauthenticated user attempts `list` on `staff_profiles` or `audit_logs`.
12. **Client Timestamp Spoofing**: Write `createdAt` with forged client date instead of `request.time`.
