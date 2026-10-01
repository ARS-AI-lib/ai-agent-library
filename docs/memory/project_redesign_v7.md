---
name: project-redesign-v7
description: Redesign V7 approved 2026-10-01 (supersedes v4); being built locally on branch redesign-v7 against emulators — no push/deploy until user allows
metadata:
  type: project
---
V7 approved 2026-10-01: https://claude.ai/artifact/TQd2iLmAWS6JdGvK1vJAbw (v6 base + v6.2 grouped ☰ menu; supersedes [[project-redesign-v4]]).

Locked decisions: muted text #5f6b85 (not Dashboard); Detail = Edit Details + More menu, keep current progress/deploy block (user rejected 5-step stepper); Register = 2 steps "Fill in details > Analysis"; Sort + Cards/List toggle; Dashboard visuals unchanged; all actions/conditions must match current code ("ไม่ควรเปลี่ยนวิธีการใช้งานของ user").

**Why:** user said "ห้ามยุ่งกับ Production เด็ดขาดจนกว่าฉันจะอนุญาต".
**How to apply:** work only on local branch `redesign-v7`; app uses emulators via `.env.development.local` VITE_USE_EMULATOR=1; seed via `functions/seed-emulator.cjs` (export reads prod read-only, import writes emulator only, forces mail provider none). Emulator login = test buttons on LoginScreen (USING_EMULATOR only). Never git push / firebase deploy / hosting channel for this work without explicit permission. Plan: ~/.claude/plans/ai-glistening-firefly.md.
