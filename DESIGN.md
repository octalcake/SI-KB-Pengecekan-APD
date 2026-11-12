---
name: Inspeksi K3
description: A precise operational workspace for construction safety inspections.
colors:
  action: "#a24e35"
  action-hover: "#91462f"
  action-surface: "#f6e7df"
  clay: "#d97757"
  navigation: "#f0eee6"
  navigation-text: "#5e5a52"
  navigation-hover: "#e8e3d9"
  navigation-selected: "#ebd9cc"
  canvas: "#faf9f5"
  surface: "#fffefb"
  subtle: "#f0eee6"
  border: "#e2ddd3"
  control-border: "#948c80"
  ink: "#292824"
  secondary-ink: "#5e5a52"
  muted-ink: "#716b62"
  success: "#226747"
  warning: "#83550e"
  error: "#ac3833"
typography:
  headline:
    fontFamily: "Public Sans, Segoe UI, sans-serif"
    fontSize: "1.8rem"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Public Sans, Segoe UI, sans-serif"
    fontSize: "1.05rem"
    fontWeight: 650
    lineHeight: 1.3
  body:
    fontFamily: "Public Sans, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Public Sans, Segoe UI, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 550
rounded:
  control: "6px"
  surface: "12px"
spacing:
  control-gap: "8px"
  group: "16px"
  section: "32px"
  desktop-inset: "40px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "0.55rem 0.95rem"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "40px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "40px"
  work-surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
---

# Design System: Inspeksi K3

## Overview

**Creative North Star: "The Site Briefing"**

A restrained professional interface for officers working through inspections and evidence. A Claude-inspired palette pairs ivory work surfaces and a cream navigation rail with charcoal text and muted clay accents. Hierarchy comes from alignment, space, and readable typography rather than decoration.

**Key Characteristics:**
- Persistent, familiar navigation.
- Compact controls and explicit actions.
- Plain Indonesian task language.
- Evidence and provenance remain visible.

## Colors

Deep terracotta identifies primary actions, links, focus, and selected controls. Lighter clay marks the brand, while warm ivory, cream, and oat neutrals separate the canvas, work surfaces, and controls. Navigation and the login introduction use a light cream ground with charcoal headings. The deeper action shade preserves readable white button labels.

Success, warning, and error colors describe actual states. A zero count, missing result, or unavailable model must never receive a safe-state treatment.

**The Action Rule.** Reserve deep terracotta for actions, links, focus, and selection; keep clay accents sparse.

## Typography

Public Sans carries headings, body text, controls, and data. The variable font is self-hosted in `frontend/static/fonts/` with its Open Font License. There is no runtime font service dependency.

Page headings reduce to 1.55rem on narrow screens. Body copy stays within 72 characters where possible. Data uses tabular numerals. Monospace is reserved for identifiers, hashes, code, and measurements.

**The Reading Rule.** Touch-screen form inputs use at least 16px text; compact metadata must retain readable contrast.

## Layout

Desktop uses a fixed navigation rail (224px, reducing to 200px below 1100px), a contextual header, and a work area with a maximum width of 1500px. Main desktop insets follow the spacing tokens.

At 900px and below, the rail becomes a fixed five-destination bottom navigation. The content includes bottom space and scroll padding so controls remain reachable. Narrow layouts reflow forms and work columns rather than shrinking their typography.

Creation forms and advanced filters open inline through standard disclosures. Preserve entered values when a disclosure is closed. Lists, evidence, and the current task take precedence over configuration explanations.

## Elevation & Depth

The shared system uses warm ivory surfaces and quiet borders, without decorative shadows. Tonal layers indicate the workspace, field state, or grouped information. Evidence viewers and protected confirmation flows retain their functional overlays.

## Shapes

Controls have compact corners; work surfaces use the larger radius token. Small state labels can use tighter corners. Avoid repeated frames around otherwise related content. Icons use a consistent outlined SVG vocabulary with a 24-unit view box and 1.65-unit stroke.

## Components

Primary buttons have a deep terracotta fill and white text. Secondary buttons use an ivory surface and a clear border; quiet actions use text and a hover surface. Standard controls are at least 40px high, increasing to 44px on narrow or coarse-pointer devices.

Inputs have visible labels, a quiet border, clear invalid states, and a contrasting focus outline. Disabled fields use the subtle neutral surface. Password visibility is an explicit toggle.

Navigation marks the current route with both a surface change and `aria-current`. Keyboard users receive a skip link and visible focus. Background and color transitions are brief (150ms); reduced motion removes transitions and animation.

Status treatments always include text. Real, simulated, and manual observations retain distinct provenance. Pending review, confirmed decisions, source changes, and approved locks remain explicit.

## Copy

Use plain Indonesian and short action labels: “Tambah foto,” “Simpan laporan,” “Ambil data terbaru.” Errors name the problem and give the next action. Remove slogans, repeated instructions, API codes, and implementation explanations from routine screens. Keep warnings about simulation, unreviewed findings, changed report sources, and irreversible approval.

Use “Beranda,” “temuan,” “pemeriksaan,” “tindak lanjut,” “draf,” and “templat” consistently. A model result is an indication; an officer confirms or rejects it. Friendly language should help the task without jokes or forced slang. Gojek's [login recovery copy](https://www.gojek.com/id-id/help/akun/login-link-tidak-bisa-digunakan) is a reference for direct instructions.

## Do's and Don'ts

- Do lead with the officer's task and its next action.
- Do preserve evidence, provenance, error recovery, and protected states.
- Do use native forms, disclosures, and familiar navigation.
- Do check desktop, narrow portrait, and touch landscape layouts.
- Don't put implementation instructions in routine task copy.
- Don't invent inspection statistics or imply safety from missing data.
- Don't use decorative gradients, module eyebrows, or icon tiles as page structure.

Implementation authority: `frontend/src/app.css` and the shipped components. Route-specific composition belongs in the surface brief, not these shared rules.
