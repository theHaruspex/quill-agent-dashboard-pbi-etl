
# Quill Docs Gathering Team – Real-Time Dashboard
## Data Schema & Integration Design Document

**Author:** Derious Vaughn  
**Audience:** CTO & Engineering Leadership  
**Revision:** v1 – November 2025

---

## 1. 🎯 Project Objective

Build a **real-time, shift-aware dashboard** in Power BI that visualizes outbound productivity metrics (calls, texts, emails, cases) by agent, with **color-coded progress indicators** and **dynamic time filters**.

The dashboard will provide each agent with a live view of their performance versus goals, normalized across multiple data sources (Aloware, HubSpot, Treads) and timezones.

---

## 2. 🧩 Overview of Data Model

The schema follows a **star architecture**:

- **FactEvent**: Canonical source of truth (atomic events).
- **DimAgent, DimMetric, DimDate, DimShift**: Descriptive dimensions enriching the fact table.
- Aggregation is handled entirely within **Power BI (DAX)** — no additional aggregate tables are persisted.

### Logical Relationships

| Relationship | Type |
|--------------|------|
| `FactEvent.AgentID → DimAgent.AgentID` | Many-to-One |
| `FactEvent.MetricID → DimMetric.MetricID` | Many-to-One |
| `FactEvent.FactDateKey → DimDate.Date` | Many-to-One |
| `DimShift(AgentID, LocalDate) ↔ FactEvent(AgentID, FactDateKey)` | Logical Many-to-One (used in DAX) |

---

## 3. 📘 Table Definitions

### 🧾 FactEvent (Canonical Intake)

| Column | Type | Description |
|--------|------|--------------|
| **EventID** | String (PK) | Unique, deterministic ID (e.g., `SOURCE:externalId`). Used for idempotency. |
| **AgentID** | String (FK → DimAgent.AgentID) | Agent responsible for the event. |
| **FactDateKey** | Date (FK → DimDate.Date) | Local business date of event (derived from timezone). |
| **MetricID** | String (FK → DimMetric.MetricID) | Type of metric (CALLS, TEXTS, EMAILS, CASES). |
| **Notes** | String | Optional context or ingestion diagnostics. |

**Notes:**  
- **Grain:** One row per atomic event.  
- **Primary Key:** `EventID`.  
- **Purpose:** The sole canonical fact table; all rollups are derived from it.  
- **Source Systems:** Aloware (calls/texts), Treads (emails), HubSpot (cases).

---

### 👥 DimAgent

| Column | Type | Description |
|--------|------|--------------|
| **AgentID** | String (PK) | Stable internal identifier. |
| **AgentName** | String | Display name. |
| **Email** | String | Used for matching webhook payloads. |
| **TimezoneIANA** | String | IANA timezone string (e.g., `America/New_York`). |
| **ActiveFlag** | Boolean | True if agent is currently active. |

**Behavior:**  
- **Type 1 (Overwrite) Dimension:** Updates overwrite previous records.  
- **Purpose:** Authoritative agent roster for joins and filtering.  
- **Allow-list Enforcement:** Only predefined agents are accepted from webhooks.

---

### 📈 DimMetric

| Column | Type | Description |
|--------|------|--------------|
| **MetricID** | String (PK) | Identifier for metric (e.g., `CALLS`, `TEXTS`, `EMAILS`, `CASES`). |
| **MetricName** | String | Human-readable name. |
| **DefaultGoal** | Int64 | Daily target count. |
| **DefaultYellowFloorPct** | Decimal | Threshold for yellow indicator (e.g., 0.85 = 85% of goal). |

**Behavior:**  
- Mostly static; updated monthly if goals change.  
- Drives Power BI’s color logic via DAX.

---

### 📅 DimDate

| Column | Type | Description |
|--------|------|--------------|
| **Date** | Date (PK) | Calendar date (YYYY-MM-DD). |
| **Year** | Int64 | Year component. |
| **Month** | Int64 | Month number (1–12). |
| **Day** | Int64 | Day of month. |
| **MonthName** | String | Month name (e.g., "October"). |
| **Quarter** | Int64 | Quarter of the year (1–4). |
| **DayOfWeek** | Int64 | 1 = Monday … 7 = Sunday. |
| **DayName** | String | Weekday name. |
| **IsWeekend** | Boolean | True if Saturday/Sunday. |

**Behavior:**  
- Static table, seeded for ±5 years.  
- Enables DAX time intelligence and filter ranges.

---

### ⏱️ DimShift

| Column | Type | Description |
|--------|------|--------------|
| **AgentID** | String (FK → DimAgent.AgentID) | Agent assigned to the shift. |
| **LocalDate** | Date (FK → DimDate.Date) | Agent’s local business date. |
| **ShiftStartLocal** | DateTime | Local shift start time. |
| **ShiftEndLocal** | DateTime | Local shift end time. |
| **ShiftHours** | Int64 | Duration of the shift in hours (usually 8). |

**Behavior:**  
- Used for real-time pace calculations.  
- Derived from Hubstaff or equivalent scheduling system.  
- Relates to FactEvent by `(AgentID, LocalDate)`.

---

## 4. 📊 Metric Categories

| Metric | Source | Reliability | Benchmark |
|---------|---------|-------------|------------|
| **Outbound Calls** | Aloware | ✅ Reliable | 50/day |
| **Outbound Texts** | Aloware | ✅ Reliable | 45/day |
| **Emails Sent** | Treads → HubSpot | ⚠️ Uncertain | None defined |
| **Cases Submitted** | HubSpot | ⚠️ Needs clarification | None defined |

---

## 5. ⏱️ Time & Filtering Logic

**Default filter:** Today  
**Available filters:** Today, Yesterday, This Week, Last Week, This Month, Last Month, Custom range.

**Implementation Notes:**
- Filters are resolved against `DimDate.Date`.  
- Time zone awareness uses `DimAgent.TimezoneIANA`.  
- Local date derivation occurs at ingestion time.

---

## 6. 🟢 Shift-Aware Goal & Color Logic

| Condition | Description | Color |
|------------|--------------|-------|
| On or ahead of pace | %GoalReached ≥ %ShiftElapsed | 🟢 Green |
| Slightly behind pace | 85–99% of expected progress | 🟡 Yellow |
| Off pace | < 85% of expected progress | 🔴 Red |

**Calculation Inputs:**
- `FactEvent` counts by metric (via DAX).  
- `DimMetric.DefaultGoal` and `DefaultYellowFloorPct`.  
- `DimShift.ShiftStartLocal` / `ShiftEndLocal` for elapsed hours.

---

## 7. 🔐 Integration Responsibilities

| Component | Responsibility |
|------------|----------------|
| **Adapters (Aloware, HubSpot, Treads)** | Parse source webhooks into `FactEvent` rows. |
| **Idempotency (DynamoDB)** | Deduplicate events before writing to Power BI. |
| **Dimension Upserts** | Ensure required agents, dates, and metrics exist in Power BI. |
| **FactEvent Writer** | Push normalized events into Power BI via Push Dataset API. |
| **Power BI Dataset** | Aggregates via DAX, renders visuals with time/shift filters. |

---

## 8. ✅ Confirmed Assumptions

| Area | Decision |
|-------|-----------|
| **Shift source** | Hubstaff provides daily shift start times. |
| **Case submission logic** | Uses existing HubSpot report definition. |
| **Agent roster** | Static allow-list of active agents; unknowns ignored. |
| **Goal values** | Stored in DimMetric; adjustable monthly. |
| **Real-time interval** | Push Dataset updates continuously (≤ 15 min latency). |

---

## 9. ❗Outstanding Questions

1. Final definition for “Emails Sent” (Treads vs HubSpot source).  
2. SLA for “real-time” refresh — 5 min, 15 min, or near-live?  
3. Will `DimShift` update in real-time or as a daily pre-seed?  
4. Should we track ingestion errors in a `FactErrorLog` table?

---

## 10. 🧠 Future Enhancements

- Add `DimTeam` for supervisor-level rollups.  
- Introduce `DimGoal` for month-specific targets.  
- Add automated agent roster refresh (daily job).  
- Add health metrics dashboard for ingestion pipeline.

---

*End of Document*
