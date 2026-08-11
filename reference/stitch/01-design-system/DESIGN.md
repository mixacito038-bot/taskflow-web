---
name: 衡效智舱 (Hengxiao Zhicang) Design System
colors:
  surface: '#f9f9ff'
  surface-dim: '#d8d9e2'
  surface-bright: '#f9f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f3fc'
  surface-container: '#ecedf6'
  surface-container-high: '#e7e8f0'
  surface-container-highest: '#e1e2eb'
  on-surface: '#191c22'
  on-surface-variant: '#424753'
  inverse-surface: '#2e3037'
  inverse-on-surface: '#eff0f9'
  outline: '#727784'
  outline-variant: '#c2c6d5'
  surface-tint: '#005bbe'
  primary: '#0052ac'
  on-primary: '#ffffff'
  primary-container: '#246bce'
  on-primary-container: '#ecf0ff'
  inverse-primary: '#acc7ff'
  secondary: '#4c5f80'
  on-secondary: '#ffffff'
  secondary-container: '#c4d8ff'
  on-secondary-container: '#4b5e7f'
  tertiary: '#8a3f00'
  on-tertiary: '#ffffff'
  tertiary-container: '#b05200'
  on-tertiary-container: '#ffede4'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d7e2ff'
  primary-fixed-dim: '#acc7ff'
  on-primary-fixed: '#001a40'
  on-primary-fixed-variant: '#004491'
  secondary-fixed: '#d6e3ff'
  secondary-fixed-dim: '#b4c7ed'
  on-secondary-fixed: '#051b39'
  on-secondary-fixed-variant: '#344767'
  tertiary-fixed: '#ffdbc8'
  tertiary-fixed-dim: '#ffb68b'
  on-tertiary-fixed: '#321200'
  on-tertiary-fixed-variant: '#753400'
  background: '#f9f9ff'
  on-background: '#191c22'
  surface-variant: '#e1e2eb'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  data-mono:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  container-margin: 24px
  gutter: 16px
  table-cell-padding: 12px 16px
  stack-compact: 8px
  stack-loose: 24px
---

## Brand & Style
The design system is engineered for high-stakes medical benefit analysis, targeting hospital administrators and financial controllers. The brand personality is **Clinical, Precise, and Administrative**, prioritizing data integrity and cognitive efficiency over decorative flair.

The visual style follows a **Corporate / Modern** approach with a focus on **Information Density**. It utilizes a structured, tiered layout to manage complex financial datasets and medical equipment lifecycle metrics. The aesthetic is "Trusted Tool" rather than "Consumer App," favoring subtle elevations, clear borders, and high-contrast typography to ensure data remains the primary focus.

## Colors
The palette is anchored by **Brand Blue (#246BCE)**, chosen for its association with medical reliability and financial stability. 

- **Background Strategy:** The light mode uses a specialized **Light Gray-Blue (#F4F7FA)** for the main workspace to reduce eye strain during prolonged administrative sessions.
- **Dark Mode:** A deep navy-based dark mode is provided for high-visibility meeting displays and command center environments.
- **Status Colors:** Semantic colors are calibrated for high legibility against both light and dark backgrounds, ensuring critical warnings and success states are immediately identifiable in dense data tables.
- **Neutral Scales:** High-utility greys are used for borders, subtle background layering, and secondary metadata.

## Typography
The typographic system utilizes **Inter** for its exceptional legibility and comprehensive support for tabular figures. 

- **Tabular Alignment:** All financial and numerical data must use **Tabular Numbers (`tnum`)** to ensure vertical alignment in tables, allowing administrators to scan and compare values rapidly.
- **Hierarchy:** We use a strict hierarchy where font size increases are modest to maintain high information density. 
- **Language Support:** For Chinese contexts, pair Inter with **PingFang SC**, ensuring weight matching across both scripts.
- **Mobile scaling:** Display and Headline-LG roles shift down by 4px on mobile devices to prevent excessive wrapping in data-heavy views.

## Layout & Spacing
This design system employs a **Fixed Grid** philosophy for desktop dashboards to ensure predictable placement of analytical widgets, while transitioning to a **Fluid Grid** for content-heavy reports.

- **Grid:** A 12-column grid is the standard for desktop, with 24px outer margins and 16px gutters.
- **Density:** To accommodate the "High-Density" requirement, vertical rhythm is based on a 4px baseline, with tighter-than-average padding in data tables (12px vertical padding) to maximize visible rows.
- **Breakpoints:**
  - **Desktop (1440px+):** Fixed container at 1320px.
  - **Tablet (768px - 1024px):** Fluid margins (24px), columns collapse to 6.
  - **Mobile (<768px):** Single column, 16px margins, vertical scrolling for all data widgets.

## Elevation & Depth
Depth is used sparingly to maintain a "Clinical" feel. We avoid heavy shadows in favor of **Tonal Layers** and **Low-Contrast Outlines**.

- **Surface 0 (Background):** #F4F7FA (Light Gray-Blue).
- **Surface 1 (Cards/Panels):** White (#FFFFFF) with a 1px border (#E2E8F0).
- **Surface 2 (Overlays/Modals):** White with a subtle "Ambient Shadow" (0px 4px 12px rgba(0, 0, 0, 0.05)).
- **Depth in Dark Mode:** Elevation is communicated through increasing brightness of the background hex, rather than shadows.

## Shapes
The shape language is controlled and professional.
- **Standard Cards:** 12px (rounded-lg) for main dashboard containers to provide a modern, organized feel.
- **Interactive Elements:** Buttons and Input fields use a 6px (rounded-md) radius to maintain a more "functional" and "precise" appearance compared to the softer cards.
- **Data Visualizations:** Chart bars and progress indicators should use minimal rounding (2px) to ensure data accuracy is not visually distorted by large radii.

## Components
- **Buttons:** Primary buttons use #246BCE with white text. Secondary buttons use a subtle gray-blue ghost style. All buttons have a 6px radius and height variants: Compact (32px), Default (40px).
- **High-Density Tables:** The core of the platform. Row height is set to 48px. Use alternating row stripes (Zebra) in #F8FAFC. Headers are sticky with a distinct bottom border.
- **Data Cards:** 12px rounded corners, white background, 1px border. Title area should have a consistent 16px bottom margin from the content.
- **Status Chips:** Small, condensed labels with 2px radius and subtle background tints (e.g., Success: #138A63 at 10% opacity with solid text).
- **Input Fields:** 1px #CBD5E1 border, 6px radius. Focus state uses a 2px outer glow of #246BCE at 20% opacity.
- **Analytical Widgets:** Custom components for "Equipment Utilization" and "ROI Analysis" should utilize clean line graphs and donut charts using the primary and status palettes.