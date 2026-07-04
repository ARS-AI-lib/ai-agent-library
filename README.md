# AI Agent Library — Phase 2 (React + Firestore)

Dashboard สำหรับดู/ค้นหา/ลงทะเบียน Agent & Skill ทั้งหมดในคลัง — พอร์ตจาก
`Agent-lib.html` (เดิม) มาเป็น React + Firestore แบบ real-time พร้อมระบบ
Pre-Registration + Duplicate Check + Approval queue

## ครอบคลุมรอบนี้ (Phase 2 round 1)

- ✅ Agent Library dashboard (real-time, By Owner/Role/Ability, Tier filter ใหม่)
- ✅ Pre-Registration form + Duplicate Checker (เขียนตรงเข้า Firestore `approvalStatus='pending'`)
- ✅ Pending Approval queue (admin approve/reject)
- ❌ ไม่รวม: SDLC AI Adoption tab, Connections suggestion tab, Edit/Delete (รอบหลัง)

## Setup

```bash
npm install
cp .env.example .env.local
# แก้ .env.local ให้เป็นค่าจริงจาก Firebase Console > Project Settings > Web app
npm run dev
```

ค่าที่ต้องกรอกใน `.env.local`:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

(authDomain/projectId/storageBucket มี default เป็นของ project `wolfy-481609` ไว้แล้ว)

## โครงสร้างโปรเจกต์

```
src/
  lib/
    firebase.js      — init Firebase App/Auth/Firestore (named DB: ai-agent-lib)
    tier.js           — Tier (T1–T4) classification logic (client-side)
    status.js         — Status badge (ns/td/ip/pilot/ru) derived from
                         developmentPhase + devProgress (Sheet "Status"
                         column ถูกลบไปแล้วตอน re-migration)
    similarity.js     — Duplicate-check weighted similarity scoring
                         (พอร์ตจาก pre-regis.html)
    agentUtils.js     — filter/group/relationship helpers
  hooks/
    useAuth.js         — Google SSO + role lookup จาก /users/{uid}
    useAgents.js       — onSnapshot real-time: approved + pending agents
    useConfigSchema.js — อ่าน choice field options จาก /config/schema
  components/
    Nav, StatusLegend, ControlBar, MultiSelect,
    CardGrid, AgentCard, AgentDetailModal,
    PreRegModal (ฟอร์ม + duplicate-check),
    PendingApprovalModal (approve/reject)
  styles/theme.css    — design tokens ที่พอร์ตมาจาก Agent-lib.html ตรงๆ
```

## Field Mapping สำคัญที่ต้องรู้ก่อนแก้โค้ด

| UI label | Firestore field | หมายเหตุ |
|---|---|---|
| "Owner" badge | `owner` | แผนก/ทีม |
| "Creator" | `creator` | ชื่อคน — auto-fill จาก login ตอน submit |
| Status badge | *(คำนวณ)* | จาก `developmentPhase` + `devProgress`, ไม่มี field ตรงเก็บ |
| Tier (T1–T4) | *(คำนวณ)* | ไม่ store ใน Firestore — คำนวณใน `lib/tier.js` ทุกครั้งที่ render |

⚠️ **`lib/status.js` ใช้ substring matching** (`includes('pilot')` ฯลฯ) กับค่า
`developmentPhase` เพราะตอนเขียนยังไม่มี literal string จริงของ 5 ตัวเลือกใน
`/config/schema` — ถ้าทดสอบแล้วจัดประเภทผิด ให้แก้เป็น exact-match ตามค่าจริง

## ⚠️ ฟิลด์ approval workflow: `approvalStatus` (ไม่ใช่ `status`)

field เดิม `status='active'` ที่มีอยู่แล้วในทุก agent (จาก Phase 1 migration) เป็น
flag คนละความหมายกับ approval workflow ที่ Phase 2 ต้องใช้ — เพื่อไม่ให้ชนกัน
**approval workflow ใหม่ทั้งหมดใช้ field ชื่อ `approvalStatus`** (`pending` /
`approved` / `rejected`) แยกจาก `status` เดิมโดยสิ้นเชิง — ไม่ไปแก้ `status='active'`
ของเดิมเลย

## 🔴 ต้องไปแก้ Security Rules ที่ publish ไปแล้วด่วน — ไม่งั้น submit ฟอร์มจะ fail

Rule เดิมที่ publish ไว้เช็ค:
```
allow create: if isEditorOrAdmin()
              && request.resource.data.createdBy == request.auth.uid
              && request.resource.data.status == "pending";
```

ตอนนี้ app เขียน `approvalStatus: 'pending'` (ไม่เขียน `status` เลย) → rule เดิม
จะ block การ create ทุกครั้ง (เพราะ `request.resource.data.status` จะเป็น
`undefined` ไม่เท่ากับ `"pending"`)

**ต้องไปแก้ใน Firebase Console → Firestore → Rules** เปลี่ยนบรรทัดนั้นเป็น:
```
allow create: if isEditorOrAdmin()
              && request.resource.data.createdBy == request.auth.uid
              && request.resource.data.approvalStatus == "pending";
```
แล้วกด Publish อีกครั้ง

## Backfill: เติม `approvalStatus='approved'` ให้ 144 agents เดิม

agent เดิมทั้งหมดยังไม่มี field `approvalStatus` เลย (มีแค่ `status='active'` ของเดิม)
ต้อง backfill ก่อนถึงจะเห็นข้อมูลบน dashboard — ดูสคริปต์ `backfill-approval-status.js`
ที่แนบมาด้วย รันด้วย:
```bash
npm install firebase-admin
node backfill-approval-status.js
```

## Deploy

```bash
npm run build
firebase deploy --only hosting
```

`firebase.json` ตั้งให้ deploy แอปนี้ที่ path `/` (root) ตาม architecture ที่ lock ไว้
— ตอนทำ SDLC Tracker (`/sdlc/`) และ Portfolio (`/portfolio/`) ทีหลัง จะต้องกลับมาแก้
`firebase.json` ให้เป็นหลาย rewrites/targets แทนที่จะ deploy ทับ root เดิม
(ตอนนั้นค่อย grill กันใหม่ว่าจะรวม build 3 แอปยังไงให้ดีที่สุด)

## ⚠️ พบ 1 จุดที่ Security Rules (publish แล้ว) ไม่ตรงกับ assumption ของ UI นี้

Rules ที่ publish ไปแล้ว (`allow update: if isEditorOrAdmin();` บน `/agents/{id}`)
อนุญาตให้ **editor ก็ update field ไหนก็ได้รวมถึง `approvalStatus`** (ไม่ใช่แค่
admin) — แต่ UI นี้ซ่อนปุ่ม Pending Approval/Approve ไว้ให้เห็นแค่ `isAdmin` เท่านั้น
ตาม assumption ที่ตั้งไว้ตอน grilling รอบ 4 (editor สร้าง, admin approve)

ถ้าต้องการให้ตรงกับ UI เป๊ะๆ (editor ห้าม approve) → ต้องไปแก้ rule ฝั่ง
`/agents/{agentId} allow update` ให้เช็ค `isAdmin()` เพิ่มเมื่อ field ที่เปลี่ยนคือ
`approvalStatus` โดยเฉพาะ — ยังไม่ได้แก้ให้ในรอบนี้ เพราะเป็นการแก้ rules ที่ publish
ไปแล้วของจริง ควร confirm กับคุณก่อน
