# ย้ายไปทำงานที่เครื่องใหม่ (AI Agent Library)

> คู่มือนี้เขียนเมื่อ 2026-10-06 ให้ทั้ง **คน** และ **Claude** อ่าน
> Claude: ถ้าผู้ใช้บอกว่า "เพิ่งย้ายเครื่อง" ให้อ่านไฟล์นี้ + `CLAUDE.md` + `docs/SYSTEM-OVERVIEW.md` ก่อนทำอะไร
> แล้วไล่ตรวจ "ขั้นที่ 9" ให้ผู้ใช้ทีละข้อ

---

## 0. ภาพรวม: อะไรย้ายตามไปเอง อะไรไม่ตาม

| ของ | ตามไปเองไหม | ทำยังไง |
|---|---|---|
| ระบบที่รันจริง (เว็บ, Cloud Functions, แจ้งเตือน, Firestore) | ✅ อยู่บน cloud ไม่เกี่ยวกับเครื่อง | ไม่ต้องทำอะไร |
| โค้ด | ✅ อยู่บน GitHub | `git clone` |
| ความรู้ของโปรเจกต์ | ✅ `CLAUDE.md`, `docs/SYSTEM-OVERVIEW.md`, `docs/memory/`, ไฟล์นี้ | อยู่ใน repo |
| ประวัติแชทกับ Claude | ❌ เก็บในเครื่องเท่านั้น | ใช้ไฟล์ข้างบนแทน (ความรู้สำคัญถูกเขียนลงไฟล์ไว้แล้ว) |
| Memory ของ Claude | ❌ ต้องคัดลอกเอง | ขั้นที่ 6 |
| `.env.local` (ค่า Firebase ของเว็บ) | ❌ ไม่อยู่ใน git (ตั้งใจ) | ขั้นที่ 4 |
| login firebase / gcloud | ❌ | ขั้นที่ 5 |
| แอปอื่นที่ไม่อยู่ใน git (ดูขั้นที่ 1) | ❌ | คัดลอกเอง |

---

## 1. ก่อนทิ้งเครื่องเก่า (ทำที่เครื่องเก่า)

1. ใน repo `agent-library` ต้องไม่มีงานค้าง:
   ```bash
   git status --short
   git rev-list --left-right --count origin/main...main   # ต้องได้ 0 0
   ```
2. **แอปอื่นที่ไม่ได้อยู่ใน git** (ตรวจเมื่อ 2026-10-06) — คัดลอกทั้งโฟลเดอร์ไปเครื่องใหม่ (ไม่รวม `node_modules`):
   - `~/Downloads/Claude/Portfolio/portfolio-app` — **ไม่มี git** ⚠️ ถ้าหายคือหายจริง
   - `~/Downloads/Claude/Vote`, `~/Downloads/Claude/RoamTab` และโฟลเดอร์อื่นใน `~/Downloads/Claude/` ที่ไม่มี git
   - `~/Downloads/Claude/AICommitteDeck` มี git แล้ว (`github.com/ARS-AI-lib/ai-governance`) → clone ได้
3. เก็บ `.env.local` ของแต่ละแอปไว้ที่ปลอดภัย (password manager) — **ห้ามส่งทางแชท/อีเมล/ใส่ git**
   - `agent-library/.env.local`
   - `.env*` ของแอปอื่นใน `~/Downloads/Claude/*`
4. ไฟล์ในโฟลเดอร์แม่ `~/Downloads/claude_AIApp/` (นอก repo) ส่วนใหญ่เป็นของเก่า (HTML ต้นแบบ, แชท export เดือน มิ.ย., `CLAUDE.md` สำเนาเก่า ส.ค.) — ไม่จำเป็นต่องานปัจจุบัน คัดลอกไปเก็บไว้ได้ถ้าอยากเก็บประวัติ

---

## 2. ติดตั้งเครื่องมือที่เครื่องใหม่

| เครื่องมือ | เวอร์ชันที่ใช้อยู่ | หมายเหตุ |
|---|---|---|
| Node.js | v24 (functions รันบน nodejs22 บน cloud) | ติดตั้งจาก nodejs.org หรือ nvm |
| git | — | มากับ Xcode Command Line Tools: `xcode-select --install` |
| Firebase CLI | ใช้ผ่าน `npx firebase-tools` (15.x) | **ไม่ต้องติดตั้ง global** (เลี่ยงสิทธิ์ admin) |
| Google Cloud SDK (`gcloud`) | 574 | ติดตั้งลง home ได้ถ้าไม่มีสิทธิ์ admin (CLAUDE.md §19) |
| Java 21 (JDK) | `~/.local/jdk-21*` | ใช้เฉพาะ Firebase emulator (ทดสอบ local) แตก tarball ลง `~/.local/` |
| Claude Desktop | — | login บัญชีเดิม |

---

## 3. สร้างโฟลเดอร์และ clone

แนะนำให้ใช้ path เดิมเพื่อให้ทุกอย่าง (รวม memory key) เหมือนเดิม:

```bash
mkdir -p ~/Downloads/claude_AIApp
cd ~/Downloads/claude_AIApp
git clone https://github.com/ARS-AI-lib/ai-agent-library.git agent-library
cd agent-library
npm install
cd functions && npm install && cd ..
```

> ถ้าใช้ path อื่น ได้เหมือนกัน แต่ memory key ในขั้นที่ 6 จะเปลี่ยนตาม

---

## 4. สร้าง `.env.local` (สำคัญที่สุด)

Vite ฝังค่านี้ตอน build — **ไม่มีไฟล์นี้ = เว็บที่ build ออกมา login ไม่ได้ ถ้าเผลอ deploy จะทำ production พัง**

1. คัดลอกต้นแบบ: `cp .env.example .env.local`
2. เติมค่าจาก Firebase Console → Project settings (เฟือง) → Your apps → Web app → SDK setup and configuration
   (`VITE_FIREBASE_API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `STORAGE_BUCKET`, `MESSAGING_SENDER_ID`, `APP_ID`)
   หรือคัดลอกไฟล์เดิมจากที่เก็บไว้ในขั้นที่ 1.3
3. (ถ้าจะใช้ emulator) สร้าง `.env.development.local` มีบรรทัดเดียว: `VITE_USE_EMULATOR=1`
   — ไฟล์นี้ใช้เฉพาะ `npm run dev` ไม่ติดไปกับ production build

---

## 5. Login

```bash
npx firebase-tools login                     # บัญชี tinnapat.p@arise.tech
gcloud auth login                            # สำหรับคำสั่ง gcloud (เช่น IAM)
gcloud auth application-default login        # สำหรับสคริปต์ใน functions/*.cjs ที่อ่าน/เขียน Firestore
gcloud config set project wolfy-481609
```

---

## 6. คัด Memory ของ Claude เข้าที่

Claude Code อ่าน memory จาก `~/.claude/projects/<key>/memory/`
`<key>` = path ของโฟลเดอร์ที่เปิด Claude **แทน `/` ด้วย `-`**

| เปิด Claude ที่โฟลเดอร์ | key |
|---|---|
| `~/Downloads/claude_AIApp` (แบบที่ใช้อยู่ตอนนี้) | `-Users-<username>-Downloads-claude-AIApp` |
| `~/Downloads/claude_AIApp/agent-library` | `-Users-<username>-Downloads-claude-AIApp-agent-library` |

```bash
KEY="-Users-$(whoami)-Downloads-claude-AIApp"      # ปรับตามโฟลเดอร์ที่จะเปิด
mkdir -p ~/.claude/projects/$KEY/memory
cp ~/Downloads/claude_AIApp/agent-library/docs/memory/*.md ~/.claude/projects/$KEY/memory/
```

**กฎถาวร:** `docs/memory/` ใน repo คือ **ต้นฉบับ** — Claude แก้ memory เมื่อไหร่ต้องคัดลอกกลับมาที่ `docs/memory/` แล้ว commit

---

## 7. ตั้งค่า Claude Desktop (Code tab)

1. เปิดโปรเจกต์ที่โฟลเดอร์ `~/Downloads/claude_AIApp` (หรือ `agent-library` — ให้ตรงกับ key ในขั้นที่ 6)
2. ไฟล์ preview server `.claude/launch.json` (ให้ Claude เปิดเว็บ local ได้):
   - ถ้าเปิดที่ `claude_AIApp` สร้าง `~/Downloads/claude_AIApp/.claude/launch.json`:
     ```json
     {
       "version": "0.0.1",
       "configurations": [
         { "name": "vite-dev", "runtimeExecutable": "npm",
           "runtimeArgs": ["run", "dev", "--prefix", "agent-library"],
           "port": 5173, "autoPort": true }
       ]
     }
     ```
   - ถ้าเปิดที่ `agent-library` ใช้ `agent-library/.claude/launch.json` ที่อยู่ใน repo แล้ว
3. Plugin / connector ที่เคยใช้ (design-superpowers, design, frontend-design ฯลฯ) — ติดตั้งใหม่ผ่าน Claude Desktop ถ้ายังต้องการ
4. ข้อความแรกที่แนะนำให้พิมพ์:
   > เพิ่งย้ายเครื่อง อ่าน CLAUDE.md, docs/SYSTEM-OVERVIEW.md และ docs/MOVE-TO-NEW-MACHINE.md แล้วช่วยตรวจขั้นที่ 9 ให้หน่อย

---

## 8. สิ่งที่อยู่บน cloud และไม่ต้องย้าย (แต่ควรรู้ว่ามี)

| ของ | อยู่ที่ |
|---|---|
| Firebase Hosting | site `wolfy-481609` + `wolfy-ai-library` |
| Firestore | named DB `ai-agent-lib` (rules publish ผ่าน Console เท่านั้น) |
| Cloud Functions | project `wolfy-481609` region `asia-southeast1` (แชร์กับ Portfolio — deploy แบบ scoped เท่านั้น) |
| Secret | Secret Manager `TEAMS_FLOW_URL` (Teams/อีเมล) — ห้ามคัดลอกออกมา |
| แจ้งเตือน Delay/At-risk | Cloud Scheduler (จ. 09:30 / พฤ. 13:00) + Cloud Tasks queue `sendDelayDigest` · สวิตช์ `/config/alerts` |
| IAM ที่เพิ่มเมื่อ 2026-10-05 | compute SA มี `roles/cloudtasks.enqueuer` + `roles/iam.serviceAccountUser` (ไม่มี condition) |
| แจ้งเตือนอีเมล/Teams ทั่วไป | `/config/mail` (`provider: teams-flow`, `approverOverride`) |

---

## 9. ตรวจว่าเครื่องใหม่พร้อม (ทำให้ครบก่อน deploy อะไรก็ตาม)

```bash
cd ~/Downloads/claude_AIApp/agent-library
git log -1                                            # เห็น commit ล่าสุดเหมือนบน GitHub
git rev-list --left-right --count origin/main...HEAD  # ต้องได้ 0 0
npm run build                                         # ผ่าน = .env.local + deps ครบ
npx firebase-tools projects:list | grep wolfy-481609  # firebase login ใช้ได้
node functions/verify-delay-alerts.cjs --live         # ADC ใช้ได้ + ระบบแจ้งเตือนคำนวณตรงกับแอป
npx firebase-tools functions:list --project wolfy-481609 | grep -c "│ "   # อ่าน functions ได้
npx firebase-tools hosting:channel:deploy test-migration --project wolfy-481609 --expires 1d  # preview ไม่แตะ live
```
เปิดลิงก์ preview แล้ว login ได้ = พร้อมทำงานจริง

---

## 10. กฎที่ต้องจำ (สรุปจาก CLAUDE.md)

- Deploy production ต้องขออนุมัติทุกครั้ง · backup hosting เป็น channel ก่อน deploy (`hosting:clone <site>:live <site>:prod-backup-...`)
- **ห้าม** `firebase deploy` เปล่าๆ หรือ `--only functions` เปล่าๆ (จะลบ function ของ Portfolio) — ระบุชื่อ function เสมอ
- แก้ `firestore.rules` → ผู้ใช้ publish ผ่าน Console (DB `ai-agent-lib`) **ก่อน** deploy เว็บที่ใช้ field ใหม่
- สรุปผลให้ผู้ใช้เป็นภาษาไทยเสมอ · label/header ในเว็บเป็นภาษาอังกฤษ
- Claude เพิ่มสิทธิ์ IAM เองไม่ได้ (ถูกบล็อก) → ให้ผู้ใช้รันคำสั่ง `gcloud` เอง · ถ้าถาม condition (มี binding ของ Wiz) ตอบ **None**
