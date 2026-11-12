# CloseLoop Design System: PayPal Enterprise Financial Technology
**Authoritative UI & UX Specification for Bryntum Showcase**

## 1. Design Philosophy
CloseLoop is an enterprise financial operations command center built to detect, investigate, authorize, and resolve PayPal payment exceptions. It adopts the trusted, precise aesthetic of PayPal enterprise developer and merchant platforms, elevating **Bryntum Grid 8.0** as the primary interactive financial instrument.

---

## 2. Token System

### 2.1 Brand Identity & Accents
- **PayPal Deep Navy:** `#003087` (Brand headings, focused navigation, high-contrast badges)
- **Primary Action Blue:** `#0070E0` (Active states, key call-to-actions, primary highlights)
- **Secondary Blue:** `#009CDE` (Subtle indicators, secondary badges, link hovers)
- **Operational Navy:** `#071B3A` (Persistent enterprise sidebar, terminal framing)

### 2.2 Surfaces & Borders
- **Main Canvas:** `#F5F8FC`
- **Card Surface:** `#FFFFFF`
- **Subtle Blue Tint:** `#EFF6FF`
- **Micro Borders:** `#DFE7F1` (1px clean contrast borders)
- **Muted Dividers:** `#EAF0F6`

### 2.3 Status Hierarchy
- **MATCHED / RECONCILED / READY:** `#00875A` (Emerald green badge: `bg-[#E8F8F0] text-[#00875A] border-[#B2ECC8]`)
- **DISCREPANCY / VARIANCE / MANUAL REVIEW:** `#D97706` (Amber badge: `bg-[#FEF6E7] text-[#D97706] border-[#FCE3B4]`)
- **UNMATCHED / CRITICAL / FAILED:** `#D92D3F` (Crimson rose badge: `bg-[#FEECEC] text-[#D92D3F] border-[#FAC0C4]`)
- **PENDING / INVESTIGATION:** `#0070BA` (PayPal blue badge: `bg-[#EFF6FF] text-[#003087] border-[#BFDBFE]`)
- **CONTROLLED SIMULATION:** `#6366F1` (Indigo simulation indicator)

---

## 3. Typography & Numerical Precision
- **Primary Text:** Geist Sans / system-ui (`text-[#10243E]`)
- **Monospace Financial Data:** Geist Mono / font-mono (`tabular-nums`)
- **Monetary Amounts:** Always rendered via `formatMoney` with currency symbol, integer minor unit precision, and tabular numeral alignment.

