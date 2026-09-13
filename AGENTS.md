# AGENTS.md

## Project: AI Architecture Studio

This project is an interactive multi-agent architecture studio.

The user enters a virtual 3D architecture firm, briefs an AI team, watches agents collaborate and use tools, steers individual agents while they work, and eventually explores the generated design inside a final presentation space.

The goal is NOT to create a collection of independent chatbots.

The goal is to create the feeling of working inside a real AI-powered architecture company.

---

# 1. Core Experience

The primary interaction loop is:

1. User gives a natural-language brief
   - Voice
   - Text

2. The Principal Architect / Boss Agent interprets the brief.

3. The Boss Agent identifies:
   - Goals
   - Constraints
   - Missing information
   - Ambiguities
   - Required specialists

4. If necessary, the Boss asks the user a small number of high-impact clarification questions.

5. The Boss creates a structured project brief.

6. The Boss delegates work to specialised agents.

7. Agents perform work inside their individual virtual rooms/workspaces.

8. The user can physically navigate to an agent's room and inspect:
   - Current task
   - Thoughts/status
   - Files
   - Tool activity
   - Computer screen
   - Current outputs

9. The user can directly steer an agent.

Example:

> Make the exterior red instead of yellow.

This should become a contextual change request rather than restarting the entire project.

10. Agents update their work and propagate relevant changes.

11. When necessary, agents may call a meeting to resolve:
   - Conflicting requirements
   - Design trade-offs
   - Cost issues
   - Technical issues
   - User-requested changes

12. The final design is assembled.

13. The user enters the final presentation room and explores the resulting architecture/design.

---

# 2. Product Philosophy

## 2.1 Agents should do real work

Agents should not merely role-play conversations.

Where possible, agents should:

- Edit files
- Write code
- Generate structured data
- Modify 3D scenes
- Analyse designs
- Use external tools
- Run commands
- Inspect outputs
- Produce persistent artefacts

The virtual office visualises real agent activity.

---

## 2.2 The 3D environment is the interface

Do not treat the 3D world as decoration around a chatbot.

Physical locations should correspond to system concepts.

Examples:

### Meeting Room
Used for:
- Initial briefing
- Cross-agent discussions
- Design reviews
- Conflict resolution

### Principal Architect Office
Used for:
- Project overview
- Delegation
- Requirements
- Task planning
- Global steering

### Architect Room
Used for:
- Building layout
- Spatial planning
- Massing
- Architectural decisions

### Interior Designer Room
Used for:
- Materials
- Furniture
- Colours
- Interior styling
- Theming

### Critic / Reviewer Room
Used for:
- Design review
- Requirement checking
- Finding inconsistencies
- Challenging assumptions

### Final Presentation Room
Used for:
- Final model
- Walkthrough
- Before/after comparisons
- Design explanation

---

# 3. Initial Agent Team

For the hackathon MVP, prefer a small number of highly differentiated agents.

Use approximately four primary agents.

## 3.1 Principal Architect / Boss

Responsibilities:

- Understand the user's request
- Clarify missing requirements
- Maintain global project context
- Break the project into tasks
- Delegate tasks
- Track dependencies
- Coordinate agents
- Resolve ownership conflicts
- Decide when meetings are necessary
- Integrate final outputs

The Boss should NOT perform every task personally.

The Boss should primarily coordinate.

---

## 3.2 Architect

Responsibilities:

- Overall architectural concept
- Building shape
- Floor plan
- Space allocation
- Structural organisation at a conceptual level
- Exterior architecture
- Spatial relationships

Example outputs:

- Building specification
- Room layout
- Scene geometry instructions
- Architectural model changes

---

## 3.3 Interior / Visual Designer

Responsibilities:

- Colours
- Materials
- Furniture
- Lighting
- Decorations
- Theme implementation
- Character/IP-inspired visual concepts where appropriate

Example:

If the user requests a Pokémon-inspired building, this agent may translate that into:

- Colour palette
- Decorative motifs
- Furniture concepts
- Lighting
- Interior styling

It should avoid blindly changing architectural structure unless necessary.

---

## 3.4 Critic / Design Reviewer

Responsibilities:

- Compare current output against user requirements
- Identify contradictions
- Detect missing requirements
- Evaluate usability
- Evaluate visual coherence
- Challenge weak decisions
- Suggest improvements

The Critic should not criticise for the sake of generating dialogue.

Only raise meaningful issues.

---

# 4. Shared Project State

Agents must operate on shared persistent project state.

Do NOT rely on chat history as the sole source of truth.

Suggested structure:

```json
{
  "project": {
    "id": "project_001",
    "name": "Pokemon House",
    "status": "active"
  },

  "brief": {
    "original_request": "",
    "summary": "",
    "goals": [],
    "constraints": [],
    "preferences": [],
    "open_questions": []
  },

  "design": {
    "architecture": {},
    "interior": {},
    "materials": {},
    "lighting": {},
    "scene": {}
  },

  "tasks": [],

  "decisions": [],

  "change_requests": [],

  "artifacts": [],

  "agents": {},

  "events": []
}
```
---

# 5. Task Model

Every meaningful unit of agent work should be represented as a task.

Example:

```json
{
  "id": "task_023",
  "title": "Create exterior colour concept",
  "owner": "interior_designer",
  "status": "in_progress",
  "priority": "high",

  "objective": "Develop the exterior visual theme.",

  "context": [
    "Building should reference Pikachu.",
    "User prefers playful rather than realistic styling."
  ],

  "dependencies": [
    "task_012"
  ],

  "deliverables": [
    "Exterior palette",
    "Material specification"
  ]
}
```

Possible statuses:

* queued
* blocked
* in_progress
* review
* completed
* cancelled

---

# 6. Steering / Change Requests

User steering is a first-class feature.

When a user enters an agent's room and gives feedback, do NOT treat it as a completely new project prompt.

Create a change request.

Example:

```json
{
  "id": "change_017",

  "source": "user",

  "target_agent": "interior_designer",

  "instruction": "Make the exterior red instead of yellow.",

  "context": {
    "location": "designer_room",
    "related_artifact": "exterior_model_v3"
  },

  "scope": "local",

  "status": "pending"
}
```

The responsible agent should:

1. Interpret the change.
2. Determine affected artefacts.
3. Determine whether other agents are affected.
4. Apply the change.
5. Update project state.
6. Notify the Boss when the change has global implications.

---

# 7. Local vs Global Steering

Not every user request should go through the Boss.

## Local change

Example:

> Make this sofa blue.

Handle directly within the relevant agent.

---

## Global change

Example:

> Actually make the building twice as large.

This likely affects:

* Architecture
* Interior
* Cost
* Scene generation
* Existing dependencies

Escalate to the Boss.

---

# 8. Meetings

Agents should NOT constantly hold meetings.

Meetings should occur only when coordination creates value.

Create a meeting when:

* Two agents disagree
* A requirement affects multiple domains
* A major design decision is required
* A dependency is blocked
* The user requests a review
* A major change request affects multiple agents

Meeting record example:

```json
{
  "id": "meeting_004",

  "topic": "Exterior redesign",

  "participants": [
    "principal_architect",
    "architect",
    "interior_designer"
  ],

  "reason": "User requested a major visual redesign.",

  "decisions": [],

  "status": "active"
}
```

Meetings must produce decisions or tasks.

Avoid conversations that do not modify project state.

---

# 9. Agent Communication

Agent-to-agent communication should be concise and operational.

Bad:

> Hello architect! I think your design is wonderful. What do you think about changing the roof?

Better:

> Roof geometry conflicts with the new lighting concept.
> Proposed change: increase roof clearance by 0.8 m.
> This affects scene geometry and lighting placement.
> Approve?

Agent conversations exist to coordinate work.

They are not the product themselves.

---

# 10. Event System

Important activity should be represented as events.

Example:

```json
{
  "type": "task_started",
  "agent": "architect",
  "task_id": "task_012",
  "timestamp": "..."
}
```

Useful event types:

* project_created
* user_message
* clarification_requested
* clarification_received
* task_created
* task_started
* task_completed
* agent_message
* meeting_started
* meeting_ended
* change_requested
* change_applied
* artifact_created
* artifact_updated
* tool_started
* tool_completed
* error
* final_design_ready

The 3D frontend can use these events to animate the office.

Example:

`task_started`

could cause the agent avatar to walk from the meeting room to its office.

---

# 11. Tool / Computer Use

Agents may receive access to isolated environments such as Docker containers.

Each agent workspace should ideally expose:

* Filesystem
* Terminal
* Browser/tool interface
* Generated artefacts
* Logs

Agent computer activity should be observable by the user where feasible.

Important:

The frontend representation of computer use should be generated from actual execution state rather than fake animations wherever possible.

---

# 12. Artefacts

Agent outputs should be persistent artefacts.

Examples:

* JSON specifications
* Images
* Floor plans
* 3D models
* Scene graphs
* Code
* Materials
* Render configurations
* Reports

Artefact example:

```json
{
  "id": "artifact_013",

  "type": "scene",

  "name": "Pokemon House Exterior",

  "owner": "architect",

  "version": 3,

  "path": "/projects/project_001/scene/exterior.json",

  "related_tasks": [
    "task_012",
    "task_023"
  ]
}
```

Prefer versioned artefacts rather than destructive overwrites.

---

# 13. Design Representation

The architecture output should eventually be represented in a machine-editable format.

Prefer structured scene data over generating only images.

Possible representations include:

* Three.js scene JSON
* glTF / GLB
* Procedural geometry definitions
* Blender-generated models
* Custom architecture JSON compiled into Three.js

For the hackathon MVP, optimise for:

1. Fast generation
2. Easy AI editing
3. Browser rendering
4. Incremental changes

A structured JSON -> Three.js pipeline is likely preferable to attempting full professional CAD generation.

---

# 14. Boss Agent Brief Generation

The Boss should convert natural-language input into a structured brief.

Example input:

> Build me a futuristic Pikachu-themed house for four people. I want it colourful but still something that could plausibly exist.

Example output:

```json
{
  "project_type": "residential_house",

  "occupants": 4,

  "theme": "Pikachu-inspired",

  "style": [
    "futuristic",
    "playful"
  ],

  "requirements": [
    "Suitable for four occupants",
    "Pikachu-inspired visual identity",
    "Colourful",
    "Plausible architectural design"
  ],

  "preferences": {
    "realism": "semi-realistic"
  },

  "unknowns": [
    "Number of floors",
    "Approximate site size"
  ]
}
```

---

# 15. Clarification Policy

Do not interrogate the user with ten questions before beginning.

Ask only questions that significantly affect the result.

Good questions:

* How many people should the building support?
* Is this realistic architecture or fantasy architecture?
* Do you want one or multiple floors?

Low-value details can be inferred and changed later through steering.

Default philosophy:

**Start quickly. Refine interactively.**

---

# 16. Agent Behaviour

All agents should:

* Maintain awareness of their role.
* Avoid duplicating another agent's responsibilities.
* Read project state before acting.
* Produce persistent outputs.
* Record important decisions.
* Respect dependencies.
* Keep actions explainable.
* React to steering without unnecessarily restarting work.
* Escalate cross-domain changes.
* Prefer execution over excessive discussion.

---

# 17. User Experience Principle

The user should always understand:

### What is happening?

Example:

> Architect is generating the first floor layout.

### Why is it happening?

Example:

> This layout supports the four-person occupancy requirement.

### Who is doing it?

Example:

> Architect Agent

### Can I change it?

Whenever practical, yes.

---

# 18. Hackathon MVP Scope

Avoid building a full architecture platform.

The demo should prove one compelling interaction loop:

```text
USER BRIEFS TEAM
        ↓
BOSS UNDERSTANDS REQUEST
        ↓
SHORT AI TEAM MEETING
        ↓
TASKS DELEGATED
        ↓
AGENTS WALK TO ROOMS
        ↓
AGENTS PERFORM REAL TOOL WORK
        ↓
USER VISITS DESIGNER
        ↓
USER STEERS DESIGN
        ↓
DESIGN CHANGES LIVE
        ↓
FINAL MODEL GENERATED
        ↓
USER WALKS INSIDE RESULT
```

If this loop works well, the project is successful.

---

# 19. Demo Scenario

Default demo scenario:

> Design a futuristic Pokémon-inspired home.

Possible initial requirements:

* Two floors
* Four occupants
* Pikachu-inspired
* Bright and playful
* Large living room
* Gaming room
* Pokémon display area

During the demo, intentionally create a design that uses a yellow exterior.

Then demonstrate steering:

> I don't like the yellow exterior. Make it red instead.

The designer modifies the scene.

The updated building becomes visible in the final model.

This showcases:

* Natural-language interaction
* Delegation
* Multi-agent collaboration
* Tool use
* Persistent project state
* Live steering
* 3D output

---

# 20. North Star

The experience should feel like:

> "I hired an AI architecture firm and walked into their office while they were working."

Not:

> "I opened four ChatGPT windows inside a 3D game."

---

# 21. Canonical Design State

Agents must edit a canonical `project/design.json` rather than directly owning the live 3D world state.

A renderer/compiler reads the canonical design and turns it into the Three.js scene. The shared project state references this design file as the source of truth rather than maintaining a competing copy.

The core pipeline is:

```text
Voice/text → Boss → tasks → agents → project/design.json → renderer → 3D world
```

Steering should apply an incremental change to the canonical design, persist the updated artefact version, and refresh the renderer.

Example:

```text
"Make the roof red" → JSON patch → persisted design version → renderer refresh → roof changes
```

Preserve unaffected design elements and record the change request, affected artefacts, and relevant events.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
