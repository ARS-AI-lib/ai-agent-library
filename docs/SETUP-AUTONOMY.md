# SETUP-AUTONOMY.md — ตั้งค่าให้ Claude Code ทำงานเองได้ (commit / push / deploy)

> เขียน 2026-10-28 · คู่กับ `docs/MOVE-TO-NEW-MACHINE.md` (ข้อ 10 ของไฟล์นั้นคือกฎที่ยังต้องคงไว้)
> จุดประสงค์: ให้ Claude Code ในเครื่องนี้ commit / push / build / deploy ได้เองโดยไม่ต้องกดอนุมัติทุกคำสั่ง
> **แต่ยังคง 2 กฎเหล็กของโปรเจกต์ไว้:** ห้าม unscoped functions deploy · Firestore rules publish ผ่าน Console เท่านั้น
>
> **สถานะสุดท้าย (2026-10-29):** **แก้ไฟล์ + commit ทำงานเองได้ ✅** · **push + deploy ยังต้องรันจาก Terminal ของผู้ใช้** (sandbox เป็น managed policy, build นี้ไม่มีที่ตั้งค่า — **ผู้ใช้ยอมรับแล้ว**)
> ขั้น 3 ไม่ต้องทำ (token `ai-lib` ถึง 5 Jan 2027) · ขั้น 4 ทำแล้ว
> 🔒 **กฎถาวร (ผู้ใช้ล็อก 2026-10-29):** Claude ต้อง **หยุดถามก่อน deploy production ทุกครั้ง** — ดู §6 ข้อ 5
> 🔧 **ต้องใช้ binary `firebase` (global `~/.local/bin/firebase`) แทน `npx firebase-tools` ในแชท** — รายละเอียด §8

---

## 0. ทำไมตอนนี้ Claude ยังทำเองไม่ได้ — มี 3 ชั้นแยกกัน ไม่ใช่ปัญหาเดียวกัน

| ชั้น | อาการที่เห็น | ต้นเหตุ |
|---|---|---|
| 1. Permission | ขึ้นกล่องถามอนุมัติ, หรือบางที "cannot determine the safety ... temporarily unavailable" แล้วคำสั่งล้มเลย | permission mode = `auto` (classifier ตัดสิน) — classifier มี rate limit / timeout |
| 2. Sandbox | `CONNECT tunnel failed, response 403` + `<sandbox_violations> deny network-outbound github.com:443` | sandbox ดัก network ด้วย allowlist ที่คุมจาก policy — `allowed_domains` ของคำสั่งขยายไม่ได้ |
| 3. Credentials | `Authentication failed` / `permission denied (publickey)` | GitHub PAT ใน keychain หมดอายุ · firebase login · gcloud ADC |

**สำคัญ:** ทั้ง 3 ชั้นนี้ต้องแก้คนละที่ การแก้ชั้น 1 ไม่ช่วยชั้น 2 เลย (บทเรียนจาก session 2026-10-28: push ล้มเพราะชั้น 2 ทั้งที่ layer 1 ผ่าน และ token ยังไม่หมดอายุจริง)

---

## 1. ชั้น Permission — ให้ไม่ต้องกดอนุมัติ

มี 3 ระดับ เลือกตามความสบายใจ (ใส่ใน `.claude/settings.local.json` = ส่วนตัว + gitignore แล้ว ไม่หลุดขึ้น git)

### ระดับ A — allow-list เฉพาะงานประจำ (แนะนำ)

เปิดไฟล์ `.claude/settings.local.json` (ถ้าไม่มี ให้สร้าง) แล้วใส่:

```json
{
  "permissions": {
    "allow": [
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git push:*)",
      "Bash(git fetch:*)",
      "Bash(npm run build)",
      "Bash(npx firebase-tools deploy --only hosting:*)",
      "Bash(npx firebase-tools hosting:channel:deploy:*)",
      "Bash(npx firebase-tools hosting:clone:*)",
      "Bash(node functions/verify-*)"
    ]
  }
}
```

- ข้อดี: ไม่ถามงานที่ทำทุกวัน **แต่ยังถามตอน deploy production** → ตรงกับ CLAUDE.md §11
- `permissions.allow` ของ project (`.claude/settings.json`) ยังทำงานอยู่ ไม่ต้องก๊อปมาซ้ำ

### ระดับ B — ไม่ถามเลยทุกคำสั่ง

```json
{
  "permissions": { "defaultMode": "bypassPermissions" }
}
```

- ไม่มีกล่องอนุมัติเลย **ไม่พึ่ง classifier** → หายปัญหา "temporarily unavailable" ทั้งหมด
- ครั้งแรกที่เปิด จะมี dialog ให้กดยอมรับ (เก็บสถานะไว้ที่ `skipDangerousModePermissionPrompt`)
- ⚠️ เท่ากับยกกฎ "deploy ต้อง confirm" ออกทั้งหมด — **ยกเลิก §11 ในทางปฏิบัติ**
  ถ้าเลือกอันนี้ อย่างน้อยควรคง `permissions.ask` ไว้ดักคำสั่ง deploy:

```json
{
  "permissions": {
    "defaultMode": "bypassPermissions",
    "ask": ["Bash(npx firebase-tools deploy:*)"]
  }
}
```

### ระดับ C — เปลี่ยนเฉพาะ session ปัจจุบัน

ไม่ต้องแก้ไฟล์ — กดปุ่ม permission mode ในแถบล่างของหน้าต่างแชท เลือก `Bypass permissions`
(มีผลกับ session นี้เท่านั้น ปิดแล้วกลับเป็นค่าเดิม — เหมาะเวลาจะปล่อยให้ทำงานยาว ๆ รอบเดียว)

---

## 2. ชั้น Sandbox / Network — ให้ `git push` + `firebase deploy` ออกเน็ตได้

### 2.1 ต้องรู้ก่อน: allowlist นี้มาจากไหน

ใน session 2026-10-28 ระบบตอบว่า *"allowed_domains cannot widen network access in this session: the configured sandbox allowlist is the whole allowlist here (a managed-domains-only or strictAllowlist policy, or a confined evaluation run)"*
→ แปลว่า allowlist ถูกกำหนดจาก **user settings / managed settings / ตัวแอป** ไม่ใช่จาก project settings
→ **`.claude/settings.json` ของโปรเจกต์เติม domain ไม่มีผล** ในโหมดนี้ (schema ระบุชัด: เมื่อ `strictAllowlist` หรือ `allowManagedDomainsOnly` เปิด ค่าจาก project settings จะถูกเมิน)

### 2.2 แก้ที่ `~/.claude/settings.json` (user settings)

เพิ่มกล่อง `sandbox` เข้าไป (ไฟล์นี้ถือ token อยู่ — **ห้าม commit ห้ามส่งในแชท**):

```json
{
  "sandbox": {
    "network": {
      "allowedDomains": [
        "github.com",
        "api.github.com",
        "codeload.github.com",
        "*.githubusercontent.com",
        "registry.npmjs.org",
        "*.npmjs.org",
        "*.googleapis.com",
        "*.google.com",
        "*.gstatic.com",
        "*.firebaseio.com",
        "*.firebaseapp.com",
        "*.web.app",
        "*.cloudfunctions.net",
        "*.run.app"
      ]
    }
  }
}
```

หมายเหตุ:
- `*.googleapis.com` ครอบ Firebase/GCP แทบทั้งหมด (`firebase`, `firestore`, `cloudfunctions`, `cloudbuild`, `artifactregistry`, `serviceusage`, `iam`, `cloudresourcemanager`, `storage`, `oauth2`, `secretmanager`, `cloudtasks`, `cloudscheduler`, `logging` …)
- ถ้าอยากให้ส่วนวิเคราะห์ของ Google Analytics/Cloud Logging ทำงานครบ ให้เพิ่ม `*.google-analytics.com` ได้ แต่ไม่จำเป็นต่อ deploy
- **บรรทัดเดียวที่ต้องมีจริง ๆ สำหรับงานนี้:** `github.com`, `api.github.com`, `registry.npmjs.org`, `*.googleapis.com`

### 2.3 ถ้าแก้แล้วยังถูกบล็อก = allowlist เป็น managed policy ✅ **เคสนี้คือสิ่งที่เกิดขึ้นจริง (ยืนยัน 2026-10-29)**

กรณีนี้ผู้ใช้ widen ไม่ได้เอง — และ **build นี้ไม่มี section Sandbox / Allowed domains ใน Settings เลย** (ตรวจ 2026-10-29)
→ ยืนยันว่า sandbox ไม่ใช่ค่าที่ผู้ใช้ตั้งเองได้จากหน้านั้น

เหลือ 3 ทาง:

0. **⭐ Bypass permissions ตอนเปิด session** — sandbox ถูกปลดเมื่อ session เริ่มด้วย `--dangerously-skip-permissions`
   ⚠️ **สลับกลาง session ไม่ได้** — ระบบปฏิเสธ: *"Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions"*
   → ต้องเปิด toggle ใน **Settings → Claude Code ก่อน** แล้ว **เปิด session ใหม่** จึงมีผล
   ⚠️ ในโหมดนี้ `ask[]` ใน settings **อาจถูกข้าม** — กฎ "production deploy ต้อง confirm" จะเหลือเป็นวินัยของ Claude ไม่ใช่กลไกบังคับ → ต้องย้ำเตือนตัวเองทุกครั้ง (CLAUDE.md §11)
1. **รัน deploy/push จาก Terminal ของตัวเอง** (ทางที่ใช้ได้เสมอ — พิสูจน์แล้ว 2026-10-28 ว่า `git push` สำเร็จ) แล้วให้ Claude เตรียมคำสั่งไว้ให้
2. **ให้ K.Ko เปิด domain ใน managed policy** ถ้าเป็นนโยบายองค์กร

### 2.4 Filesystem

sandbox เขียนได้เฉพาะ `cwd` + `$TMPDIR` + `~/.npm/_logs` + `~/.claude/debug`
→ `git` / `npm` / `npx firebase-tools` เขียนในโปรเจกต์และ `~/.npm` ปกติอยู่แล้ว ไม่ต้องแก้อะไร
⚠️ **`.claude/settings.json` และ `.claude/settings.local.json` ถูก deny เขียนจาก sandbox** — Claude แก้ไฟล์นี้เองไม่ได้ ต้องแก้ด้วยมือ (นี่คือเหตุผลที่คู่มือนี้ให้ผู้ใช้ทำ)

---

## 3. ชั้น Credentials

### 3.1 GitHub — เลือกทางใดทางหนึ่ง

**ทางที่ 1 (เดิม): PAT ใน keychain** ✅ ยังใช้ได้ ไม่ต้องทำอะไรตอนนี้
- token ชื่อ **`ai-lib`** — สร้าง **2026-08-05** · **หมดอายุ Tue 5 Jan 2027** (≈153 วัน)
  ⚠️ อย่าเชื่อตัวเลขเดิม "2026-11-03 / 90 วัน" ในเอกสารเก่า — ตรวจจากหน้า GitHub จริง 2026-10-29
- **scope: 5 repo ของ `ARS-AI-lib` พร้อมกัน** — `AI_Agent_lib` · `AI_Portfolio` · `ai-agent-library` · `ai-governance` · `vote`
  (ไม่ใช่ repo เดียว: `Contents: Read and write` + Metadata read) → **repo ใหม่ใน org นี้ต้องแก้ token เพิ่ม**
- ต่ออายุเมื่อถึงเวลา: https://github.com/settings/tokens?type=beta
  · **Regenerate token** บนหน้าเดิมได้ แต่ค่าจะเปลี่ยน → ต้องอัปเดต keychain ใหม่ (ข้อ 2 ด้านล่าง)
  · หรือ Generate new + ตั้ง Expiration ยาวกว่าเดิม
- ล้างค่าเก่าใน keychain ก่อน แล้ว push ใหม่ (จะถาม password → วาง token):

```bash
git credential-osxkeychain erase
```

(พิมพ์ `host=github.com` Enter, `protocol=https` Enter, Enter อีกที)

```bash
cd ~/Downloads/Claude/agent-library && git push origin main
```

**ทางที่ 2 (ดีกว่า — แนะนำ): ใช้ SSH key แทน token**
- ไม่มีวันหมดอายุ ไม่ต้องกรอกอะไรเลย Claude push ได้ทันทีถ้า sandbox เปิดทาง
- สร้าง key + ใส่ใน GitHub → Settings → SSH and GPG keys:

```bash
ssh-keygen -t ed25519 -C "tinnapat.p@arise.tech" -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub
```

```bash
git remote set-url origin git@github.com:ARS-AI-lib/ai-agent-library.git
```

- ⚠️ ถ้าใช้ SSH ต้องเปิด domain `github.com` + เปิด `sandbox.network.allowUnixSockets` ให้ ssh-agent (macOS) หรือใช้ `ssh -T git@github.com` ทดสอบก่อน

### 3.2 Firebase CLI

```bash
npx firebase-tools login:list
```

ต้องเห็น `tinnapat.p@arise.tech` ถ้าไม่เห็น/หมดอายุ:

```bash
npx firebase-tools login
```

### 3.3 gcloud Application Default Credentials (จำเป็นเฉพาะสคริปต์ verify)

ต้องมี ADC: `regression.cjs`, `calibrate.cjs`, `verify-*.cjs`, `bootstrap-vectors.cjs`, `flag-internal.cjs`
**งาน deploy ปกติไม่ต้องใช้**

```bash
gcloud auth application-default login
```

---

## 4. Deploy "test" (preview channel) — ปลอดภัย ทำเองได้เลย

ไม่แตะ live ได้ URL ชั่วคราว (อายุ ~7 วัน):

```bash
npx firebase-tools hosting:channel:deploy test-<ชื่อเล่น> --project wolfy-481609
```

- เหมาะให้ Claude เปิด preview ให้ดูก่อน promote
- ลบ channel ทีหลัง: `npx firebase-tools hosting:channel:delete test-<ชื่อเล่น> --project wolfy-481609`

---

## 5. Deploy Production — ลำดับที่ต้องทำ

```bash
npm run build
```

**สำรองก่อน (แนะนำทุกครั้งที่ deploy จริง):**

```bash
npx firebase-tools hosting:clone wolfy-481609:live wolfy-481609:prod-backup-2026-10-28 --project wolfy-481609
```

**Deploy hosting** (ทั้ง 2 target: `main`=wolfy-481609 และ `pretty`=wolfy-ai-library ตาม `.firebaserc`):

```bash
npx firebase-tools deploy --only hosting --project wolfy-481609
```

**ถ้าแก้ Cloud Functions — ต้อง scope เสมอ:**

```bash
npx firebase-tools functions:list --project wolfy-481609
```

```bash
npx firebase-tools deploy --only functions:<ชื่อที่แก้จริง> --project wolfy-481609
```

**แก้ `firestore.rules` → publish ผ่าน Firebase Console เท่านั้น** (named DB dropdown `ai-agent-lib`) — automate ไม่ได้และไม่ควร automate

---

## 6. ⛔ 5 อย่างที่ห้ามให้ Claude ทำเอง (คงไว้เสมอ ไม่ว่า permission mode ไหน)

1. **`firebase deploy` เปล่า ๆ หรือ `--only functions` เปล่า ๆ** — GCP project `wolfy-481609` แชร์กับแอป Portfolio → unscoped deploy จะเสนอ **ลบ** functions ของ Portfolio (`files`, `logProjectActivity`, `logTaskActivity`) และตัว legacy อื่น ๆ
2. **Publish Firestore rules ผ่าน CLI** — ต้องผ่าน Console + named DB `ai-agent-lib` เท่านั้น
3. **แตะ secrets** — `TEAMS_FLOW_URL` (Secret Manager), `.env.local`, `GMAIL_*` — ห้ามลง git/แชท
4. **`firebase deploy` ตอนยังไม่ build** — ต้อง `npm run build` ก่อนเสมอ ไม่งั้น deploy ของเก่า
5. 🔒 **Production deploy ต้องหยุดถามก่อนทุกครั้ง — กฎถาวร ผู้ใช้ล็อก 2026-10-29**
   เหตุผลที่ต้องเป็นกฎเหล็ก: ในโหมด `bypassPermissions` **ไม่มีกล่องอนุมัติเลย** และ `ask[]` ใน settings **อาจถูกข้าม**
   → กฎนี้จึงเป็น **วินัยของ Claude ไม่ใช่กลไกบังคับ** · ห้าม deploy production จบในลูปเดียวโดยไม่รายงาน
   · ห้าม push/deploy ไป repo หรือ hosting site ของ **Portfolio** แม้ token `ai-lib` จะให้สิทธิ์ก็ตาม

👉 ข้อ 1-4 เขียนไว้ใน `.claude/settings.json` (comment บรรทัด DEPLOY IS DELIBERATELY ABSENT) + `ask[]` ใน `settings.local.json` แล้ว — **ถ้าไม่ได้ตั้งใจจะยกเลิกกฎนี้ อย่าใส่ deploy ลง allow-list**

---

## 7. Checklist — ทำตามลำดับ

- [x] ~~เลือก permission mode (ระดับ A/B/C ในข้อ 1) แล้วแก้ `.claude/settings.local.json`~~ — **ทำแล้ว 2026-10-29** (ระดับ A)
- [x] ~~เพิ่ม `sandbox.network.allowedDomains` ใน `~/.claude/settings.json`~~ — **ทำแล้ว 2026-10-29** (15 domain)
- [x] ~~ตัดสินใจเรื่อง GitHub credential~~ — **ไม่ต้องทำแล้ว:** token `ai-lib` ใช้ได้ถึง **5 Jan 2027** และครอบ 5 repo (ข้อ 3.1 ทาง 1)
  · กลับมาดูอีกครั้งราว **ธ.ค. 2026**
- [x] ~~`firebase login:list` เห็น `tinnapat.p@arise.tech`~~ — **ผ่านแล้ว 2026-10-29**
- [ ] (ถ้าจะรัน verify scripts) `gcloud auth application-default login`
- [x] ~~ปิดหน้าต่างแชทแล้วเปิด session ใหม่~~ — **ทำแล้ว 2026-10-29** (allowlist มีผลทันที ไม่ต้องรอ restart ด้วยซ้ำ)
- [x] ~~ทดสอบ 3 อย่าง~~ — **ผลจริง: 1 ✅ · 2 ✅ · 3 (build) ✅ · 4 (channel deploy) ❌** → sandbox เป็น managed policy
- [ ] **งานที่เหลือ = push/deploy จาก Terminal ของผู้ใช้** (ผู้ใช้ยอมรับแล้ว ไม่ต้องแก้อะไรเพิ่ม)
  · `git push origin main` · `firebase hosting:channel:deploy <name>` · `firebase deploy --only hosting` (ดู §5)
- [ ] กลับมาดู **token `ai-lib` หมดอายุ 5 Jan 2027** → ราว ธ.ค. 2026

---

## 8. ทดสอบว่าใช้ได้จริง — ผลรันจริง 2026-10-29 (session ใหม่)

| # | คำสั่ง | ผล | ชั้นที่เป็นปัญหา |
|---|---|---|---|
| 1 | `git rev-list --left-right --count origin/main...HEAD` | ✅ `0 0` | — |
| 2 | `git status --short` | ✅ | — |
| 3 | `npm run build` | ✅ built in 420ms (3 ไฟล์) | — |
| 4 | `firebase hosting:channel:deploy smoke-test --project wolfy-481609` | ❌ | **ชั้น 2 — Sandbox network** |

deny ที่เจอในข้อ 4:
```
deny network-outbound www.googleapis.com:443 (user denied)
deny network-outbound firebase-public.firebaseio.com:443 (user denied)
```
**ทั้งที่ `~/.claude/settings.json` ใส่ `*.googleapis.com` ไว้แล้ว** → allowlist ที่มีผลมาจาก policy ระดับสูงกว่า user settings
→ **sandbox ยังเปิดทางให้ใน session นี้ไม่ได้** ต้องใช้ทางเลือกใน §2.3

---

### 🔴 2 บทเรียนจากรอบนี้ (สำคัญ — อย่าลืม)

**(1) ใช้ binary `firebase` ตรง ๆ ห้ามใช้ `npx firebase-tools`**
`firebase` global ติดตั้งอยู่ที่ `~/.local/bin/firebase` (v15.32.1) เรียกได้เลย
ส่วน `npx` ต้องยิง `registry.npmjs.org` เพื่อเช็ค metadata **ก่อน**จะรันอะไร → โดน deny ทันที
⚠️ **คำสั่ง `npx firebase-tools …` ทุกที่ในเอกสารนี้ (รวม CLAUDE.md §11) → ใช้ `firebase …` แทน**

**(2) `Authentication Error: Your credentials are no longer valid` ตอน deploy = กับดัก ไม่ใช่ token หมดอายุ**
เกิดจาก CLI ต่อ Google ไม่ออกเพื่อ validate token (sandbox บล็อก) → error เป็น**ผลพลอยได้** ไม่ใช่ต้นเหตุ
พิสูจน์: `firebase login:list` → `Logged in as tinnapat.p@arise.tech` ✅ (ชั้น 3 credential ไม่มีปัญหาเลย)
⛔ **อย่าสร้าง token GitHub ใหม่เพราะ error นี้** — คนละระบบกันคนละชั้น

---

### คำสั่งทดสอบ (ฉบับแก้แล้ว — ใช้ `firebase`)

```bash
git rev-list --left-right --count origin/main...HEAD
```

ต้องได้ `0 0` ก่อน deploy ใด ๆ

```bash
firebase login:list
```

ต้องเห็น `Logged in as tinnapat.p@arise.tech`

```bash
firebase hosting:channel:deploy smoke-test --project wolfy-481609
```

ถ้าข้อนี้ผ่าน = sandbox เปิดทางแล้ว (ทำงาน autonomous ได้เต็มรูปแบบ) · ถ้ายังโดน deny = ใช้ §2.3

---

## 9. บริบท: ทำไมต้องมีไฟล์นี้

- Claude Code อ่าน memory จาก `~/.claude/projects/<key>/memory/` โดย `<key>` มาจาก path ของ cwd → **ย้ายเครื่อง key เปลี่ยนเสมอ**
- `.claude/settings.local.json` ไม่ขึ้น git (ตั้งใจ) → ย้ายเครื่องต้องตั้งใหม่
- ไฟล์นี้คือคู่มือตั้งค่าที่ **port ข้ามเครื่องได้** ส่วน `docs/memory/` คือ memory ที่ port ได้เช่นกัน

**อัปเดตไฟล์นี้ทุกครั้งที่เปลี่ยนวิธีตั้งค่า** ไม่งั้นรอบหน้าจะเจอปัญหาเดิมซ้ำแล้วเสียเวลาดีบักอีกรอบ
