# CloseLoop — 5-Minute Hackathon Demonstration Script
**Theme:** Best Bryntum Use / PayPal Payment Exception Resolution  
**Target Audience:** PayPal Hackathon Evaluators & Bryntum Judges  
**URL:** http://localhost:3000

---

## Act 1: The Problem & Executive Command Center (Minute 1)
1. **Navigate to `http://localhost:3000`:**
   - Present the executive command center with the banner: *"Financial operations. Under control."*
   - Point out the active live indicator in the header: **"PayPal Sandbox Connected"** (`APP-5T684724GD647783F`).
   - Highlight the 4 core subsystems: PayPal Developer Platform, Google Gemini AI Service, Deterministic Matching Engine, and Human Approval Gate.

## Act 2: Bryntum Grid 8.0 In Action (Minutes 2–3)
1. **Navigate to `http://localhost:3000/reconciliation`:**
   - Click **"Load Synthetic Sample Data"** (or inspect ingested PayPal Sandbox transactions).
   - Show the **"POWERED BY BRYNTUM GRID 8"** badge.
   - **Interact with Bryntum Grid:**
     - **Multi-Column Sort:** Click *Record ID*, *Variance*, or *Confidence* headers to demonstrate sorting.
     - **Quick Find:** Type `ORD-DEMO-001` or `MISMATCH` into the search bar to demonstrate instant row filtering.
     - **Column Resize & Reorder:** Drag column boundaries to adjust widths and rearrange columns.
     - **Visual Status Hierarchy:** Point out the green exact matches (`#00875A`), amber variances (`#D97706`), and red unmatched captures (`#D92D3F`).
     - **Master-Detail Drawer:** Click on any discrepancy row (e.g., `AMOUNT_MISMATCH`). The drawer slides out showing exact minor-unit comparisons, evidence grounding, and operator review controls.

## Act 3: Guided Scenarios & AI Evidence Grounding (Minute 4)
1. **Navigate to `http://localhost:3000/demo`:**
   - Present the 3 deterministic scenarios:
     1. **Amount Variance:** Fee and gross variance reconciliation.
     2. **Duplicate Payment:** Idempotency protection preventing double payouts.
     3. **Ambiguous Evidence:** AI safety suppression when transaction facts are incomplete.
   - Click **"Simulate Lifecycle"** to demonstrate the complete 7-stage pipeline: `DETECT → INVESTIGATE → DECIDE → APPROVE → ACT → VERIFY → CLOSE`.

## Act 4: Cryptographic Approvals & Safe Execution (Minute 5)
1. **Navigate to `http://localhost:3000/approvals`:**
   - Show how drafted recommendations require human sign-off with canonical parameter hashing (`canonical_parameter_hash`).
   - Execute a dry-run simulation and show the tamper-evident audit trail with the mandatory disclaimer:
     **`"SIMULATED — NO FINANCIAL ACTION WAS EXECUTED."`**

