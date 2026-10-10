# DESIGN_GUIDE.md

This document defines the official UI/UX design system for TaxFlow.AI. All new pages, components, and modifications must adhere to these rules to maintain visual consistency and professional "Modern Enterprise FinTech" aesthetic.

## 1. Core Foundations

### 1.1 Color Palette
The application uses a layered background system to create depth. Always use the CSS variables instead of hardcoded hex values.

#### Backgrounds & Surfaces
| Variable | Dark Mode | Light Mode | Usage |
| :--- | :--- | :--- | :--- |
| `--bg` | `#060A13` | `#EDF1F9` | Root application background |
| `--bg2` | `#0A1120` | `#E4EAF6` | Secondary areas (Titlebar, Statusbar) |
| `--panel` | `#0C1425` | `#FFFFFF` | Sidebars, Modals, Inputs |
| `--card` | `#111B31` | `#FFFFFF` | Primary container surfaces |
| `--card2` | `#162341` | `#F1F5FC` | Hover states, secondary card areas |
| `--line` | `#1E2C4A` | `#DAE2F1` | Subtle borders, dividers |
| `--line2` | `#2B3D63` | `#C3CFE6` | High-contrast borders, active input outlines |

#### Typography Colors
| Variable | Dark Mode | Light Mode | Usage |
| :--- | :--- | :--- | :--- |
| `--tx` | `#E8EEFB` | `#0E1A33` | Primary text, headings |
| `--tx2` | `#A6B4D3` | `#43537A` | Secondary text, descriptions |
| `--tx3` | `#6F7FA3` | `#7484A8` | Muted text, disabled states, metadata |

#### Semantic Accent Colors
Use these for status indicators and primary actions.
- **Blue (`--blue`, `--blue2`)**: Primary branding, active navigation, main CTA.
- **Cyan (`--cyan`)**: AI-powered features, "Extracted" status, automation.
- **Green (`--green`)**: Success, "Approved", connected, verified.
- **Amber (`--amber`)**: Warnings, "Needs review", pending, overdue-soon.
- **Red (`--red`)**: Errors, "Overdue", critical failure.
- **Violet (`--violet`)**: Special categories (e.g., Generated files).

### 1.2 Typography
- **Primary Font**: `'Plus Jakarta Sans'`, sans-serif. (Clean, modern, professional).
- **Mono Font**: `'JetBrains Mono'`, monospace. (Used for IDs, file paths, and technical data).
- **Base Size**: `13.5px` / Line-height: `1.5`.
- **Hierarchy**:
  - `h1`: `22px`, Bold, `-0.2px` letter spacing.
  - `h2`: `14px`, Bold (used inside cards/panels).
  - `Small/Metadata`: `11.5px` to `12px` (`--tx3` color).

### 1.3 Geometry & Effects
- **Border Radii**:
  - `8px - 10px`: Small components (Buttons, Inputs, Chips).
  - `12px - 14px`: Large containers (Cards, Modals).
  - `99px`: Pills, Badges, Toggle switches.
- **Shadows**:
  - Primary: `0 10px 30px` with subtle opacity (approx `.35` dark / `.12` light).
- **Spacing System**:
  - **Standard Gap**: `14px` (Grid items, sibling components).
  - **Internal Padding**: `16px` (Inside cards and panels).

---

## 2. Component Library Rules

### 2.1 Buttons
All buttons must use the `.btn` base class.
- **Primary (`.btn.pri`)**: Blue gradient background, white text. Use for the main action on a page.
- **Default (`.btn`)**: `--card2` background, `--line2` border. Use for secondary actions.
- **Ghost (`.btn.gh`)**: No background. Use for tertiary actions or "Cancel" buttons.
- **Small (`.btn.sm`)**: Reduced padding for tight spaces (e.g., inside table rows).

### 2.2 Cards
The "Card" is the primary organizational unit.
- **Structure**:
  - `Container`: Background `--card`, Border `1px solid var(--line)`, Radius `14px`.
  - `Header (.card-h)`: Flex-between layout. Title on left, action button on right.
  - `Body (.card-b)`: Standard `16px` padding.
- **Hover State**: Transition to `--card2` background.

### 2.3 Forms & Inputs
- **Layout**: Labels must be placed above the input.
- **Styling**:
  - Background: `--panel`.
  - Border: `1px solid var(--line)`.
  - Focus State: Border changes to `--line2` or `--blue`.
- **Grid**: Use `.fields-grid-2` for side-by-side inputs to maintain balance.

### 2.4 Data Tables & Lists
- **Headers**: Bold text, `--tx2` color, subtle bottom border.
- **Rows**: Alternating or hover state using `--card2`.
- **Alignment**: Text left-aligned; numeric/currency data right-aligned.

---

## 3. Layout & UX Principles

### 3.1 Global Shell
Maintain the **Three-Column Enterprise Layout**:
- **Top**: Fixed `40px` Titlebar (Brand $\rightarrow$ Search $\rightarrow$ Controls).
- **Left**: Navigation Sidebar. Category groups must be clearly separated.
- **Center**: Main content area. Always use a standard `16px` or `20px` page margin.
- **Right**: Collapsible AI Chat panel.

### 3.2 UX Logic
- **Drill-down**: Navigation should move from General $\rightarrow$ Specific (e.g., Dashboard $\rightarrow$ Client $\rightarrow$ Document).
- **AI Signaling**: Any feature powered by AI must use the Cyan accent color or a "sparkle" icon to distinguish it from manual data.
- **Responsiveness**: Elements should wrap or hide based on window width, but the Sidebar should remain accessible (collapsed mode).

---

## 4. Developer Checklist for New Pages

When creating a new page, verify the following:
- [ ] **Colors**: Are all colors coming from CSS variables? (No hardcoded hex/rgb).
- [ ] **Typography**: Are headings using the correct size/weight? Is mono font used for technical IDs?
- [ ] **Spacing**: Is the standard `14px` gap used between cards? Is internal padding `16px`?
- [ ] **Components**: Are buttons using the correct variant (`.pri`, `.gh`)?
- [ ] **Hierarchy**: Is the most important action (CTA) the most visually prominent?
- [ ] **Contrast**: Is the text readable in both Dark and Light modes?
- [ ] **AI**: If this is an AI feature, is the Cyan accent used?
