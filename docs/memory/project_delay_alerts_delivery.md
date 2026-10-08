---
name: project_delay_alerts_delivery
description: Delay/At-risk alerts ส่งทาง Teams + Email จ./พฤ. 09:30/13:00 Bangkok; switch ใน /config/alerts
metadata:
  type: project
---

## ระบบ Delay/At-risk Alerts (shipped 2026-10-05)

### ที่มา
Monitor ผลงานของ Creator ว่า item ไหนล่าช้า (passed deadline) หรือจะล่าช้า (ภายใน 5–10 วันธุรกิจ)

### ตั้งเวลา
- **จันทร์ 13:00 สัปดาห์ละครั้ง** (Asia/Bangkok; เปลี่ยนจาก จ.09:30+พฤ.13:00 เมื่อ 2026-10-08)
- Cloud Scheduler `delayAlertsMon` (ตัว Thu ถูกลบ)
- Enqueue to Cloud Tasks queue `sendDelayDigest` (10s interval, concurrency 1)

### ผู้รับ
- **Creator เท่านั้น** (`creatorEmails`) ไม่รวม approver/staff
- ส่งแบบ Digest: รายการทั้งหมดขององค์คนนั้นโดยสรุป 1 ฉบับต่อครั้ง

### วิธีเปิด/ปิด/ทดสอบ
**ปิด (default = off):**
```bash
# ไม่มีคำสั่ง — ไฟล์ /config/alerts ว่าง = disable ทั้งหมด
```

**เปิด (production):**
```
/config/alerts = {
  enabled: true,
  dryRun: false,              # ส่งจริง
  reviewers: []               # ไม่ต้อง (reviewers ใช้สำหรับ dryRun เท่านั้น)
}
```

**ทดสอบ (dry-run):**
```
/config/alerts = {
  enabled: true,
  dryRun: true,               # log แต่ไม่ส่งจริง
  reviewers: ['tinnapat.p@arise.tech']  # ส่งให้แค่คนนี้
}
```
เมื่อ `dryRun: true` → digest ที่ addressee ไม่ใช่ reviewers จะถูก log เป็น `dry-run` ใน `/mailLog`

### ประเภทงานที่แจ้ง (priority order)
1. **Delayed** — launchDate ผ่านไปแล้ว
2. **Due within 5 business days** — launchDate ใกล้
3. **At risk** (`timelineStatus() === 'risk'`) — ภายใน 10 business days
4. **To Do > 30 days** — จาก `createdAt` ที่ไม่ขยับ
5. **In Progress, no progress save > 30 days** — จาก `progressUpdatedAt`
6. **In Progress > 60 days** — จาก `createdAt` โดยไม่มี launchDate
7. **Pilot > 30 days without launchDate** / **> 60 days with launchDate**

### ข้อมูลที่ต้องติด
- `phaseSince` (timestmap) — เมื่อเข้า status bucket ปัจจุบัน (stamped ตอน create + progress save + deploy request + cascade)
- `progressUpdatedAt` — last progress save ใดๆ (stamped เหมือน `phaseSince`)
- `launchDate` — Firestore Timestamp หรือ legacy string `M/D/YYYY`

ของเก่า ~143 item backfilled `phaseSince` จาก `createdAt` (user decision) → ครั้งแรก flag เกือบทั้งไลบรารี

### ปิด pending items, archived, 100%, paired sub-skill
ไม่ส่งแจ้งเตือนถ้า status ≠ approved, `archived: true`, `devProgress === 100`, หรือ `isPairedSubSkill`

### Storage
- `/alertRuns/{runId}` — metadata ของการรัน scheduler (ts, status, count)
- `/items/{sha1(email)}` — digest ของแต่ละ creator (หลายรายการ per email)
- `/mailLog` — audit ทุกครั้ง `type: delay.digest` (sent / dry-run / error)

### Key files
| ไฟล์ | หน้าที่ |
|---|---|
| `functions/delayAlertRules.js` | logic จัดกลุ่ม + logic คำนวณ (pure, ทดสอบได้ offline) |
| `functions/verify-delay-alerts.cjs` | **รันก่อน deploy** — 43 เคส + `--live` ตรวจกับข้อมูลจริง + drift กับ src/lib |
| `src/lib/status.js` | `phaseSince`, `phaseChanged()` |
| `/config/alerts` | switch `enabled`, `dryRun`, `reviewers[]` |

### IAM (สำคัญ)
Compute Service Account `526359843242-compute@developer.gserviceaccount.com` ต้องมี:
- `roles/cloudtasks.enqueuer`
- `roles/iam.serviceAccountUser`
(ไม่มี condition — ถ้า Wiz binding ถาม condition ตอบ **None**)

ถ้าขาด → scheduler ใช้ได้ แต่ enqueue ล้มเพราะ permission denied

### บทเรียน: `progressUpdatedAt` ต้องจดจำ
เดิมมีแค่ `updatedAt` (doc-level, แตะเวลา save ไฟล์เดียว) ส่วน `progressUpdatedAt` ต้องจดเวลา
ที่ progress ข้อมูล เปลี่ยน (progress save, cascade, deploy request) → backfill ช่วยแก้จำนวน
false-positive "no progress save" ที่สอบวัดแล้ว

### ตรวจว่าใช้ได้
```bash
node functions/verify-delay-alerts.cjs --live      # ต้อง ADC
npx firebase-tools functions:list | grep -i delay  # เห็น 3 function
```
