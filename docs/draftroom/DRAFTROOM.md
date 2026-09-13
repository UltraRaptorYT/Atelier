> **Historical Draftroom reference, imported 2026-09-13.** This describes the sibling repository at import time, not Atelier’s current implementation or engineering instructions. See the [migration index](index.md) and [current Atelier README](../../README.md).

# DRAFTROOM

https://x.com/parazar/status/2098051231323205993

### An autonomous AI architecture studio you can walk into

## 1. Vision

**Draftroom is a virtual architecture company staffed by autonomous AI agents.**

Instead of asking one AI:

> “Generate me a building.”

the user walks into a digital architecture studio containing a team of specialized AI professionals.

The agents receive a client brief, divide the work among themselves, use real visual design software, critique one another’s work, iterate on the building, and eventually prepare a final presentation.

Most importantly, their work is **observable**.

The user can physically move through the virtual studio, enter an agent’s room, see the agent’s live computer screen, listen to team discussions, give feedback directly by voice, and watch the design evolve.

The experience should feel like:

> **walking into an architecture firm whose employees happen to be AI.**

---

# 2. Core Experience

The user enters the **Draftroom office**.

At reception, they give the **Design Director** a brief through text or voice.

For example:

> Design a two-storey office for a 40-person AI startup.
> We want open collaboration areas, quiet focus rooms and a central social space.
> Make it unconventional but practical.

The Director interprets the requirements and assigns work to the studio.

The user is then free to walk around.

They can enter the **Design Room** and see the Architect’s screen:

> Astra is controlling Spline and currently modifying the building.

They can enter the **Critic’s Room** and see:

> Reviewing Design V1...

They can enter the **Meeting Room** when a design review begins and watch agents discuss trade-offs.

Finally, once the studio is satisfied, the user enters the **Presentation Room**, where the final design and its evolution are presented.

---

# 3. The Draftroom Office

The virtual office is not merely decoration.

It acts as the interface for the whole system.

```text
                      DRAFTROOM

              ┌─────────────────────┐
              │     MEETING ROOM    │
              │                     │
              │   Design Review     │
              └─────────┬───────────┘
                        │
       ┌────────────────┼────────────────┐
       │                │                │
       ▼                ▼                ▼

┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ ARCHITECT   │  │ INTERIOR    │  │ ANALYST     │
│ ROOM        │  │ DESIGNER    │  │ ROOM        │
│             │  │ ROOM        │  │             │
│ 🖥 Spline   │  │ 🖥 Spline   │  │ 🖥 Analysis │
└─────────────┘  └─────────────┘  └─────────────┘

                 ┌─────────────┐
                 │   CRITIC    │
                 │   ROOM      │
                 │             │
                 │ 🖥 Review   │
                 └──────┬──────┘
                        │
                        ▼
              ┌─────────────────────┐
              │ PRESENTATION ROOM   │
              │                     │
              │ V1 → V2 → FINAL     │
              └─────────────────────┘
```

Each room corresponds to an actual function in the architecture workflow.

---

# 4. The AI Team

The full Draftroom concept contains **five agents**.

| Agent                              | Responsibility                                                       | Uses computer?       |
| ---------------------------------- | -------------------------------------------------------------------- | -------------------- |
| 👔 **Design Director / Boss**      | Understands client, delegates work, resolves conflicts, runs reviews | Mainly orchestration |
| 🏗️ **Architect**                   | Building form, massing and spatial organization                      | **Yes — Spline**     |
| 🛋️ **Interior / Spatial Designer** | Interior layout, spatial experience and room planning                | **Yes — Spline**     |
| 📐 **Analyst**                     | Checks area, dimensions and objective constraints                    | Code + visual tools  |
| 👁️ **Design Critic**               | Reviews aesthetics, circulation and architectural quality            | Vision / screenshots |

Not every agent should use computer control simply because Astra can.

The Architect and Spatial Designer are the agents for whom software interaction is genuinely part of the job.

---

# 5. How the Team Collaborates

The **Design Director** acts as the orchestrator.

However, agents should not report every tiny action to the Director.

That would make the system slow and unnatural.

Instead, Draftroom uses **checkpoint-based collaboration**.

```text
CLIENT BRIEF
      ↓
DESIGN DIRECTOR
      ↓
assign objectives
      ↓
┌───────────────┬────────────────┐
▼               ▼                ▼
ARCHITECT    DESIGNER         ANALYST
work freely   work freely     evaluate
└───────────────┬────────────────┘
                ↓
         DESIGN CHECKPOINT
                ↓
           MEETING ROOM
                ↓
      Team reviews design
                ↓
        Director decides
                ↓
            REVISION
                ↓
        FINAL CHECKPOINT
```

Agents therefore work autonomously between major reviews.

---

# 6. User Intervention

The user does **not** have to communicate only through the Boss.

If the user walks into the Architect’s room and says:

> “I really like this curved entrance. Don’t remove it.”

the Architect can record that immediately as a project constraint.

```text
CLIENT DIRECTIVE

Preserve curved entrance

Priority: HIGH
Source: Client
```

The shared project state updates automatically.

The Director and other agents can see it.

A meeting is only triggered when the new instruction creates a meaningful conflict.

For example:

> “Double the atrium.”

The Analyst responds:

> This would push floor area outside the brief.

Now:

### 🛎 Design Review Requested

Agents enter the meeting room and decide what to sacrifice.

---

# 7. Astra Computer Use

This should be one of the strongest parts of the hackathon demo.

The Architect does not merely output:

```json
{
  "move_room": "east"
}
```

Instead, Astra sees a visual design environment and operates it.

For example:

```text
Astra Architect
      ↓
Screenshot of Spline
      ↓
Understands current model
      ↓
Clicks / drags / types
      ↓
Spline changes
      ↓
New screenshot
      ↓
Astra continues
```

The audience can watch the process.

Astra might:

- rotate the model,
- select a building mass,
- move it,
- scale it,
- create another object,
- inspect the result,
- revise it after criticism.

The model therefore behaves like a real employee using a workstation.

---

# 8. Docker Workstations

Each computer-using AI employee can run inside an isolated workstation.

Conceptually:

```text
Architect
   ↓
Docker Container
   ↓
Chromium
   ↓
Spline
   ↓
Virtual display
   ↓
Live screen stream
```

Possible setup:

```text
Docker
↓
Chromium
↓
Xvfb
↓
noVNC
↓
Draftroom frontend
```

If the full system had five computer-using agents:

```text
Agent 1 → Docker #1 → Screen #1
Agent 2 → Docker #2 → Screen #2
Agent 3 → Docker #3 → Screen #3
Agent 4 → Docker #4 → Screen #4
Agent 5 → Docker #5 → Screen #5
```

However, for the hackathon, **do not begin with five computer-use containers**.

Recommended:

- 1 real Architect workstation
- 1 optional Designer workstation
- Critic + Analyst can operate without full desktops

---

# 9. Live Workstations Inside the Virtual Office

When the user enters an agent’s room, they can see the agent’s live screen.

For example:

```text
ARCHITECT — WORKING

Current task:
Reorganize eastern building mass

┌──────────────────────────────┐
│                              │
│       LIVE SPLINE SCREEN     │
│                              │
│             🖱               │
│                              │
└──────────────────────────────┘

Current action:
Scaling eastern wing
```

This gives the feeling of literally looking over the AI employee’s shoulder.

The user sees:

> **what the agent is doing**

rather than merely seeing:

> “Architect is thinking…”

---

# 10. Agent Communication

Agents should have visible conversations.

But these should be **explicit public studio messages**, not hidden reasoning.

Example:

**Architect**

> I’m preserving the curved entrance but widening the central atrium.

**Analyst**

> This increases the total footprint by approximately 9%.

**Interior Designer**

> A larger atrium improves circulation between shared spaces.

**Critic**

> The eastern façade is becoming visually unbalanced.

These can appear:

- as speech bubbles in the meeting room,
- in a studio transcript,
- above avatars,
- beside each agent’s workstation.

The model remains the main visual focus.

Conversation explains **why** the design changes.

---

# 11. Voice Interaction

Users should be able to talk to the agents naturally.

### Whisper pipeline

```text
Microphone
    ↓
Whisper
    ↓
Transcript
    ↓
Selected Agent / Director
    ↓
Shared project state
```

Examples:

### Speaking to the Director

> Make the building feel more playful. It looks too corporate.

The Director interprets this as a design objective and assigns the change.

### Speaking to the Architect

> Keep the curved entrance.

That becomes a protected project constraint.

### During the meeting

> I agree with the critic. Prioritize aesthetics over efficiency.

The review immediately adapts.

The goal is:

> **You don’t operate Draftroom through forms. You walk into the office and talk to people.**

---

# 12. Meeting Room

Agents should not constantly meet.

Meetings happen at important checkpoints.

Example:

### Design Review #1

**Architect**

> I organized the building around a central social atrium.

**Interior Designer**

> The northern focus rooms are disconnected from collaborative spaces.

**Analyst**

> Total floor area is 11% above target.

**Critic**

> The atrium works, but the overall massing is still too generic.

**Director**

> Preserve the atrium. Reduce the northern mass and make the exterior geometry respond more strongly to the central space.

### Meeting Complete

Agents return to their individual rooms.

Work continues.

This makes the company feel alive.

---

# 13. Presentation Room

When the design is complete:

### ✦ Final Design Ready

The presentation room opens.

Inside, the user sees:

```text
CLIENT BRIEF
     ↓

DESIGN V1

     ↓

CRITIQUE
"Too generic"
"11% over area target"

     ↓

DESIGN V2

     ↓

CLIENT INTERVENTION
"Preserve curved entrance"

     ↓

FINAL DESIGN
```

The final presentation can show:

- rotating 3D design,
- original brief,
- key constraints,
- V1 → V2 → final,
- important design decisions,
- client interventions,
- short summary from the Director.

The experience should resemble a real architectural client presentation.

---

# 14. Design Application

## Spline

For the hackathon, Draftroom uses **Spline** as the design workspace.

The project focuses on:

> **architectural concept design / spatial massing**

rather than BIM or construction documentation.

Agents manipulate:

- building masses,
- room blocks,
- heights,
- position,
- orientation,
- basic materials,
- spatial relationships,
- simple interior components.

Spline is primarily responsible for:

> **the visual artifact**

while Draftroom handles reasoning, metrics and collaboration.

---

# 15. Master Project Prompts

Use the detailed, editable briefs in [prompts/projects/](prompts/projects/), also available in the frontend's project starters. These supersede the original short examples. The sites are hypothetical scenarios in named Singapore neighborhoods; dimensions and envelopes are client inputs, not surveyed parcels or planning rights.

| Master prompt | Location and land | Scope and intended value |
| --- | --- | --- |
| [Pikachu House](prompts/projects/03-pikachu-house.md) | Joo Chiat; 20 × 30 m, 600 m² | Two-storey, three-bedroom family home; 320 m² target GFA. Translate playfulness into roof, light, and garden-connected family life, with calm bedrooms. |
| [Esplanade-Inspired Cultural Centre](prompts/projects/04-waterfront-culture.md) | Tanjong Rhu waterfront; 120 × 80 m, 9,600 m² | 11,000 m² target GFA, 900-seat hall and 250-seat black box. A shared expressive roof and public waterfront life beyond ticketed performances. |
| [Standard Skyscraper / Sky Garden Tower](prompts/projects/05-sky-garden-tower.md) | Tanjong Pagar; 70 × 60 m, 4,200 m² | Exactly 40 storeys including podium and two sky gardens; 41,150 m² target enclosed GFA. Professional skyline presence, useful gardens, generous public ground. |
| [AI Startup Office](prompts/projects/01-ai-startup-office.md) | one-north; 40 × 30 m, 1,200 m² | Fit out a fixed 720 m² shell for 40 staff. Warm shared social life, protected focus rooms, clear guest routes, and a staff garden. |
| [Courtyard Library](prompts/projects/02-courtyard-library.md) | Bishan; 60 × 50 m, 3,000 m² | Two floors, 2,400 m² target GFA, 300 m² open courtyard, 140 reading seats. A neighborhood living room that becomes quieter inward and upward. |

Each source includes orientation/access, site and building dimensions, a reconciled area budget, hard requirements, intended feeling, exclusions, and required views/checks. Working allocations can shift within accepted hard constraints. Do not invent a numerical failure to force a demo revision.

See the [prompt library](prompts/README.md) for the five employee system prompts, shared evidence rules, and frontend synchronization commands.

------

# 16. Technology Stack

### Frontend

**Next.js + React + TypeScript**

Used for:

- Draftroom application
- user interaction
- project state
- agent status
- meetings
- presentation system

---

### Virtual Office

**React Three Fiber + Drei**

Used for:

- 3D Draftroom office
- room navigation
- avatars
- computer screens
- meeting room
- presentation room

---

### Design Environment

**Spline**

Used by:

- Architect
- Interior / Spatial Designer

---

### AI

**GPT-6 Astra**

Used for:

- visual understanding
- computer use
- architectural decision making
- design criticism
- orchestration
- agent collaboration

---

### Agent Workstations

**Docker**

Possible stack:

```text
Docker
Chromium
Xvfb
noVNC
Computer-action executor
Astra worker
```

---

### Screen Streaming

Hackathon:

**noVNC**

Potential later version:

**WebRTC**

---

### Shared State

**Supabase**

Possible data:

```text
Projects
Agents
Tasks
Messages
Design iterations
Client directives
Artifacts
Agent status
```

Hackathon fallback:

> REST polling.

No need to overengineer real-time infrastructure.

---

### Voice

**Whisper**

Used for client voice interaction.

---

### Deployment

**Vercel**

Used for:

- frontend
- dashboard
- API/orchestration layer

Computer-use workers may remain on local/docker machines during the hackathon if that is more reliable.

---

# 17. High-Level Architecture

```text
                         USER
                          │
                 voice / movement
                          │
                          ▼
                 DRAFTROOM OFFICE
                          │
                          ▼
                DESIGN DIRECTOR
                     Astra
                          │
            ┌─────────────┼─────────────┐
            │             │             │
            ▼             ▼             ▼
        ARCHITECT      DESIGNER       CRITIC
          Astra          Astra         Astra
            │             │
            ▼             ▼
        Docker A      Docker B
            │             │
          Spline        Spline
            │             │
            └──────┬──────┘
                   │
                   ▼
             SHARED PROJECT
                  STATE
                   │
             ┌─────┴─────┐
             ▼           ▼
          ANALYST     DIRECTOR
           Code           │
                          ▼
                   DESIGN REVIEW
                          │
                          ▼
                  PRESENTATION
```

---

# 18. Hackathon Implementation Levels

## Level 1 — Must Ship

- virtual Draftroom office,
- user can walk between rooms,
- Architect room,
- live Astra-controlled design workstation,
- visible Spline screen,
- one critique,
- one revision,
- final presentation room.

If this works, you have a legitimate submission.

---

## Level 2 — Target

Everything from Level 1, plus:

- Design Director,
- Architect,
- Critic,
- Analyst,
- visible meeting,
- Whisper intervention,
- V1 → critique → V2,
- agents moving between work rooms and meeting room.

This is the ideal hackathon version.

---

## Level 3 — Stretch

Add:

- Interior Designer,
- additional Docker workstation,
- five-agent studio,
- intelligent Director delegation,
- automatic meeting triggers,
- multiple iterations,
- richer final presentation,
- multiple agents working concurrently.

---

# 19. 90-Second Demo

### 0:00–0:08

Walk into Draftroom.

> “What if hiring an architect felt like walking into their studio—except everyone inside was AI?”

Speak to Director:

> Design an office for a 40-person AI startup.

---

### 0:08–0:20

Director:

> Architect, develop the initial concept.

Architect walks into Design Room.

User follows.

Monitor shows:

### ✦ Astra Architect — Working

Spline begins changing.

---

### 0:20–0:35

Visit the Critic.

> The central social space works, but the focus rooms are disconnected.

Analyst:

> Circulation requirement not satisfied.

---

### 0:35–0:43

### 🛎 Design Review

Agents move into the meeting room.

Director:

> Preserve the central social space. Reorganize the focus wing.

---

### 0:43–0:58

Architect returns to workstation.

Astra visibly edits Spline.

The building changes.

---

### 0:58–1:08

User speaks:

> Make the entrance more dramatic.

Whisper transcription appears.

Architect responds.

Design changes again.

---

### 1:08–1:20

### ✦ Design Complete

User walks into Presentation Room.

Show:

> V1 → review → V2 → final.

Large rotating final design.

---

### 1:20–1:30

> “They didn’t generate an image. They ran a design studio.”

# DRAFTROOM

### An architecture studio staffed by AI.

---

# 20. Core Differentiation

Draftroom is not:

> five AI chatbots pretending to be architects.

And it is not:

> another prompt-to-building generator.

The concept is:

> **Autonomous computer-using agents form an observable architecture company around a shared visual artifact.**

Their:

- collaboration is visible,
- computers are visible,
- discussions are visible,
- design iterations are visible,
- client interventions are visible.

The user doesn’t merely receive the output.

They can **walk into the process**.

---

# 21. Pre-Hackathon TODO

### Critical tonight

1. **Test Astra + Spline computer use**
   - select
   - move
   - scale
   - rotate
   - inspect
   - create simple mass
2. **Write the five master project prompts**
   - Pikachu House
   - Esplanade-inspired cultural centre
   - standard skyscraper
   - AI startup office
   - courtyard library
3. **Write five agent system prompts**
   - Director
   - Architect
   - Interior Designer
   - Analyst
   - Critic
4. **Test Whisper**
   - microphone → transcript → agent instruction
5. **Choose exact 90-second demo prompt**
6. **Sketch Draftroom office**
   - reception
   - Architect room
   - Designer room
   - Critic/Analyst room
   - meeting room
   - presentation room
7. **Define shared project-state schema**
8. **Prepare Docker computer-use worker**
9. **Prepare mock V1 → review → V2 data**
10. **Freeze hackathon scope**

The biggest rule for tomorrow:

> **Build 3 believable employees before attempting 5 mediocre ones.**

The full vision is a five-person autonomous studio.

The hackathon only needs to convince people that **Draftroom feels like a company rather than a chatbot.**
